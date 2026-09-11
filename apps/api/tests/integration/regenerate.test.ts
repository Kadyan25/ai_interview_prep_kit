import { describe, expect, it } from "vitest";
import type { ItemStateMap, KitBody, QuestionCategory } from "@prep/shared";
import { validateKitBody } from "@prep/shared";
import { regenerateCategory, regenerateSchedule } from "../../src/services/regenerate.js";
import type { KitDoc } from "../../src/models/Kit.js";
import { silentLogger, stubLlm } from "../helpers/stubLlm.js";

/**
 * The regeneration functions take a kit document and return the `$set` payload.
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

describe("regenerateCategory", () => {
  it("keeps edited, manual and pinned questions and replaces the rest", async () => {
    const { llm } = stubLlm(freshTechnical);
    const result = await regenerateCategory(
      kitDoc(),
      "technical",
      { llm, logger: silentLogger },
      noop,
    );

    const next = result.set.body as KitBody;
    const prompts = next.questions.map((question) => question.prompt);

    expect(prompts).toContain("The one the user rewrote");
    expect(prompts).toContain("The one the user pinned");
    expect(prompts).not.toContain("Generated technical one");
    expect(prompts).not.toContain("Generated technical two");
    expect(prompts).toContain("A brand new technical question");
  });

  it("leaves every other category untouched", async () => {
    const { llm } = stubLlm(freshTechnical);
    const result = await regenerateCategory(
      kitDoc(),
      "technical",
      { llm, logger: silentLogger },
      noop,
    );

    const next = result.set.body as KitBody;
    const behavioural = next.questions.filter((question) => question.category === "behavioural");
    expect(behavioural.map((question) => question.id)).toEqual(["q5"]);
    expect(behavioural[0]!.prompt).toBe("A behavioural question");
  });

  it("gives new questions unused ids and advances the counter", async () => {
    const { llm } = stubLlm(freshTechnical);
    const result = await regenerateCategory(
      kitDoc(),
      "technical",
      { llm, logger: silentLogger },
      noop,
    );

    const next = result.set.body as KitBody;
    const counters = result.set.counters as { q: number };
    expect(next.questions.map((question) => question.id)).toContain("q6");
    expect(next.questions.map((question) => question.id)).toContain("q7");
    expect(counters.q).toBe(7);
  });

  it("drops the replaced questions from the item state", async () => {
    const { llm } = stubLlm(freshTechnical);
    const result = await regenerateCategory(
      kitDoc(),
      "technical",
      { llm, logger: silentLogger },
      noop,
    );

    const state = result.set.itemState as ItemStateMap;
    expect(state.q1).toBeUndefined();
    expect(state.q2).toBeUndefined();
    expect(state.q3).toEqual({ origin: "edited", pinned: false });
    expect(state.q4).toEqual({ origin: "generated", pinned: true });
    expect(state.q6).toEqual({ origin: "generated", pinned: false });
  });

  it("removes replaced questions from the schedule", async () => {
    const { llm } = stubLlm(freshTechnical);
    const result = await regenerateCategory(
      kitDoc(),
      "technical",
      { llm, logger: silentLogger },
      noop,
    );

    const next = result.set.body as KitBody;
    const scheduled = next.schedule.days.flatMap((day) => day.question_ids);
    expect(scheduled).not.toContain("q1");
    expect(scheduled).not.toContain("q2");
  });

  it("re-plans the schedule when the user has not edited it", async () => {
    const { llm } = stubLlm(freshTechnical);
    const result = await regenerateCategory(
      kitDoc(),
      "technical",
      { llm, logger: silentLogger },
      noop,
    );

    const next = result.set.body as KitBody;
    const scheduled = new Set(next.schedule.days.flatMap((day) => day.question_ids));
    for (const question of next.questions) {
      expect(scheduled.has(question.id), `${question.id} should be scheduled`).toBe(true);
    }
    expect(result.scheduleStale).toBeUndefined();
  });

  it("leaves a hand-edited schedule alone and flags it as stale", async () => {
    const { llm } = stubLlm(freshTechnical);
    const result = await regenerateCategory(
      kitDoc({ itemState: itemState({ schedule: { origin: "edited", pinned: false } }) }),
      "technical",
      { llm, logger: silentLogger },
      noop,
    );

    const next = result.set.body as KitBody;
    expect(result.scheduleStale).toBe(true);
    // Day 2 keeps the user's own ordering, minus the questions that are gone.
    expect(next.schedule.days[1]!.question_ids).toEqual(["q3", "q4", "q5"]);
  });

  it("recomputes coverage in code and counts the pass", async () => {
    const { llm } = stubLlm({
      "generateQuestions:behavioural": { questions: [] },
    });
    const result = await regenerateCategory(
      kitDoc(),
      "behavioural",
      { llm, logger: silentLogger },
      noop,
    );

    const next = result.set.body as KitBody;
    // q5 was the only behavioural question and nothing replaced it, so r2 is bare.
    expect(next.coverage.uncovered_requirement_ids).toEqual(["r2"]);
    expect(next.coverage.passes).toBe(2);
  });

  it("always returns a kit that still validates", async () => {
    const { llm } = stubLlm(freshTechnical);
    const result = await regenerateCategory(
      kitDoc(),
      "technical",
      { llm, logger: silentLogger },
      noop,
    );
    expect(validateKitBody(result.set.body).ok).toBe(true);
  });

  it("ignores a generated question that cites a requirement which does not exist", async () => {
    const { llm } = stubLlm({
      "generateQuestions:technical": {
        questions: [
          {
            requirement_ids: ["r99"],
            prompt: "Cites nothing real",
            answer_outline: "Outline",
            difficulty: 2,
          },
        ],
      },
    });

    const result = await regenerateCategory(
      kitDoc(),
      "technical",
      { llm, logger: silentLogger },
      noop,
    );

    const next = result.set.body as KitBody;
    expect(next.questions.map((question) => question.prompt)).not.toContain("Cites nothing real");
    expect(validateKitBody(next).ok).toBe(true);
  });
});

describe("regenerateSchedule", () => {
  it("re-plans over the current questions and resets the schedule origin", () => {
    const result = regenerateSchedule(
      kitDoc({ itemState: itemState({ schedule: { origin: "edited", pinned: false } }) }),
    );

    const schedule = result.set["body.schedule"] as KitBody["schedule"];
    const state = result.set.itemState as ItemStateMap;

    expect(schedule.days).toHaveLength(3);
    expect(state.schedule).toEqual({ origin: "generated", pinned: false });

    const scheduled = new Set(schedule.days.flatMap((day) => day.question_ids));
    expect(scheduled.size).toBeGreaterThanOrEqual(5);
  });
});
