import { describe, expect, it } from "vitest";
import { orderCards, type PracticeCard } from "../../src/services/practice.js";

function card(
  id: string,
  confidence: 1 | 2 | 3 | null,
  lastSeenAt: string | null,
  seenCount = confidence === null ? 0 : 1,
): PracticeCard {
  return {
    id,
    front: `Front ${id}`,
    back: `Back ${id}`,
    requirement_ids: [],
    seenCount,
    confidence,
    lastSeenAt,
    requirements: [],
  };
}

const ids = (cards: PracticeCard[]) => cards.map((c) => c.id);

describe("orderCards", () => {
  it("puts cards you have never seen first", () => {
    const ordered = orderCards([
      card("f1", 3, "2026-09-10T10:00:00.000Z"),
      card("f2", null, null),
      card("f3", 1, "2026-09-10T10:00:00.000Z"),
    ]);
    expect(ids(ordered)[0]).toBe("f2");
  });

  it("then orders by how shaky you felt, weakest first", () => {
    const ordered = orderCards([
      card("f1", 3, "2026-09-10T10:00:00.000Z"),
      card("f2", 1, "2026-09-10T10:00:00.000Z"),
      card("f3", 2, "2026-09-10T10:00:00.000Z"),
    ]);
    expect(ids(ordered)).toEqual(["f2", "f3", "f1"]);
  });

  it("breaks a confidence tie with whatever has waited longest", () => {
    const ordered = orderCards([
      card("f1", 2, "2026-09-11T10:00:00.000Z"),
      card("f2", 2, "2026-09-09T10:00:00.000Z"),
      card("f3", 2, "2026-09-10T10:00:00.000Z"),
    ]);
    expect(ids(ordered)).toEqual(["f2", "f3", "f1"]);
  });

  it("is stable for cards that are identical apart from their id", () => {
    const ordered = orderCards([card("f10", null, null), card("f2", null, null)]);
    expect(ids(ordered)).toEqual(["f2", "f10"]);
  });

  it("combines the three rules in one pass", () => {
    const ordered = orderCards([
      card("f1", 3, "2026-09-01T10:00:00.000Z"),
      card("f2", null, null),
      card("f3", 1, "2026-09-11T10:00:00.000Z"),
      card("f4", 2, "2026-09-02T10:00:00.000Z"),
      card("f5", null, null),
      card("f6", 1, "2026-09-05T10:00:00.000Z"),
    ]);
    // unseen, then confidence 1 (oldest first), then 2, then 3
    expect(ids(ordered)).toEqual(["f2", "f5", "f6", "f3", "f4", "f1"]);
  });

  it("does not mutate the array it was given", () => {
    const input = [card("f1", 3, null), card("f2", 1, null)];
    const snapshot = ids(input);
    orderCards(input);
    expect(ids(input)).toEqual(snapshot);
  });

  it("handles an empty deck", () => {
    expect(orderCards([])).toEqual([]);
  });
});
