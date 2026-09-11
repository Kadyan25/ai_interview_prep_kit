import mongoose from "mongoose";
import type { JobStep, JobType, StepStatus } from "@prep/shared";
import { GenerationJob, type GenerationJobDoc } from "../models/GenerationJob.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { PIPELINE_STEPS } from "../pipeline/runPipeline.js";

/** The step list a job starts with, so the UI can render the whole plan at once. */
export function initialSteps(type: JobType): JobStep[] {
  if (type === "full") {
    return PIPELINE_STEPS.map((step) => ({ name: step.name, status: "pending" }));
  }
  const byType: Record<Exclude<JobType, "full">, string[]> = {
    regen_brief: ["crawl-company", "find-hiring-page", "summarise-hiring", "write-brief"],
    regen_category: ["generate-questions", "coverage"],
    regen_schedule: ["schedule"],
  };
  return byType[type].map((name) => ({ name, status: "pending" as StepStatus }));
}

export const STEP_LABELS: Record<string, string> = Object.fromEntries(
  PIPELINE_STEPS.map((step) => [step.name, step.label]),
);

export async function createJob(params: {
  kitId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  type: JobType;
  category?: string | null;
}): Promise<GenerationJobDoc> {
  return GenerationJob.create({
    kitId: params.kitId,
    userId: params.userId,
    type: params.type,
    category: params.category ?? null,
    status: "queued",
    steps: initialSteps(params.type),
    error: null,
  });
}

export async function markRunning(jobId: mongoose.Types.ObjectId): Promise<void> {
  await GenerationJob.updateOne({ _id: jobId }, { $set: { status: "running" } });
}

/**
 * Progress is written straight to the job document rather than held in memory,
 * so a browser refresh, a second tab, or a reconnect all see the same state.
 */
export async function recordStep(
  jobId: mongoose.Types.ObjectId,
  name: string,
  status: StepStatus,
  note?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const job = await GenerationJob.findById(jobId);
  if (!job) return;

  const steps = [...job.steps];
  const index = steps.findIndex((step) => step.name === name);
  const existing = index >= 0 ? steps[index]! : { name, status: "pending" as StepStatus };

  const updated: JobStep = {
    ...existing,
    status,
    ...(note ? { note } : {}),
    ...(status === "running" ? { startedAt: now } : {}),
    ...(status === "done" || status === "failed" || status === "skipped" ? { endedAt: now } : {}),
  };

  if (index >= 0) steps[index] = updated;
  else steps.push(updated);

  await GenerationJob.updateOne({ _id: jobId }, { $set: { steps } });
}

export async function finishJob(
  jobId: mongoose.Types.ObjectId,
  status: "done" | "failed",
  error?: { code: string; message: string },
): Promise<void> {
  await GenerationJob.updateOne(
    { _id: jobId },
    { $set: { status, error: error ?? null } },
  );
}

export async function latestJob(
  userId: string,
  kitId: string,
): Promise<GenerationJobDoc | null> {
  if (!mongoose.Types.ObjectId.isValid(kitId)) {
    throw new AppError("NOT_FOUND", "That kit does not exist.");
  }
  return GenerationJob.findOne({
    kitId: new mongoose.Types.ObjectId(kitId),
    userId: new mongoose.Types.ObjectId(userId),
  }).sort({ createdAt: -1 });
}

export function toJobResponse(job: GenerationJobDoc) {
  return {
    id: job._id.toString(),
    kitId: job.kitId.toString(),
    type: job.type,
    category: job.category,
    status: job.status,
    steps: job.steps.map((step) => ({ ...step, label: STEP_LABELS[step.name] ?? step.name })),
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

/**
 * A job left "running" means the process died mid-generation — a Render restart,
 * a deploy, a crash. Nothing is going to finish it, so it is marked failed at
 * boot and the UI offers a retry instead of spinning forever.
 */
export async function sweepInterruptedJobs(): Promise<number> {
  const result = await GenerationJob.updateMany(
    { status: { $in: ["queued", "running"] } },
    {
      $set: {
        status: "failed",
        error: {
          code: "INTERRUPTED",
          message: "Generation stopped when the server restarted. Retry to pick it up again.",
        },
      },
    },
  );

  if (result.modifiedCount > 0) {
    logger.warn({ count: result.modifiedCount }, "marked interrupted jobs as failed");
  }
  return result.modifiedCount;
}
