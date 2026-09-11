import mongoose from "mongoose";
import type { KitDocument, KitSummary } from "@prep/shared";
import { Kit, type KitDoc } from "../models/Kit.js";
import { AppError } from "../lib/errors.js";

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

export async function deleteKit(userId: string, kitId: string): Promise<void> {
  const result = await Kit.deleteOne({
    _id: objectId(kitId),
    userId: objectId(userId, "user"),
  });
  if (result.deletedCount === 0) throw new AppError("NOT_FOUND", "That kit does not exist.");
}
