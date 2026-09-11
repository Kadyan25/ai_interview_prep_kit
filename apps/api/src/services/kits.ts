import mongoose from "mongoose";
import type {
  KitDocument,
  KitInput,
  KitState,
  KitSummary,
  Op,
  QuestionCategory,
} from "@prep/shared";
import { OpsError, applyOps, sectionForOp } from "@prep/shared";
import { Kit, type KitDoc } from "../models/Kit.js";
import { AppError } from "../lib/errors.js";
import { kitContentHash } from "../lib/hash.js";
import { assertGeneratorReady, enqueueJob } from "../jobs/runner.js";
import { createJob } from "./jobs.js";
import { activeLockedSections, type RegenSection } from "./regenerate.js";

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

export type ApplyOpsResult = { kit: KitDocument };

/**
 * Edits are applied with the version the client was looking at. If anything else
 * wrote to the kit in between, the update matches nothing and the client is told
 * to reload rather than silently overwriting someone else's change.
 */
export async function applyKitOps(
  userId: string,
  kitId: string,
  version: number,
  ops: Op[],
): Promise<ApplyOpsResult> {
  const owner = objectId(userId, "user");
  const id = objectId(kitId);

  const kit = await Kit.findOne({ _id: id, userId: owner });
  if (!kit) throw new AppError("NOT_FOUND", "That kit does not exist.");
  if (!kit.body) {
    throw new AppError("INVALID_INPUT", "This kit has no content to edit yet.");
  }

  // A section being regenerated is off limits; everything else stays editable.
  const locked = await activeLockedSections(id);
  if (locked.length > 0) {
    const blocked = ops.map(sectionForOp).find((section) => locked.includes(section));
    if (blocked) {
      throw new AppError(
        "SECTION_LOCKED",
        `The ${blocked} section is being regenerated. Your other edits still save.`,
      );
    }
  }

  let next: KitState;
  try {
    next = applyOps(
      { body: kit.body, itemState: kit.itemState ?? {}, counters: kit.counters },
      ops,
    );
  } catch (error) {
    if (error instanceof OpsError) {
      throw new AppError("INVALID_INPUT", error.message, error.details);
    }
    throw error;
  }

  const updated = await Kit.findOneAndUpdate(
    { _id: id, userId: owner, version },
    {
      $set: { body: next.body, itemState: next.itemState, counters: next.counters },
      $inc: { version: 1 },
    },
    { new: true },
  );

  if (!updated) {
    const current = await Kit.findOne({ _id: id, userId: owner });
    throw new AppError(
      "VERSION_CONFLICT",
      "This kit changed in another tab. Your edits were not saved — reload to get the latest version.",
      current ? { kit: toKitDocument(current) } : undefined,
    );
  }

  return { kit: toKitDocument(updated) };
}

/** Queues a regeneration of one section and returns the job doing it. */
export async function requestRegeneration(
  userId: string,
  kitId: string,
  section: RegenSection,
  category?: QuestionCategory,
): Promise<{ jobId: string }> {
  assertGeneratorReady();

  const owner = objectId(userId, "user");
  const id = objectId(kitId);

  const kit = await Kit.findOne({ _id: id, userId: owner });
  if (!kit) throw new AppError("NOT_FOUND", "That kit does not exist.");
  if (!kit.body) {
    throw new AppError("INVALID_INPUT", "This kit has nothing to regenerate yet.");
  }
  if (section === "category" && !category) {
    throw new AppError("INVALID_INPUT", "Say which category of questions to regenerate.");
  }

  const locked = await activeLockedSections(id);
  const wanted = section === "category" ? "questions" : section;
  if (locked.includes(wanted)) {
    throw new AppError("SECTION_LOCKED", "That section is already being regenerated.");
  }

  const type =
    section === "brief"
      ? "regen_brief"
      : section === "category"
        ? "regen_category"
        : "regen_schedule";

  const job = await createJob({ kitId: id, userId: owner, type, category: category ?? null });
  enqueueJob({ jobId: job._id, kitId: id, userId: owner });

  return { jobId: job._id.toString() };
}

export async function deleteKit(userId: string, kitId: string): Promise<void> {
  const result = await Kit.deleteOne({
    _id: objectId(kitId),
    userId: objectId(userId, "user"),
  });
  if (result.deletedCount === 0) throw new AppError("NOT_FOUND", "That kit does not exist.");
}
