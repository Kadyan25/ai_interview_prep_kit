import { describe, expect, it } from "vitest";
import type { Requirement } from "@prep/shared";
import { alignCitations, checkCoverage, stripDanglingIds } from "../../src/pipeline/coverage.js";

const requirements: Requirement[] = [
  { id: "r1", text: "TypeScript", kind: "technical", priority: "must" },
  { id: "r2", text: "Payments domain", kind: "domain", priority: "nice" },
  { id: "r3", text: "Mentoring", kind: "behavioural", priority: "must" },
];

const tech = (ids: string[]) => ({ category: "technical" as const, requirement_ids: ids });
const behav = (ids: string[]) => ({ category: "behavioural" as const, requirement_ids: ids });

describe("checkCoverage", () => {
  it("reports requirements that no question names", () => {
    const report = checkCoverage(requirements, [tech(["r1"])]);
    expect(report.uncoveredIds).toEqual(["r2", "r3"]);
    expect(report.coveredIds).toEqual(["r1"]);
  });

  it("separates must-have gaps from nice-to-have gaps", () => {
    const report = checkCoverage(requirements, [
      tech(["r1"]),
      behav(["r3"]),
    ]);
    expect(report.uncoveredIds).toEqual(["r2"]);
    expect(report.uncoveredMustIds).toEqual([]);
  });

  it("finds nothing uncovered when every requirement is cited", () => {
    const report = checkCoverage(requirements, [
      tech(["r1", "r2"]),
      behav(["r3"]),
    ]);
    expect(report.uncoveredIds).toEqual([]);
  });

  it("treats a kit with no questions as fully uncovered", () => {
    const report = checkCoverage(requirements, []);
    expect(report.uncoveredIds).toEqual(["r1", "r2", "r3"]);
    expect(report.uncoveredMustIds).toEqual(["r1", "r3"]);
  });

  it("counts nothing as covered when the kit has no requirements", () => {
    const report = checkCoverage([], [tech([])]);
    expect(report.uncoveredIds).toEqual([]);
  });
});

describe("stripDanglingIds", () => {
  it("removes ids that no requirement matches", () => {
    const { questions, removed } = stripDanglingIds(
      [
        { requirement_ids: ["r1", "r9"] },
        { requirement_ids: ["r2"] },
      ],
      requirements,
    );
    expect(questions[0]!.requirement_ids).toEqual(["r1"]);
    expect(questions[1]!.requirement_ids).toEqual(["r2"]);
    expect(removed).toBe(1);
  });

  it("leaves clean questions untouched", () => {
    const input = [{ requirement_ids: ["r1"] }];
    const { questions, removed } = stripDanglingIds(input, requirements);
    expect(removed).toBe(0);
    expect(questions[0]).toBe(input[0]);
  });

  it("stops an invented id from reading as coverage", () => {
    const raw = [{ requirement_ids: ["r7"] }];
    const { questions } = stripDanglingIds(raw, requirements);
    const report = checkCoverage(requirements, questions.map((q) => ({ ...q, category: "technical" as const })));
    expect(report.uncoveredIds).toEqual(["r1", "r2", "r3"]);
  });
});

describe("what counts as covering", () => {
  it("does not let a technical question cover a behavioural requirement by citing it", () => {
    const report = checkCoverage(requirements, [tech(["r1", "r2", "r3"])]);
    expect(report.uncoveredMustIds).toEqual(["r3"]);
  });

  it("counts at most three citations from one question", () => {
    const many: Requirement[] = ["r1", "r2", "r3", "r4", "r5"].map((id) => ({
      id,
      text: id,
      kind: "technical",
      priority: "must",
    }));
    const report = checkCoverage(many, [tech(["r1", "r2", "r3", "r4", "r5"])]);
    expect(report.uncoveredIds).toEqual(["r4", "r5"]);
  });

  it("rewrites citations to what counts and drops a question left with nothing", () => {
    const { questions, dropped } = alignCitations(
      [tech(["r3", "r1"]), tech(["r3"]), { category: "company-fit" as const, requirement_ids: [] }],
      requirements,
    );
    expect(questions.map((q) => q.requirement_ids)).toEqual([["r1"], []]);
    expect(dropped).toBe(1);
  });
});
