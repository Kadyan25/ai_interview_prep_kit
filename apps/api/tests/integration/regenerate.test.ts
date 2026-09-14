import { describe, expect, it } from "vitest";
import type { ItemStateMap, KitBody, QuestionCategory } from "@prep/shared";
import { validateKitBody } from "@prep/shared";
import { assertRegenerable, regenerateCategory, regenerateSchedule } from "../../src/services/regenerate.js";
import type { KitDoc } from "../../src/models/Kit.js";
import { silentLogger, stubLlm } from "../helpers/stubLlm.js";

/**
 * A regeneration plans from a snapshot and commits against the kit as it is then.
 * That keeps them testable without a database — only the write itself is Mongo's
 * job, and these tests are about what gets written.
 */

function body(): KitBody {
  return {
    source: {
      company: "Acme",
      company_url: "https://acme.test",
      role: "Backend Engineer",
      location: "Remote",
      jd_chars: 900,
      researched_at: "2026-09-11T09:00:00.000Z",
      pages_used: ["https://acme.test/"],
    },
    company_brief: {
      summary: "Payout rails.",
      what_they_do: "A ledger for marketplaces.",
      sources: ["https://acme.test/"],
      how_they_hire: "Screen, take-home, design, fit.",
    },
    role: {
      title: "Backend Engineer",
      seniority: "senior",
      responsibilities: ["Own payouts"],
      requirements: [
        { id: "r1", text: "Node.js and TypeScript", kind: "technical", priority: "must" },
        { id: "r2", text: "Mentoring", kind: "behavioural", priority: "must" },
      ],
    },
    questions: [
      q("q1", "technical", "Generated technical one"),
      q("q2", "technical", "Generated technical two"),
      q("q3", "technical", "The one the user rewrote"),
      q("q4", "technical", "The one the user pinned"),
      q("q5", "behavioural", "A behavioural question", ["r2"]),
    ],
    flashcards: [{ id: "f1", front: "Front", back: "Back", requirement_ids: ["r1"] }],
    schedule: {
      days_available: 3,
      days: [
        { day: 1, focus: "Technical", question_ids: ["q1", "q2"], minutes: 50 },
        { day: 2, focus: "Technical", question_ids: ["q3", "q4", "q5"], minutes: 75 },
        { day: 3, focus: "Review: Technical", question_ids: ["q1"], minutes: 25 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

function q(id: string, category: QuestionCategory, prompt: string, requirementIds = ["r1"]) {
  return {
    id,
    requirement_ids: requirementIds,
    category,
    prompt,
    answer_outline: `Outline for ${id}`,
    difficulty: 2 as const,
  };
}

function itemState(overrides: ItemStateMap = {}): ItemStateMap {
  const base: ItemStateMap = {
    r1: { origin: "generated", pinned: false },
    r2: { origin: "generated", pinned: false },
    q1: { origin: "generated", pinned: false },
    q2: { origin: "generated", pinned: false },
    q3: { origin: "edited", pinned: false },
    q4: { origin: "generated", pinned: true },
    q5: { origin: "generated", pinned: false },
    f1: { origin: "generated", pinned: false },
    company_brief: { origin: "generated", pinned: false },
    schedule: { origin: "generated", pinned: false },
  };
  return { ...base, ...overrides };
}

function kitDoc(overrides: Partial<KitDoc> = {}): KitDoc {
  return {
    input: { jd: "A job description long enough to matter.", companyUrl: "https://acme.test", days: 3 },
    body: body(),
    itemState: itemState(),
    counters: { r: 2, q: 5, f: 1 },
    research: { hiringPageUrl: null, hiringProcess: null, discussion: [], skipped: [] },
    ...overrides,
  } as unknown as KitDoc;
}

const freshTechnical = {
  "generateQuestions:technical": {
    questions: [
      {
        requirement_ids: ["r1"],
        prompt: "A brand new technical question",
        answer_outline: "New outline",
        difficulty: 3,
      },
      {
        requirement_ids: ["r1"],
        prompt: "Another brand new one",
        answer_outline: "New outline",
        difficulty: 2,
      },
    ],
  },
};

const noop = async () => undefined;

/** Runs a category regeneration and commits it against `current` (the snapshot by default). */
async function regen(
  category: QuestionCategory,
  handlers: Record<string, unknown>,
  snapshot: KitDoc = kitDoc(),
  current: KitDoc = snapshot,
) {
  const { llm, calls } = stubLlm(handlers);
  const plan = await regenerateCategory(snapshot, category, { llm, logger: silentLogger }, noop);
  const result = plan.commit(current);
  return { ...result, next: written(current, result.set), calls };
}

/** The kit body after a `$set` with dotted paths, as Mongo would store it. */
function written(current: KitDoc, set: Record<string, unknown>): KitBody {
  const next = structuredClone(current.body) as KitBody;
  if (set["body.questions"]) next.questions = set["body.questions"] as KitBody["questions"];
  if (set["body.coverage"]) next.coverage = set["body.coverage"] as KitBody["coverage"];
  if (set["body.schedule"]) next.schedule = set["body.schedule"] as KitBody["schedule"];
  if (set["body.company_brief"]) next.company_brief = set["body.company_brief"] as KitBody["company_brief"];
  return next;
}

describe("regenerateCategory", () => {
  it("keeps edited, manual and pinned questions and replaces the rest", async () => {
    const { next } = await regen("technical", freshTechnical);
    const prompts = next.questions.map((question) => question.prompt);

    expect(prompts).toContain("The one the user rewrote");
    expect(prompts).toContain("The one the user pinned");
    expect(prompts).not.toContain("Generated technical one");
    expect(prompts).not.toContain("Generated technical two");
    expect(prompts).toContain("A brand new technical question");
  });

  it("writes only the question, coverage and schedule paths, never the whole body", async () => {
    const { set } = await regen("technical", freshTechnical);
    expect(Object.keys(set).sort()).toEqual(["body.coverage", "body.questions", "body.schedule", "counters", "itemState"]);
  });

  it("leaves every other category untouched", async () => {
    const { next } = await regen("technical", freshTechnical);
    const behavioural = next.questions.filter((question) => question.category === "behavioural");
    expect(behavioural.map((question) => question.id)).toEqual(["q5"]);
    expect(behavioural[0]!.prompt).toBe("A behavioural question");
  });

  it("gives new questions unused ids and advances the counter", async () => {
    const { next, set } = await regen("technical", freshTechnical);
    expect(next.questions.map((question) => question.id)).toContain("q6");
    expect(next.questions.map((question) => question.id)).toContain("q7");
    expect((set.counters as { q: number }).q).toBe(7);
  });

  it("drops the replaced questions from the item state", async () => {
    const { set } = await regen("technical", freshTechnical);
    const state = set.itemState as ItemStateMap;
    expect(state.q1).toBeUndefined();
    expect(state.q2).toBeUndefined();
    expect(state.q3).toEqual({ origin: "edited", pinned: false });
    expect(state.q4).toEqual({ origin: "generated", pinned: true });
    expect(state.q6).toEqual({ origin: "generated", pinned: false });
  });

  it("puts new questions in the replaced questions' places, keeping the user's order", async () => {
    const reordered = kitDoc();
    const [a, b, c, d, e] = reordered.body!.questions;
    reordered.body!.questions = [c!, a!, d!, b!, e!]; // q3, q1, q4, q2, q5
    const { next } = await regen("technical", freshTechnical, reordered);
    expect(next.questions.map((question) => question.id)).toEqual(["q3", "q6", "q4", "q7", "q5"]);
  });

  it("removes replaced questions from the schedule", async () => {
    const { next } = await regen("technical", freshTechnical);
    const scheduled = next.schedule.days.flatMap((day) => day.question_ids);
    expect(scheduled).not.toContain("q1");
    expect(scheduled).not.toContain("q2");
  });

  it("re-plans the schedule when the user has not edited it", async () => {
    const { next, scheduleStale } = await regen("technical", freshTechnical);
    const scheduled = new Set(next.schedule.days.flatMap((day) => day.question_ids));
    for (const question of next.questions) {
      expect(scheduled.has(question.id), `${question.id} should be scheduled`).toBe(true);
    }
    expect(scheduleStale).toBeUndefined();
  });

  it("leaves a hand-edited or pinned schedule alone and flags it as stale", async () => {
    for (const schedule of [
      { origin: "edited" as const, pinned: false },
      { origin: "generated" as const, pinned: true },
    ]) {
      const { next, scheduleStale } = await regen("technical", freshTechnical, kitDoc({ itemState: itemState({ schedule }) }));
      expect(scheduleStale).toBe(true);
      // Day 2 keeps the user's own ordering, minus the questions that are gone.
      expect(next.schedule.days[1]!.question_ids).toEqual(["q3", "q4", "q5"]);
    }
  });

  it("covers a must-have the new questions leave bare, without counting a generation pass", async () => {
    const { next, calls } = await regen("behavioural", { "generateQuestions:behavioural": { questions: [] } });
    // q5 was the only behavioural question and nothing replaced it: a gap call is
    // made, and when that yields nothing code writes a question so r2 is covered.
    expect(calls.map((call) => call.task)).toContain("generateForGaps:behavioural");
    expect(next.coverage.uncovered_requirement_ids).toEqual([]);
    expect(next.questions.some((question) => question.requirement_ids.includes("r2"))).toBe(true);
    expect(next.coverage.passes).toBe(1);
  });

  it("always returns a kit that still validates", async () => {
    const { next } = await regen("technical", freshTechnical);
    expect(validateKitBody(next).ok).toBe(true);
  });

  it("ignores a generated question that cites a requirement which does not exist", async () => {
    const { next } = await regen("technical", {
      "generateQuestions:technical": {
        questions: [{ requirement_ids: ["r99"], prompt: "Cites nothing real", answer_outline: "Outline", difficulty: 2 }],
      },
    });
    expect(next.questions.map((question) => question.prompt)).not.toContain("Cites nothing real");
    expect(validateKitBody(next).ok).toBe(true);
  });
});

describe("edits made while a regeneration runs", () => {
  it("keeps a question the user edited after the job started", async () => {
    const snapshot = kitDoc();
    const current = kitDoc();
    current.body!.questions[0] = { ...current.body!.questions[0]!, prompt: "Edited mid-regeneration" };
    current.itemState = itemState({ q1: { origin: "edited", pinned: false } });

    const { next, set } = await regen("technical", freshTechnical, snapshot, current);
    expect(next.questions.map((question) => question.prompt)).toContain("Edited mid-regeneration");
    expect((set.itemState as ItemStateMap).q1).toEqual({ origin: "edited", pinned: false });
  });

  it("does not touch flashcards, the brief or requirements edited meanwhile", async () => {
    const current = kitDoc();
    current.body!.flashcards[0] = { ...current.body!.flashcards[0]!, back: "Edited back" };
    current.body!.company_brief = { ...current.body!.company_brief, summary: "Edited summary" };

    const { next, set } = await regen("technical", freshTechnical, kitDoc(), current);
    expect(next.flashcards[0]!.back).toBe("Edited back");
    expect(next.company_brief.summary).toBe("Edited summary");
    expect(Object.keys(set).some((key) => key.includes("flashcards") || key.includes("brief"))).toBe(false);
  });
});

describe("regenerateSchedule", () => {
  it("re-plans over the current questions and resets only the schedule's state", () => {
    const current = kitDoc({ itemState: itemState({ schedule: { origin: "edited", pinned: false } }) });
    const { set } = regenerateSchedule().commit(current);

    const schedule = set["body.schedule"] as KitBody["schedule"];
    expect(schedule.days).toHaveLength(3);
    expect(set["itemState.schedule"]).toEqual({ origin: "generated", pinned: false });
    expect(set.itemState).toBeUndefined();
    expect(new Set(schedule.days.flatMap((day) => day.question_ids)).size).toBeGreaterThanOrEqual(5);
  });

  it("refuses to re-plan a pinned schedule", () => {
    const pinned = kitDoc({ itemState: itemState({ schedule: { origin: "generated", pinned: true } }) });
    expect(() => regenerateSchedule().commit(pinned)).toThrow(/pinned/);
  });
});

describe("assertRegenerable", () => {
  it("refuses a pinned brief before any model call", () => {
    const pinned = kitDoc({ itemState: itemState({ company_brief: { origin: "generated", pinned: true } }) });
    expect(() => assertRegenerable(pinned, "brief")).toThrow(/pinned/);
  });

  it("refuses a category the posting has nothing for", () => {
    const technicalOnly = kitDoc();
    technicalOnly.body!.role.requirements = technicalOnly.body!.role.requirements.filter((r) => r.kind !== "behavioural");
    expect(() => assertRegenerable(technicalOnly, "category", "behavioural")).toThrow(/nothing to regenerate/);
    expect(() => assertRegenerable(technicalOnly, "category", "company-fit")).not.toThrow();
  });
});
