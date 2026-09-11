import mongoose from "mongoose";
import type { Flashcard, KitBody } from "@prep/shared";
import { AppError } from "../lib/errors.js";
import { Kit } from "../models/Kit.js";
import { PracticeRecord, type PracticeRecordDoc } from "../models/PracticeRecord.js";

export type Confidence = 1 | 2 | 3;

export type PracticeCard = Flashcard & {
  seenCount: number;
  confidence: Confidence | null;
  lastSeenAt: string | null;
  /** The requirements this card exercises, resolved for display. */
  requirements: { id: string; text: string; priority: "must" | "nice" }[];
};

export type PracticeStats = {
  total: number;
  seen: number;
  byConfidence: Record<"1" | "2" | "3", number>;
  byRequirement: {
    id: string;
    text: string;
    priority: "must" | "nice";
    cards: number;
    seen: number;
    shaky: number;
  }[];
};

function objectId(id: string, what = "kit"): mongoose.Types.ObjectId {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError("NOT_FOUND", `That ${what} does not exist.`);
  }
  return new mongoose.Types.ObjectId(id);
}

async function loadKitBody(
  userId: string,
  kitId: string,
): Promise<{ body: KitBody; kitId: mongoose.Types.ObjectId; userId: mongoose.Types.ObjectId }> {
  const owner = objectId(userId, "user");
  const id = objectId(kitId);
  const kit = await Kit.findOne({ _id: id, userId: owner });
  if (!kit) throw new AppError("NOT_FOUND", "That kit does not exist.");
  if (!kit.body) {
    throw new AppError("INVALID_INPUT", "This kit has no flashcards to practise yet.");
  }
  return { body: kit.body, kitId: id, userId: owner };
}

function recordsByCard(records: PracticeRecordDoc[]): Map<string, PracticeRecordDoc> {
  return new Map(records.map((record) => [record.cardId, record]));
}

/**
 * Ordering: cards never seen first, then the ones the user felt worst about,
 * then whatever has gone longest without review.
 *
 * Deliberately not a spaced-repetition schedule. SM-2 style intervals assume
 * months of study; this app exists for a horizon of one to sixty days, where
 * most cards would never come due and the user would be shown nothing. Sorting
 * by stated confidence is predictable, explainable, and right for the deadline.
 */
export function orderCards(cards: PracticeCard[]): PracticeCard[] {
  return [...cards].sort((a, b) => {
    const aSeen = a.confidence !== null;
    const bSeen = b.confidence !== null;
    if (aSeen !== bSeen) return aSeen ? 1 : -1;

    if (a.confidence !== null && b.confidence !== null && a.confidence !== b.confidence) {
      return a.confidence - b.confidence;
    }

    const aTime = a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0;
    const bTime = b.lastSeenAt ? Date.parse(b.lastSeenAt) : 0;
    if (aTime !== bTime) return aTime - bTime;

    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}

export async function getSession(userId: string, kitId: string): Promise<PracticeCard[]> {
  const { body, kitId: id, userId: owner } = await loadKitBody(userId, kitId);
  const records = await PracticeRecord.find({ kitId: id, userId: owner });
  const byCard = recordsByCard(records);

  const requirementById = new Map(body.role.requirements.map((r) => [r.id, r]));

  const cards: PracticeCard[] = body.flashcards.map((card) => {
    const record = byCard.get(card.id);
    return {
      ...card,
      seenCount: record?.seenCount ?? 0,
      confidence: (record?.confidence as Confidence | undefined) ?? null,
      lastSeenAt: record?.lastSeenAt ? record.lastSeenAt.toISOString() : null,
      requirements: card.requirement_ids
        .map((rid) => requirementById.get(rid))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => ({ id: r.id, text: r.text, priority: r.priority })),
    };
  });

  return orderCards(cards);
}

export async function recordAnswer(
  userId: string,
  kitId: string,
  cardId: string,
  confidence: Confidence,
): Promise<{ ok: true }> {
  const { body, kitId: id, userId: owner } = await loadKitBody(userId, kitId);

  if (!body.flashcards.some((card) => card.id === cardId)) {
    throw new AppError("NOT_FOUND", "That card is not in this kit.");
  }

  await PracticeRecord.updateOne(
    { kitId: id, cardId },
    {
      $set: { confidence, lastSeenAt: new Date(), userId: owner },
      $inc: { seenCount: 1 },
      $setOnInsert: { kitId: id, cardId },
    },
    { upsert: true },
  );

  return { ok: true };
}

export async function getStats(userId: string, kitId: string): Promise<PracticeStats> {
  const { body, kitId: id, userId: owner } = await loadKitBody(userId, kitId);
  const records = await PracticeRecord.find({ kitId: id, userId: owner });
  const byCard = recordsByCard(records);

  const byConfidence = { "1": 0, "2": 0, "3": 0 } as Record<"1" | "2" | "3", number>;
  for (const record of records) {
    const key = String(record.confidence) as "1" | "2" | "3";
    if (key in byConfidence) byConfidence[key] += 1;
  }

  const byRequirement = body.role.requirements.map((requirement) => {
    const cards = body.flashcards.filter((card) =>
      card.requirement_ids.includes(requirement.id),
    );
    const seen = cards.filter((card) => byCard.has(card.id));
    // "Shaky" is anything the user rated 1, the signal worth acting on.
    const shaky = seen.filter((card) => byCard.get(card.id)?.confidence === 1);
    return {
      id: requirement.id,
      text: requirement.text,
      priority: requirement.priority,
      cards: cards.length,
      seen: seen.length,
      shaky: shaky.length,
    };
  });

  return {
    total: body.flashcards.length,
    seen: body.flashcards.filter((card) => byCard.has(card.id)).length,
    byConfidence,
    byRequirement,
  };
}

/** Practice history belongs to the kit; deleting one deletes the other. */
export async function deletePracticeForKit(
  kitId: mongoose.Types.ObjectId,
): Promise<void> {
  await PracticeRecord.deleteMany({ kitId });
}
