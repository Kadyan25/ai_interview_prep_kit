import { describe, expect, it } from "vitest";
import { kitBodySchema, validateKitBody, toCanonicalKit } from "../src/kit.schema.js";
import { validKit } from "./fixtures/validKit.js";

function errorsFor(mutate: (kit: ReturnType<typeof validKit>) => void): string[] {
  const kit = validKit();
  mutate(kit);
  const result = validateKitBody(kit);
  return result.ok ? [] : result.errors;
}

describe("kitBodySchema", () => {
  it("accepts a complete kit", () => {
    const result = validateKitBody(validKit());
    expect(result.ok).toBe(true);
  });

  it("accepts a kit without the optional additive fields", () => {
    const kit = validKit();
    delete kit.warnings;
    delete kit.company_brief.how_they_hire;
    expect(kitBodySchema.safeParse(kit).success).toBe(true);
  });

  it("rejects a missing top-level section", () => {
    const kit = validKit() as Record<string, unknown>;
    delete kit.coverage;
    expect(validateKitBody(kit).ok).toBe(false);
  });

  it("rejects an unknown question category", () => {
    const errors = errorsFor((kit) => {
      (kit.questions[0] as { category: string }).category = "culture";
    });
    expect(errors.join()).toMatch(/category/);
  });

  it("rejects difficulty outside 1..3", () => {
    const errors = errorsFor((kit) => {
      (kit.questions[0] as { difficulty: number }).difficulty = 4;
    });
    expect(errors.join()).toMatch(/difficulty/);
  });

  it("rejects non-integer minutes", () => {
    const errors = errorsFor((kit) => {
      kit.schedule.days[0]!.minutes = 22.5;
    });
    expect(errors.join()).toMatch(/minutes/);
  });

  it("rejects non-integer jd_chars", () => {
    const errors = errorsFor((kit) => {
      kit.source.jd_chars = 12.5;
    });
    expect(errors.join()).toMatch(/jd_chars/);
  });

  it("rejects a malformed id", () => {
    const errors = errorsFor((kit) => {
      kit.questions[0]!.id = "question-1";
    });
    expect(errors.join()).toMatch(/id/);
  });

  it("rejects duplicate ids", () => {
    const errors = errorsFor((kit) => {
      kit.questions[1]!.id = "q1";
    });
    expect(errors.join()).toMatch(/duplicate question id q1/);
  });

  it("rejects a question pointing at an unknown requirement", () => {
    const errors = errorsFor((kit) => {
      kit.questions[0]!.requirement_ids = ["r9"];
    });
    expect(errors.join()).toMatch(/unknown requirement r9/);
  });

  it("rejects a flashcard pointing at an unknown requirement", () => {
    const errors = errorsFor((kit) => {
      kit.flashcards[0]!.requirement_ids = ["r7"];
    });
    expect(errors.join()).toMatch(/unknown requirement r7/);
  });

  it("rejects a schedule day pointing at an unknown question", () => {
    const errors = errorsFor((kit) => {
      kit.schedule.days[0]!.question_ids = ["q9"];
    });
    expect(errors.join()).toMatch(/unknown question q9/);
  });

  it("rejects a day count that disagrees with days_available", () => {
    const errors = errorsFor((kit) => {
      kit.schedule.days.pop();
    });
    expect(errors.join()).toMatch(/days_available/);
  });

  it("rejects days that are not numbered 1..N in order", () => {
    const errors = errorsFor((kit) => {
      kit.schedule.days[1]!.day = 5;
    });
    expect(errors.join()).toMatch(/numbered 1\.\.N/);
  });

  it("rejects coverage referencing an unknown requirement", () => {
    const errors = errorsFor((kit) => {
      kit.coverage.uncovered_requirement_ids = ["r8"];
    });
    expect(errors.join()).toMatch(/coverage references unknown requirement r8/);
  });

  it("allows company-fit questions with no requirement ids", () => {
    const result = validateKitBody(validKit());
    expect(result.ok).toBe(true);
  });

  it("rejects a technical question with no requirement ids", () => {
    const errors = errorsFor((kit) => {
      kit.questions[0]!.requirement_ids = [];
    });
    expect(errors.join()).toMatch(/must reference at least one requirement/);
  });

  it("allows an empty-requirement question when the kit has no requirements at all", () => {
    const kit = validKit();
    kit.role.requirements = [];
    kit.questions = [
      {
        id: "q1",
        requirement_ids: [],
        category: "technical",
        prompt: "Describe your last backend project.",
        answer_outline: "Scope, your part, the hard bit, the result.",
        difficulty: 1,
      },
    ];
    kit.flashcards = [];
    kit.schedule = {
      days_available: 1,
      days: [{ day: 1, focus: "Technical warm-up", question_ids: ["q1"], minutes: 15 }],
    };
    kit.coverage = { uncovered_requirement_ids: [], passes: 1 };
    expect(validateKitBody(kit).ok).toBe(true);
  });

  it("rejects a bad researched_at timestamp", () => {
    const errors = errorsFor((kit) => {
      kit.source.researched_at = "last tuesday";
    });
    expect(errors.join()).toMatch(/researched_at/);
  });
});

describe("toCanonicalKit", () => {
  it("returns a body that still validates", () => {
    const canonical = toCanonicalKit(validKit());
    expect(validateKitBody(canonical).ok).toBe(true);
  });
});
