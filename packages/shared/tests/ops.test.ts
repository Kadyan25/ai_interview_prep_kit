import { describe, expect, it } from "vitest";
import { OpsError, applyOps, parseOps, sectionForOp, type KitState } from "../src/ops.js";
import type { ItemStateMap } from "../src/types.js";
import { validKit } from "./fixtures/validKit.js";

function state(): KitState {
  const body = validKit();
  const itemState: ItemStateMap = {};
  for (const r of body.role.requirements) itemState[r.id] = { origin: "generated", pinned: false };
  for (const q of body.questions) itemState[q.id] = { origin: "generated", pinned: false };
  for (const f of body.flashcards) itemState[f.id] = { origin: "generated", pinned: false };
  itemState.company_brief = { origin: "generated", pinned: false };
  itemState.schedule = { origin: "generated", pinned: false };

  return { body, itemState, counters: { r: 3, q: 3, f: 2 } };
}

const idsIn = (s: KitState, category: string) =>
  s.body.questions.filter((q) => q.category === category).map((q) => q.id);

describe("applyOps — updates", () => {
  it("edits a question and marks it edited", () => {
    const next = applyOps(state(), [
      { op: "update_question", id: "q1", fields: { prompt: "A sharper question." } },
    ]);

    expect(next.body.questions.find((q) => q.id === "q1")?.prompt).toBe("A sharper question.");
    expect(next.itemState.q1).toEqual({ origin: "edited", pinned: false });
  });

  it("leaves the original state untouched", () => {
    const before = state();
    const snapshot = JSON.stringify(before);
    applyOps(before, [{ op: "update_question", id: "q1", fields: { difficulty: 3 } }]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("keeps a manual item manual when it is edited again", () => {
    const added = applyOps(state(), [
      {
        op: "add_question",
        question: {
          requirement_ids: ["r1"],
          category: "technical",
          prompt: "Mine",
          answer_outline: "Outline",
          difficulty: 2,
        },
      },
    ]);
    expect(added.itemState.q4).toEqual({ origin: "manual", pinned: false });

    const edited = applyOps(added, [
      { op: "update_question", id: "q4", fields: { prompt: "Mine, revised" } },
    ]);
    expect(edited.itemState.q4!.origin).toBe("manual");
  });

  it("edits the brief and the schedule under their section keys", () => {
    const next = applyOps(state(), [
      { op: "update_brief", fields: { summary: "Rewritten." } },
      { op: "update_schedule_day", day: 1, fields: { minutes: 45 } },
    ]);

    expect(next.body.company_brief.summary).toBe("Rewritten.");
    expect(next.itemState.company_brief!.origin).toBe("edited");
    expect(next.body.schedule.days[0]!.minutes).toBe(45);
    expect(next.itemState.schedule!.origin).toBe("edited");
  });

  it("edits a requirement", () => {
    const next = applyOps(state(), [
      { op: "update_requirement", id: "r2", fields: { priority: "must" } },
    ]);
    expect(next.body.role.requirements.find((r) => r.id === "r2")?.priority).toBe("must");
    expect(next.itemState.r2!.origin).toBe("edited");
  });

  it("edits a flashcard", () => {
    const next = applyOps(state(), [
      { op: "update_flashcard", id: "f1", fields: { back: "A better answer." } },
    ]);
    expect(next.body.flashcards[0]!.back).toBe("A better answer.");
    expect(next.itemState.f1!.origin).toBe("edited");
  });
});

describe("applyOps — adding and deleting", () => {
  it("gives new items the next id and never reuses one", () => {
    let current = state();
    current = applyOps(current, [
      {
        op: "add_question",
        question: {
          requirement_ids: ["r1"],
          category: "technical",
          prompt: "First added",
          answer_outline: "Outline",
          difficulty: 1,
        },
      },
    ]);
    expect(current.counters.q).toBe(4);

    current = applyOps(current, [{ op: "delete_question", id: "q4" }]);
    expect(current.counters.q).toBe(4);

    current = applyOps(current, [
      {
        op: "add_question",
        question: {
          requirement_ids: ["r1"],
          category: "technical",
          prompt: "Second added",
          answer_outline: "Outline",
          difficulty: 1,
        },
      },
    ]);
    // q4 was deleted, so the next id is q5 and not q4 again.
    expect(current.body.questions.some((q) => q.id === "q5")).toBe(true);
    expect(current.body.questions.some((q) => q.id === "q4")).toBe(false);
  });

  it("removes a deleted question from every schedule day", () => {
    const before = state();
    expect(before.body.schedule.days.some((d) => d.question_ids.includes("q1"))).toBe(true);

    const next = applyOps(before, [{ op: "delete_question", id: "q1" }]);
    expect(next.body.questions.some((q) => q.id === "q1")).toBe(false);
    expect(next.body.schedule.days.some((d) => d.question_ids.includes("q1"))).toBe(false);
    expect(next.itemState.q1).toBeUndefined();
  });

  it("adds and deletes flashcards", () => {
    let current = applyOps(state(), [
      {
        op: "add_flashcard",
        flashcard: { front: "New front", back: "New back", requirement_ids: ["r1"] },
      },
    ]);
    expect(current.body.flashcards).toHaveLength(3);
    expect(current.itemState.f3!.origin).toBe("manual");

    current = applyOps(current, [{ op: "delete_flashcard", id: "f3" }]);
    expect(current.body.flashcards).toHaveLength(2);
    expect(current.itemState.f3).toBeUndefined();
  });

  it("refuses to delete something that is not there", () => {
    expect(() => applyOps(state(), [{ op: "delete_question", id: "q99" }])).toThrow(OpsError);
  });
});

describe("applyOps — ordering", () => {
  it("reorders one category without disturbing the others", () => {
    const before = applyOps(state(), [
      {
        op: "add_question",
        question: {
          requirement_ids: ["r1"],
          category: "technical",
          prompt: "Second technical",
          answer_outline: "Outline",
          difficulty: 1,
        },
      },
    ]);

    const behaviouralBefore = idsIn(before, "behavioural");
    const next = applyOps(before, [
      { op: "reorder_questions", category: "technical", ids: ["q4", "q1"] },
    ]);

    expect(idsIn(next, "technical")).toEqual(["q4", "q1"]);
    expect(idsIn(next, "behavioural")).toEqual(behaviouralBefore);
  });

  it("rejects a reorder naming a question from another category", () => {
    expect(() =>
      applyOps(state(), [{ op: "reorder_questions", category: "technical", ids: ["q2"] }]),
    ).toThrow(OpsError);
  });

  it("moves a question into another category at a position", () => {
    const next = applyOps(state(), [
      { op: "move_question", id: "q1", category: "behavioural", index: 0 },
    ]);

    expect(idsIn(next, "behavioural")[0]).toBe("q1");
    expect(idsIn(next, "technical")).toEqual([]);
    expect(next.itemState.q1!.origin).toBe("edited");
  });

  it("clamps an index past the end of the category", () => {
    const next = applyOps(state(), [
      { op: "move_question", id: "q2", category: "technical", index: 99 },
    ]);
    expect(idsIn(next, "technical")).toEqual(["q1", "q2"]);
  });

  it("accepts the end-of-list index the category picker sends", () => {
    const ops = parseOps([
      { op: "move_question", id: "q2", category: "technical", index: Number.MAX_SAFE_INTEGER },
    ]);
    expect(idsIn(applyOps(state(), ops), "technical").at(-1)).toBe("q2");
  });

  it("refuses to move a question with no requirement out of company fit", () => {
    const base = state();
    const orphan = { ...base.body.questions[0]!, id: "q9", category: "company-fit" as const, requirement_ids: [] };
    const withOrphan = applyOps(base, [{ op: "add_question", question: orphan }]);
    const added = withOrphan.body.questions.find((q) => q.prompt === orphan.prompt && q.category === "company-fit")!;
    expect(() =>
      applyOps(withOrphan, [{ op: "move_question", id: added.id, category: "technical", index: 0 }]),
    ).toThrow(OpsError);
  });
});

describe("applyOps — pinning", () => {
  it("pins and unpins without changing origin", () => {
    const pinned = applyOps(state(), [{ op: "pin", id: "q1" }]);
    expect(pinned.itemState.q1).toEqual({ origin: "generated", pinned: true });

    const unpinned = applyOps(pinned, [{ op: "unpin", id: "q1" }]);
    expect(unpinned.itemState.q1).toEqual({ origin: "generated", pinned: false });
  });

  it("refuses to pin something unknown", () => {
    expect(() => applyOps(state(), [{ op: "pin", id: "q99" }])).toThrow(OpsError);
  });
});

describe("applyOps — validity", () => {
  it("rejects the whole batch when the result would be invalid", () => {
    const before = state();
    // The second op is bad, so the first must not survive either.
    expect(() =>
      applyOps(before, [
        { op: "update_question", id: "q1", fields: { prompt: "Changed" } },
        { op: "update_question", id: "q1", fields: { requirement_ids: ["r99"] } },
      ]),
    ).toThrow(OpsError);
  });

  it("reports why the batch was rejected", () => {
    try {
      applyOps(state(), [
        { op: "update_question", id: "q1", fields: { requirement_ids: ["r99"] } },
      ]);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OpsError);
      expect((error as OpsError).details.join(" ")).toMatch(/unknown requirement r99/);
    }
  });

  it("applies several ops in order", () => {
    const next = applyOps(state(), [
      { op: "update_question", id: "q1", fields: { difficulty: 1 } },
      { op: "pin", id: "q1" },
      { op: "delete_question", id: "q2" },
    ]);

    expect(next.body.questions.find((q) => q.id === "q1")?.difficulty).toBe(1);
    expect(next.itemState.q1).toEqual({ origin: "edited", pinned: true });
    expect(next.body.questions.some((q) => q.id === "q2")).toBe(false);
  });
});

describe("parseOps", () => {
  it("accepts a well-formed batch", () => {
    const ops = parseOps([{ op: "pin", id: "q1" }]);
    expect(ops).toHaveLength(1);
  });

  it("rejects an unknown operation", () => {
    expect(() => parseOps([{ op: "drop_database" }])).toThrow(OpsError);
  });

  it("rejects an empty update", () => {
    expect(() => parseOps([{ op: "update_question", id: "q1", fields: {} }])).toThrow(OpsError);
  });

  it("rejects a blank prompt", () => {
    expect(() =>
      parseOps([{ op: "update_question", id: "q1", fields: { prompt: "   " } }]),
    ).toThrow(OpsError);
  });

  it("rejects an empty batch", () => {
    expect(() => parseOps([])).toThrow(OpsError);
  });
});

describe("sectionForOp", () => {
  it("maps each op to the section it touches", () => {
    expect(sectionForOp({ op: "update_brief", fields: { summary: "x" } })).toBe("brief");
    expect(sectionForOp({ op: "update_requirement", id: "r1", fields: { text: "x" } })).toBe("role");
    expect(sectionForOp({ op: "update_schedule_day", day: 1, fields: { minutes: 20 } })).toBe(
      "schedule",
    );
    expect(sectionForOp({ op: "delete_flashcard", id: "f1" })).toBe("flashcards");
    expect(sectionForOp({ op: "pin", id: "q1" })).toBe("questions");
  });
});
