import { describe, expect, it } from "vitest";
import { validateKitBody, type EvaluateCase } from "@prep/shared";
import { runBatch } from "../../src/cli/runBatch.js";
import { silentLogger, stubLlm } from "../helpers/stubLlm.js";
import { EXTRACTED_REQUIREMENTS, FULL_JD } from "../fixtures/jd.js";

const handlers = {
  extractRequirements: EXTRACTED_REQUIREMENTS,
  writeBrief: {
    summary: "Acme Payments runs payout rails.",
    what_they_do: "A ledger and payout API for marketplaces.",
    how_they_hire: "",
  },
  "generateQuestions:technical": {
    questions: [
      {
        requirement_ids: ["r1", "r2", "r3"],
        prompt: "How would you keep a ledger consistent under retries?",
        answer_outline: "Idempotency keys, an outbox, and reconciliation.",
        difficulty: 3,
      },
    ],
  },
  "generateQuestions:behavioural": {
    questions: [
      {
        requirement_ids: ["r4"],
        prompt: "Tell me about mentoring someone through a hard change.",
        answer_outline: "Situation, your support, the outcome.",
        difficulty: 2,
      },
    ],
  },
  "generateQuestions:system-design": {
    questions: [
      {
        requirement_ids: ["r2"],
        prompt: "Design an exactly-once payout pipeline.",
        answer_outline: "Clarify scale, idempotency, outbox, reconciliation.",
        difficulty: 3,
      },
    ],
  },
  "generateQuestions:company-fit": {
    questions: [
      {
        requirement_ids: [],
        prompt: "Why payouts?",
        answer_outline: "Connect their problem to your experience.",
        difficulty: 1,
      },
    ],
  },
  generateFlashcards: {
    flashcards: [
      { front: "Outbox pattern", back: "Write the event in the same transaction.", requirement_ids: ["r1"] },
    ],
  },
};

const goodCase: EvaluateCase = {
  id: "case-1",
  jd: FULL_JD,
  company_url: "https://acme.test",
  days: 5,
};

const badCase: EvaluateCase = { id: "case-2", jd: "  ", company_url: "", days: 3 };

describe("runBatch", () => {
  it("writes the Appendix B envelope", async () => {
    const { llm } = stubLlm(handlers);
    const output = await runBatch([goodCase], { llm, logger: silentLogger });

    expect(output.version).toBe("1.0");
    expect(Number.isNaN(Date.parse(output.generated_at))).toBe(false);
    expect(output.kits).toHaveLength(1);
    expect(output.kits[0]!.status).toBe("ok");
    expect(validateKitBody(output.kits[0]!.kit).ok).toBe(true);
  });

  it("returns one entry per case and keeps going after a failure", async () => {
    const { llm } = stubLlm(handlers);
    const output = await runBatch([badCase, goodCase, badCase], {
      llm,
      logger: silentLogger,
    });

    expect(output.kits.map((k) => k.id)).toEqual(["case-2", "case-1", "case-2"]);
    expect(output.kits.map((k) => k.status)).toEqual(["failed", "ok", "failed"]);
    expect(output.kits[0]!.error?.code).toBe("INVALID_INPUT");
    expect(output.kits[0]!.kit).toBeUndefined();
  });

  it("reports a failing case rather than throwing", async () => {
    const { llm } = stubLlm({});
    const output = await runBatch([goodCase], { llm, logger: silentLogger });

    expect(output.kits[0]!.status).toBe("failed");
    expect(output.kits[0]!.error?.message).toMatch(/extractRequirements/);
  });

  it("reports progress for every case", async () => {
    const events: string[] = [];
    const { llm } = stubLlm(handlers);
    await runBatch([goodCase, badCase], { llm, logger: silentLogger }, (event) =>
      events.push(`${event.id}:${event.status}`),
    );

    expect(events).toEqual(["case-1:ok", "case-2:failed"]);
  });
});
