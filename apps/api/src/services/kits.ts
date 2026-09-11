import mongoose from "mongoose";
import type { KitDocument, KitInput, KitSummary } from "@prep/shared";
import { Kit, type KitDoc } from "../models/Kit.js";
import { AppError } from "../lib/errors.js";
import { kitContentHash } from "../lib/hash.js";
import { assertGeneratorReady, enqueueJob } from "../jobs/runner.js";
import { createJob } from "./jobs.js";

function objectId(id: string, what = "kit"): mongoose.Types.ObjectId {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError("NOT_FOUND", `That ${what} does not exist.`);
  }
  return new mongoose.Types.ObjectId(id);
}

export function toKitDocument(doc: KitDoc): KitDocument {
  return {
    id: doc._id.toString(),
    status: doc.status,
    input: doc.input,
    body: doc.body,
    itemState: doc.itemState ?? {},
    counters: doc.counters ?? { r: 0, q: 0, f: 0 },
    version: doc.version,
    research: doc.research ?? {
      hiringPageUrl: null,
      hiringProcess: null,
      discussion: [],
      skipped: [],
    },
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toSummary(doc: KitDoc): KitSummary {
  return {
    id: doc._id.toString(),
    status: doc.status,
    company: doc.body?.source.company || hostOf(doc.input.companyUrl),
    role: doc.body?.source.role || "Untitled role",
    days: doc.input.days,
    questionCount: doc.body?.questions.length ?? 0,
    warningCount: doc.body?.warnings?.length ?? 0,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Unknown company";
  }
}

export async function listKits(userId: string): Promise<KitSummary[]> {
  const docs = await Kit.find({ userId: objectId(userId, "user") })
    .sort({ createdAt: -1 })
    .limit(100);
  return docs.map(toSummary);
}

export async function getKit(userId: string, kitId: string): Promise<KitDocument> {
  const doc = await Kit.findOne({ _id: objectId(kitId), userId: objectId(userId, "user") });
  if (!doc) throw new AppError("NOT_FOUND", "That kit does not exist.");
  return toKitDocument(doc);
}

export const MAX_BATCH = 10;

export type CreateKitResult = {
  kit: KitDocument;
  jobId: string | null;
  /** True when an identical kit already existed and was returned instead. */
  existing: boolean;
};

/**
 * Creating a kit costs about ten model calls, so an accidental double submit is
 * expensive. The same posting, company and day count for the same user hashes to
 * the same value and reopens the existing kit unless the user asks for a fresh
 * one.
 */
export async function createKit(
  userId: string,
  input: KitInput,
  options: { force?: boolean } = {},
): Promise<CreateKitResult> {
  assertGeneratorReady();

  const owner = objectId(userId, "user");
  const contentHash = kitContentHash({ userId, ...input });

  if (!options.force) {
    const existing = await Kit.findOne({
      userId: owner,
      contentHash,
      status: { $ne: "failed" },
    }).sort({ createdAt: -1 });

    if (existing) {
      return { kit: toKitDocument(existing), jobId: null, existing: true };
    }
  }

  const kit = await Kit.create({
    userId: owner,
    status: "generating",
    input,
    contentHash,
    body: null,
    itemState: {},
    counters: { r: 0, q: 0, f: 0 },
    version: 1,
    research: { hiringPageUrl: null, hiringProcess: null, discussion: [], skipped: [] },
  });

  const job = await createJob({ kitId: kit._id, userId: owner, type: "full" });
  enqueueJob({ jobId: job._id, kitId: kit._id, userId: owner });

  return { kit: toKitDocument(kit), jobId: job._id.toString(), existing: false };
}

export async function createKitBatch(
  userId: string,
  inputs: KitInput[],
): Promise<CreateKitResult[]> {
  if (inputs.length === 0) {
    throw new AppError("INVALID_INPUT", "Add at least one role to generate.");
  }
  if (inputs.length > MAX_BATCH) {
    throw new AppError(
      "INVALID_INPUT",
      `That file has ${inputs.length} roles; ${MAX_BATCH} is the most you can queue at once.`,
    );
  }

  const results: CreateKitResult[] = [];
  for (const input of inputs) {
    results.push(await createKit(userId, input));
  }
  return results;
}

/** Queues a fresh attempt for a kit whose generation failed. */
export async function retryKit(userId: string, kitId: string): Promise<{ jobId: string }> {
  assertGeneratorReady();

  const owner = objectId(userId, "user");
  const kit = await Kit.findOne({ _id: objectId(kitId), userId: owner });
  if (!kit) throw new AppError("NOT_FOUND", "That kit does not exist.");
  if (kit.status === "generating") {
    throw new AppError("INVALID_INPUT", "That kit is already being generated.");
  }

  await Kit.updateOne({ _id: kit._id }, { $set: { status: "generating" } });
  const job = await createJob({ kitId: kit._id, userId: owner, type: "full" });
  enqueueJob({ jobId: job._id, kitId: kit._id, userId: owner });

  return { jobId: job._id.toString() };
}

export async function deleteKit(userId: string, kitId: string): Promise<void> {
  const result = await Kit.deleteOne({
    _id: objectId(kitId),
    userId: objectId(userId, "user"),
  });
  if (result.deletedCount === 0) throw new AppError("NOT_FOUND", "That kit does not exist.");
}
