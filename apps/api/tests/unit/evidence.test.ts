import { describe, expect, it } from "vitest";
import {
  applyEvidenceRules,
  derivePriority,
  findEvidence,
  normaliseForMatch,
} from "../../src/pipeline/steps/evidence.js";
import type { DraftRequirement } from "../../src/pipeline/types.js";

const jd = `Senior Backend Engineer

You will own our payments ledger.

Requirements:
- 5+ years of professional experience with Node.js and TypeScript is required
- Strong grasp of relational databases
- Experience with Kubernetes is nice to have
- Familiarity with event sourcing is a bonus

You will mentor two junior engineers.`;

function draft(partial: Partial<DraftRequirement>): DraftRequirement {
  return {
    text: "something",
    kind: "technical",
    priority: "must",
    evidence: "",
    ...partial,
  };
}

describe("findEvidence", () => {
  it("matches a quote regardless of spacing and case", () => {
    expect(findEvidence(jd, "5+ YEARS   of professional experience")).toBeGreaterThanOrEqual(0);
  });

  it("does not match text that is not in the posting", () => {
    expect(findEvidence(jd, "experience with Kafka and Flink")).toBe(-1);
  });

  it("refuses a quote too short to prove anything", () => {
    expect(findEvidence(jd, "you")).toBe(-1);
  });
});

describe("normaliseForMatch", () => {
  it("collapses whitespace and smart quotes", () => {
    expect(normaliseForMatch("  We’re   hiring\n")).toBe("we're hiring");
  });
});

describe("derivePriority", () => {
  it("downgrades to nice when the posting says nice to have", () => {
    const result = derivePriority(jd, "Experience with Kubernetes", "must");
    expect(result.priority).toBe("nice");
    expect(result.cue).toBe("nice to have");
  });

  it("downgrades to nice when the posting says bonus", () => {
    expect(derivePriority(jd, "Familiarity with event sourcing", "must").priority).toBe("nice");
  });

  it("upgrades to must when the posting says required", () => {
    const result = derivePriority(jd, "5+ years of professional experience", "nice");
    expect(result.priority).toBe("must");
  });

  it("keeps the model's answer when no cue is nearby", () => {
    const plain = "We build billing software. You will work on the ledger service every day.";
    const result = derivePriority(plain, "You will work on the ledger service", "nice");
    expect(result.priority).toBe("nice");
    expect(result.cue).toBeNull();
  });

  it("keeps the model's answer when the quote is not in the posting", () => {
    expect(derivePriority(jd, "experience with Kafka", "nice").priority).toBe("nice");
  });

  it("does not borrow a cue from a neighbouring bullet", () => {
    // "nice to have" sits two lines above; the heading decides instead of it.
    const result = derivePriority(jd, "You will mentor two junior engineers", "must");
    expect(result.priority).toBe("must");
    expect(result.cue).toBe("requirements");
  });

  it("takes the cue from the section heading when the bullet has none", () => {
    const posting = `Backend Engineer

Nice to have:
- Terraform
- Experience running Postgres in production`;
    const result = derivePriority(posting, "Experience running Postgres in production", "must");
    expect(result.priority).toBe("nice");
    expect(result.cue).toBe("nice to have");
  });
});

describe("applyEvidenceRules", () => {
  it("drops requirements whose evidence is not in the posting", () => {
    const outcome = applyEvidenceRules(jd, [
      draft({ text: "Node.js and TypeScript", evidence: "Node.js and TypeScript is required" }),
      draft({ text: "Kafka streaming", evidence: "deep experience with Kafka streaming" }),
    ]);

    expect(outcome.kept.map((r) => r.text)).toEqual(["Node.js and TypeScript"]);
    expect(outcome.dropped).toHaveLength(1);
    expect(outcome.dropped[0]!.text).toBe("Kafka streaming");
  });

  it("records a priority the posting contradicts", () => {
    const outcome = applyEvidenceRules(jd, [
      draft({
        text: "Kubernetes",
        priority: "must",
        evidence: "Experience with Kubernetes is nice to have",
      }),
    ]);

    expect(outcome.kept[0]!.priority).toBe("nice");
    expect(outcome.reprioritised).toHaveLength(1);
    expect(outcome.reprioritised[0]).toMatchObject({ from: "must", to: "nice" });
  });

  it("removes duplicate requirements", () => {
    const outcome = applyEvidenceRules(jd, [
      draft({ text: "Relational databases", evidence: "Strong grasp of relational databases" }),
      draft({ text: "relational   databases", evidence: "Strong grasp of relational databases" }),
    ]);
    expect(outcome.kept).toHaveLength(1);
  });

  it("keeps behavioural requirements that are quoted", () => {
    const outcome = applyEvidenceRules(jd, [
      draft({
        text: "Mentors junior engineers",
        kind: "behavioural",
        evidence: "You will mentor two junior engineers",
      }),
    ]);
    expect(outcome.kept).toHaveLength(1);
    expect(outcome.kept[0]!.kind).toBe("behavioural");
  });

  it("returns nothing when nothing can be quoted", () => {
    const outcome = applyEvidenceRules("A two line posting. Apply now.", [
      draft({ text: "Ten years of Rust", evidence: "ten years of Rust in production" }),
    ]);
    expect(outcome.kept).toEqual([]);
    expect(outcome.dropped).toHaveLength(1);
  });
});
