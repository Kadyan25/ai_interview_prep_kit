import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Question, Requirement } from "@prep/shared";
import { allocateSchedule } from "../../src/pipeline/schedule.js";
import { runCoverageLoop } from "../../src/pipeline/steps/coverageLoop.js";
import { countFor, questionBudget, routeRequirements } from "../../src/pipeline/steps/generateQuestions.js";
import { sanityWarnings } from "../../src/pipeline/steps/sanityCheck.js";
import { Warnings } from "../../src/pipeline/types.js";
import { silentLogger } from "../helpers/stubLlm.js";

/**
 * The code-side rules — which categories get asked, how the plan is laid out,
 * whether every must-have is covered — checked against what the model really
 * produced for 24 real and synthetic postings, not against inputs written for
 * the test.
 *
 * This set exists because two rules passed their own tests and still failed live:
 * the model labels a designer's "Figma" and "design systems" as technical, and a
 * nurse's licensing as technical, which no hand-written fixture had done. When a
 * live kit goes wrong, its kit belongs in this file.
 */

type RealKit = {
  id: string;
  roleTitle: string;
  seniority: string;
  days: number;
  designRoundExpected: boolean | null;
  requirements: Requirement[];
  questions: Pick<Question, "id" | "category" | "requirement_ids" | "difficulty">[];
};

const { kits } = JSON.parse(
  readFileSync(new URL("../fixtures/realKits.json", import.meta.url), "utf8"),
) as { kits: RealKit[] };

const asQuestions = (kit: RealKit): Question[] =>
  kit.questions.map((q) => ({ ...q, prompt: `Question ${q.id}`, answer_outline: "Outline" }));

describe("real kits: whether a system-design round is asked", () => {
  const labelled = kits.filter((kit) => kit.designRoundExpected !== null);

  it("covers enough roles of both kinds to mean something", () => {
    expect(labelled.filter((k) => k.designRoundExpected).length).toBeGreaterThanOrEqual(8);
    expect(labelled.filter((k) => !k.designRoundExpected).length).toBeGreaterThanOrEqual(8);
  });

  for (const kit of labelled) {
    it(`${kit.id}: "${kit.roleTitle}" ${kit.designRoundExpected ? "gets" : "does not get"} one`, () => {
      const routed = routeRequirements({
        roleTitle: kit.roleTitle,
        seniority: kit.seniority,
        company: "",
        requirements: kit.requirements,
        hiringProcess: null,
        companySummary: null,
      });
      expect(routed["system-design"].length > 0).toBe(kit.designRoundExpected);
    });
  }
});

describe("real kits: the schedule", () => {
  for (const kit of kits.filter((k) => k.questions.length > 0)) {
    it(`${kit.id}: ${kit.days} days, everything allocated, evening before is not the heaviest`, () => {
      const schedule = allocateSchedule({
        requirements: kit.requirements,
        questions: asQuestions(kit),
        days: kit.days,
      });

      expect(schedule.days).toHaveLength(kit.days);
      expect(schedule.days.every((d) => Number.isInteger(d.minutes) && d.minutes > 0)).toBe(true);
      const scheduled = new Set(schedule.days.flatMap((d) => d.question_ids));
      for (const q of kit.questions) expect(scheduled.has(q.id), q.id).toBe(true);

      if (kit.days >= 3) {
        const study = schedule.days.slice(0, -1).map((d) => d.minutes);
        expect(schedule.days.at(-1)!.minutes).toBeLessThanOrEqual(Math.max(...study));
      }
    });
  }
});

describe("real kits: coverage", () => {
  // A model that answers nothing: whatever the questions leave bare has to be
  // covered by the code fallback, never shipped uncovered.
  const silentModel = {
    llm: {
      providers: () => ["groq" as const],
      generateJson: async () => {
        throw new Error("no model in this test");
      },
    },
    logger: silentLogger,
  };

  for (const kit of kits.filter((k) => k.requirements.length > 0)) {
    it(`${kit.id}: no must-have is left without a question that can exercise it`, async () => {
      const { coverage, questions } = await runCoverageLoop(
        kit.requirements,
        asQuestions(kit),
        {
          roleTitle: kit.roleTitle,
          seniority: kit.seniority,
          company: "",
          requirements: kit.requirements,
          hiringProcess: null,
          companySummary: null,
        },
        silentModel,
        new Warnings(),
      );

      const musts = kit.requirements.filter((r) => r.priority === "must").map((r) => r.id);
      expect(coverage.uncovered_requirement_ids.filter((id) => musts.includes(id))).toEqual([]);
      const known = new Set(kit.requirements.map((r) => r.id));
      for (const q of questions) {
        for (const id of q.requirement_ids) expect(known.has(id), `${q.category} cites ${id}`).toBe(true);
      }
    });
  }
});

describe("real kits: the sanity check", () => {
  // These kits came out wrong before the routing and extraction fixes. The check
  // exists to catch that class of mistake if a rule upstream lets it through
  // again, so it must flag every one of them and nothing else.
  const WRONG = {
    "real-gitlab-staff-pm": /system-design/,
    "qa-05-doctolib-praktikum-inside-sales-de": /system-design/,
    "qa-19-odk-senior-product-manager": /system-design/,
    "qa-08-hellofresh-kitchen-associate": /read as behavioural/,
    "qa-09-oscar-nurse-practitioner-virtual-care": /read as technical/,
  } as const;

  for (const kit of kits) {
    const expected = WRONG[kit.id as keyof typeof WRONG];
    it(`${kit.id}: ${expected ? "is flagged" : "is not flagged"}`, () => {
      const warnings = sanityWarnings({
        roleTitle: kit.roleTitle,
        hiringProcess: null,
        requirements: kit.requirements,
        questions: kit.questions,
      });
      if (expected) {
        expect(warnings.some((w) => expected.test(w)), warnings.join(" | ")).toBe(true);
      } else {
        // Known miss: qa-07-sumup's title is "líder de líderes", which says nothing
        // about the job, so its design round cannot be judged from the title.
        expect(warnings, warnings.join(" | ")).toEqual([]);
      }
    });
  }
});

describe("real kits: the size of the question bank", () => {
  for (const kit of kits) {
    it(`${kit.id}: what is asked for fits ${kit.days} days`, () => {
      const routed = routeRequirements({
        roleTitle: kit.roleTitle,
        seniority: kit.seniority,
        company: "",
        requirements: kit.requirements,
        hiringProcess: null,
        companySummary: null,
      });
      const asked = (["technical", "behavioural", "system-design", "company-fit"] as const)
        .filter((category) => category === "company-fit" || routed[category].length > 0)
        .reduce((total, category) => total + countFor(category, routed[category].length, kit.days), 0);
      // The per-category floors can push a tiny plan slightly over; never by much.
      expect(asked).toBeLessThanOrEqual(questionBudget(kit.days) + 6);
    });
  }
});
