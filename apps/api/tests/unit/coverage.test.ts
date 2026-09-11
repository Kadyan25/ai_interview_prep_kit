import { describe, expect, it } from "vitest";
import type { Requirement } from "@prep/shared";
import { checkCoverage, stripDanglingIds } from "../../src/pipeline/coverage.js";

const requirements: Requirement[] = [
  { id: "r1", text: "TypeScript", kind: "technical", priority: "must" },
  { id: "r2", text: "Payments domain", kind: "domain", priority: "nice" },
  { id: "r3", text: "Mentoring", kind: "behavioural", priority: "must" },
];

describe("checkCoverage", () => {
  it("reports requirements that no question names", () => {
    const report = checkCoverage(requirements, [
      { requirement_ids: ["r1"] },
    ]);
    expect(report.uncoveredIds).toEqual(["r2", "r3"]);
    expect(report.coveredIds).toEqual(["r1"]);
  });

  it("separates must-have gaps from nice-to-have gaps", () => {
    const report = checkCoverage(requirements, [
      { requirement_ids: ["r1", "r3"] },
    ]);
    expect(report.uncoveredIds).toEqual(["r2"]);
    expect(report.uncoveredMustIds).toEqual([]);
  });

  it("finds nothing uncovered when every requirement is cited", () => {
    const report = checkCoverage(requirements, [
      { requirement_ids: ["r1", "r2"] },
      { requirement_ids: ["r3"] },
    ]);
    expect(report.uncoveredIds).toEqual([]);
  });

  it("treats a kit with no questions as fully uncovered", () => {
    const report = checkCoverage(requirements, []);
    expect(report.uncoveredIds).toEqual(["r1", "r2", "r3"]);
    expect(report.uncoveredMustIds).toEqual(["r1", "r3"]);
  });

  it("counts nothing as covered when the kit has no requirements", () => {
    const report = checkCoverage([], [{ requirement_ids: [] }]);
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
    const report = checkCoverage(requirements, questions);
    expect(report.uncoveredIds).toEqual(["r1", "r2", "r3"]);
  });
});
