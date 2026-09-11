import { describe, expect, it } from "vitest";
import { validateKitBody } from "@prep/shared";
import { runPipeline } from "../../src/pipeline/runPipeline.js";
import type { PipelineDeps } from "../../src/pipeline/types.js";
import { silentLogger, stubLlm } from "../helpers/stubLlm.js";
import { EXTRACTED_REQUIREMENTS, FULL_JD, THIN_JD } from "../fixtures/jd.js";

const brief = {
  summary: "Acme Payments runs the payout rails for online marketplaces.",
  what_they_do: "A double-entry ledger and payout API used by marketplaces in the EU.",
  how_they_hire: "",
};

function fullHandlers(overrides: Record<string, unknown> = {}) {
  return {
    extractRequirements: EXTRACTED_REQUIREMENTS,
    writeBrief: brief,
    "generateQuestions:technical": {
      questions: [
        {
          requirement_ids: ["r1"],
          prompt: "How do you find a memory leak in a long-running Node service?",
          answer_outline: "Reproduce, take heap snapshots, compare retained sets, fix, verify.",
          difficulty: 2,
        },
        {
          requirement_ids: ["r2"],
          prompt: "How would you shard the ledger without breaking double-entry invariants?",
          answer_outline: "Pick a partition key, keep entries for a transfer together, reconcile.",
          difficulty: 3,
        },
      ],
    },
    "generateQuestions:behavioural": {
      questions: [
        {
          requirement_ids: ["r4"],
          prompt: "Tell me about a junior engineer you helped level up.",
          answer_outline: "Situation, what you noticed, the support you gave, where they got to.",
          difficulty: 1,
        },
      ],
    },
    "generateQuestions:system-design": {
      questions: [
        {
          requirement_ids: ["r2"],
          prompt: "Design a payout system that guarantees exactly-once transfers.",
          answer_outline: "Clarify volumes, idempotency keys, outbox, reconciliation, failure modes.",
          difficulty: 3,
        },
      ],
    },
    "generateQuestions:company-fit": {
      questions: [
        {
          requirement_ids: [],
          prompt: "Why work on payout infrastructure specifically?",
          answer_outline: "Tie their ledger problem to your own experience with money movement.",
          difficulty: 1,
        },
      ],
    },
    "generateForGaps:technical": {
      questions: [
        {
          requirement_ids: ["r3"],
          prompt: "What makes reconciliation hard in a payments ledger?",
          answer_outline: "Timing differences, partial settlement, fees, currency rounding.",
          difficulty: 2,
        },
      ],
    },
    generateFlashcards: {
      flashcards: [
        { front: "Double-entry", back: "Every transfer writes a debit and a credit.", requirement_ids: ["r3"] },
        { front: "Idempotency key", back: "A client-supplied key that makes a retry safe.", requirement_ids: ["r1"] },
      ],
    },
    ...overrides,
  };
}

function deps(handlers: Record<string, unknown>): { deps: PipelineDeps; calls: { task: string }[] } {
  const { llm, calls } = stubLlm(handlers);
  return { deps: { llm, logger: silentLogger }, calls };
}

describe("runPipeline", () => {
  it("produces a kit that satisfies the contract", async () => {
    const { deps: d } = deps(fullHandlers());
    const result = await runPipeline(
      { jd: FULL_JD, companyUrl: "https://acme.test", days: 5 },
      d,
    );

    const validation = validateKitBody(result.body);
    expect(validation.ok, validation.ok ? "" : validation.errors.join("; ")).toBe(true);
    expect(result.status).toBe("ready");
  });

  it("drops a requirement the job description does not support", async () => {
    const { deps: d } = deps(fullHandlers());
    const { body } = await runPipeline(
      { jd: FULL_JD, companyUrl: "https://acme.test", days: 5 },
      d,
    );

    const texts = body.role.requirements.map((r) => r.text);
    expect(texts).not.toContain("Kafka and Flink stream processing");
    expect(body.role.requirements).toHaveLength(4);
    expect(body.warnings?.join(" ")).toMatch(/could not be traced back/);
  });

  it("corrects a priority the posting contradicts", async () => {
    const { deps: d } = deps(fullHandlers());
    const { body } = await runPipeline(
      { jd: FULL_JD, companyUrl: "https://acme.test", days: 5 },
      d,
    );

    const payments = body.role.requirements.find((r) => r.text.includes("Payments domain"));
    expect(payments?.priority).toBe("nice");
  });

  it("asks for each question category in its own call", async () => {
    const { deps: d, calls } = deps(fullHandlers());
    await runPipeline({ jd: FULL_JD, companyUrl: "https://acme.test", days: 5 }, d);

    const tasks = calls.map((c) => c.task);
    expect(tasks).toContain("generateQuestions:technical");
    expect(tasks).toContain("generateQuestions:behavioural");
    expect(tasks).toContain("generateQuestions:system-design");
    expect(tasks).toContain("generateQuestions:company-fit");
  });

  it("runs a second coverage pass to close a gap", async () => {
    const { deps: d, calls } = deps(fullHandlers());
    const { body } = await runPipeline(
      { jd: FULL_JD, companyUrl: "https://acme.test", days: 5 },
      d,
    );

    expect(calls.map((c) => c.task)).toContain("generateForGaps:technical");
    expect(body.coverage.passes).toBe(2);
    expect(body.coverage.uncovered_requirement_ids).toEqual([]);
  });

  it("reports a gap honestly when the second pass cannot close it", async () => {
    const { deps: d } = deps(
      fullHandlers({ "generateForGaps:technical": { questions: [] } }),
    );
    const { body } = await runPipeline(
      { jd: FULL_JD, companyUrl: "https://acme.test", days: 5 },
      d,
    );

    expect(body.coverage.uncovered_requirement_ids).toEqual(["r3"]);
    expect(body.coverage.passes).toBe(2);
    expect(body.warnings?.join(" ")).toMatch(/nice-to-have/);
  });

  it("marks the kit partial when a required item has no question", async () => {
    const { deps: d } = deps(
      fullHandlers({
        "generateQuestions:behavioural": { questions: [] },
        "generateForGaps:behavioural": { questions: [] },
      }),
    );
    const result = await runPipeline(
      { jd: FULL_JD, companyUrl: "https://acme.test", days: 5 },
      d,
    );

    expect(result.body.coverage.uncovered_requirement_ids).toContain("r4");
    expect(result.status).toBe("partial");
    expect(result.body.warnings?.join(" ")).toMatch(/required item/);
  });

  it("spans exactly the requested number of days", async () => {
    for (const days of [1, 3, 14]) {
      const { deps: d } = deps(fullHandlers());
      const { body } = await runPipeline({ jd: FULL_JD, companyUrl: "", days }, d);
      expect(body.schedule.days_available).toBe(days);
      expect(body.schedule.days).toHaveLength(days);
    }
  });

  it("records the job description length and the sources actually used", async () => {
    const { deps: d } = deps(fullHandlers());
    const { body } = await runPipeline(
      { jd: FULL_JD, companyUrl: "https://acme.test", days: 5 },
      d,
    );

    expect(body.source.jd_chars).toBe(FULL_JD.trim().length);
    expect(body.source.company_url).toBe("https://acme.test/");
    expect(body.source.pages_used).toEqual([]);
    expect(body.company_brief.how_they_hire).toMatch(/No public description/);
  });

  it("still produces a valid kit from a two-line posting", async () => {
    const { deps: d } = deps({
      extractRequirements: {
        company: "",
        title: "Backend Engineer",
        seniority: "unspecified",
        location: "Remote",
        responsibilities: [],
        requirements: [],
      },
      writeBrief: brief,
      "generateQuestions:company-fit": {
        questions: [
          {
            requirement_ids: [],
            prompt: "What do you want to know about this team before you join?",
            answer_outline: "Ask about ownership, on-call and how work is prioritised.",
            difficulty: 1,
          },
        ],
      },
      generateFlashcards: { flashcards: [] },
    });

    const { body } = await runPipeline({ jd: THIN_JD, companyUrl: "", days: 3 }, d);

    expect(validateKitBody(body).ok).toBe(true);
    expect(body.role.requirements).toEqual([]);
    expect(body.warnings?.join(" ")).toMatch(/only \d+ words/);
    expect(body.schedule.days).toHaveLength(3);
  });

  it("repairs a kit whose questions cite requirements that do not exist", async () => {
    const { deps: d } = deps(
      fullHandlers({
        "generateQuestions:technical": {
          questions: [
            {
              requirement_ids: ["r99"],
              prompt: "A question about something the posting never mentioned.",
              answer_outline: "It should not survive assembly.",
              difficulty: 2,
            },
          ],
        },
      }),
    );

    const { body } = await runPipeline(
      { jd: FULL_JD, companyUrl: "https://acme.test", days: 4 },
      d,
    );

    expect(validateKitBody(body).ok).toBe(true);
    for (const question of body.questions) {
      for (const id of question.requirement_ids) {
        expect(body.role.requirements.some((r) => r.id === id)).toBe(true);
      }
    }
  });

  it("reports progress for every step it runs", async () => {
    const seen: { step: string; status: string }[] = [];
    const { llm } = stubLlm(fullHandlers());
    await runPipeline(
      { jd: FULL_JD, companyUrl: "https://acme.test", days: 5 },
      {
        llm,
        logger: silentLogger,
        onProgress: (step, status) => {
          seen.push({ step, status });
        },
      },
    );

    const names = new Set(seen.map((s) => s.step));
    expect(names).toContain("extract-requirements");
    expect(names).toContain("coverage");
    expect(names).toContain("assemble");
    expect(seen.some((s) => s.step === "crawl-company" && s.status === "skipped")).toBe(true);
  });

  it("refuses an empty job description", async () => {
    const { deps: d } = deps(fullHandlers());
    await expect(
      runPipeline({ jd: "   ", companyUrl: "https://acme.test", days: 3 }, d),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("is deterministic given the same model output", async () => {
    const a = await runPipeline(
      { jd: FULL_JD, companyUrl: "https://acme.test", days: 6 },
      deps(fullHandlers()).deps,
    );
    const b = await runPipeline(
      { jd: FULL_JD, companyUrl: "https://acme.test", days: 6 },
      deps(fullHandlers()).deps,
    );

    expect({ ...a.body.source, researched_at: "" }).toEqual({
      ...b.body.source,
      researched_at: "",
    });
    expect(a.body.questions).toEqual(b.body.questions);
    expect(a.body.schedule).toEqual(b.body.schedule);
  });
});
