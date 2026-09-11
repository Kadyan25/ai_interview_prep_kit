import { Router } from "express";
import { z } from "zod";
import { parseOps, questionCategorySchema } from "@prep/shared";
import { AppError } from "../lib/errors.js";
import { currentUserId, pathParam, requireAuth } from "../middleware/auth.js";
import { createKitLimiter } from "../middleware/rateLimit.js";
import { latestJob, toJobResponse } from "../services/jobs.js";
import {
  MAX_BATCH,
  applyKitOps,
  createKit,
  createKitBatch,
  deleteKit,
  getKit,
  listKits,
  requestRegeneration,
  retryKit,
} from "../services/kits.js";
import { MAX_JD_CHARS } from "../pipeline/steps/parseInput.js";

const kitInputSchema = z.object({
  jd: z
    .string()
    .trim()
    .min(1, "Paste the job description.")
    .max(MAX_JD_CHARS, `Job descriptions are limited to ${MAX_JD_CHARS} characters.`),
  companyUrl: z.string().trim().max(2048).default(""),
  days: z
    .number({ invalid_type_error: "Days must be a number." })
    .int("Days must be a whole number.")
    .min(1, "Give yourself at least one day.")
    .max(60, "Sixty days is the longest plan this builds."),
});

const createSchema = kitInputSchema.extend({ force: z.boolean().optional() });

const batchSchema = z.object({
  kits: z.array(kitInputSchema).min(1).max(MAX_BATCH),
});

const patchSchema = z.object({
  // The version the client was looking at when the user made these edits.
  version: z.number().int().min(1),
  ops: z.unknown(),
});

const regenerateSchema = z.object({
  section: z.enum(["brief", "category", "schedule"]),
  category: questionCategorySchema.optional(),
});

export const kitsRouter: Router = Router();

kitsRouter.use(requireAuth);

kitsRouter.get("/", async (req, res) => {
  res.json({ kits: await listKits(currentUserId(req)) });
});

kitsRouter.post("/", createKitLimiter, async (req, res) => {
  const { force, ...input } = createSchema.parse(req.body);
  const result = await createKit(currentUserId(req), input, { force: force ?? false });

  // 200 means "here is the one you already had"; 202 means "work has started".
  res.status(result.existing ? 200 : 202).json({
    kit: result.kit,
    jobId: result.jobId,
    existing: result.existing,
  });
});

kitsRouter.post("/batch", createKitLimiter, async (req, res) => {
  const { kits } = batchSchema.parse(req.body);
  const results = await createKitBatch(currentUserId(req), kits);
  res.status(202).json({
    kits: results.map((r) => ({ kit: r.kit, jobId: r.jobId, existing: r.existing })),
  });
});

kitsRouter.get("/:id", async (req, res) => {
  res.json({ kit: await getKit(currentUserId(req), pathParam(req, "id")) });
});

kitsRouter.get("/:id/job", async (req, res) => {
  const job = await latestJob(currentUserId(req), pathParam(req, "id"));
  if (!job) throw new AppError("NOT_FOUND", "No generation has been run for that kit.");
  res.json({ job: toJobResponse(job) });
});

kitsRouter.post("/:id/retry", createKitLimiter, async (req, res) => {
  const { jobId } = await retryKit(currentUserId(req), pathParam(req, "id"));
  res.status(202).json({ jobId });
});

kitsRouter.patch("/:id", async (req, res) => {
  const { version, ops } = patchSchema.parse(req.body);
  const result = await applyKitOps(currentUserId(req), pathParam(req, "id"), version, parseOps(ops));
  res.json(result);
});

kitsRouter.post("/:id/regenerate", createKitLimiter, async (req, res) => {
  const { section, category } = regenerateSchema.parse(req.body);
  const { jobId } = await requestRegeneration(
    currentUserId(req),
    pathParam(req, "id"),
    section,
    category,
  );
  res.status(202).json({ jobId });
});

kitsRouter.delete("/:id", async (req, res) => {
  await deleteKit(currentUserId(req), pathParam(req, "id"));
  res.json({ ok: true });
});
