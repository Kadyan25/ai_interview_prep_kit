import { describe, expect, it } from "vitest";
import type { Question, Requirement } from "@prep/shared";
import { allocateSchedule, questionMinutes } from "../../src/pipeline/schedule.js";

function requirement(id: string, priority: Requirement["priority"] = "must"): Requirement {
  return { id, text: `Requirement ${id}`, kind: "technical", priority };
}

function question(
  id: string,
  requirementIds: string[],
  difficulty: 1 | 2 | 3,
  category: Question["category"] = "technical",
): Question {
  return {
    id,
    requirement_ids: requirementIds,
    category,
    prompt: `Prompt ${id}`,
    answer_outline: `Outline ${id}`,
    difficulty,
  };
}

const requirements = [requirement("r1"), requirement("r2", "nice"), requirement("r3")];

const questions = [
  question("q1", ["r1"], 3),
  question("q2", ["r2"], 1),
  question("q3", ["r3"], 2),
  question("q4", ["r1"], 1),
  question("q5", [], 1, "company-fit"),
  question("q6", ["r3"], 3),
];

const allIds = (schedule: { days: { question_ids: string[] }[] }) =>
  schedule.days.flatMap((d) => d.question_ids);

describe("allocateSchedule", () => {
  it("produces exactly the requested number of days", () => {
    for (const days of [1, 2, 3, 5, 14, 60]) {
      const schedule = allocateSchedule({ requirements, questions, days });
      expect(schedule.days_available).toBe(days);
      expect(schedule.days).toHaveLength(days);
      expect(schedule.days.map((d) => d.day)).toEqual(
        Array.from({ length: days }, (_, i) => i + 1),
      );
    }
  });

  it("puts every question on exactly one study day", () => {
    const schedule = allocateSchedule({ requirements, questions, days: 4 });
    // Days 1..3 are study days; day 4 repeats material deliberately.
    const studyIds = schedule.days.slice(0, 3).flatMap((d) => d.question_ids);
    expect([...studyIds].sort()).toEqual(questions.map((q) => q.id).sort());
    expect(new Set(studyIds).size).toBe(questions.length);
  });

  it("fits everything into a single day when the interview is tomorrow", () => {
    const schedule = allocateSchedule({ requirements, questions, days: 1 });
    expect(schedule.days).toHaveLength(1);
    expect(schedule.days[0]!.question_ids).toHaveLength(questions.length);
    expect(schedule.days[0]!.minutes).toBe(
      questions.reduce((t, q) => t + questionMinutes(q), 0),
    );
  });

  it("keeps no review day when there are fewer than three days", () => {
    const schedule = allocateSchedule({ requirements, questions, days: 2 });
    const ids = allIds(schedule);
    expect(ids).toHaveLength(questions.length);
    expect(new Set(ids).size).toBe(questions.length);
  });

  it("reserves the last day for review once there are three days or more", () => {
    const schedule = allocateSchedule({ requirements, questions, days: 3 });
    const last = schedule.days[2]!;
    expect(last.focus.startsWith("Review:")).toBe(true);
    expect(last.question_ids.length).toBeGreaterThan(0);
  });

  it("front-loads the hardest must-have work", () => {
    const schedule = allocateSchedule({ requirements, questions, days: 3 });
    // q1 and q6 are difficulty 3 on must-have requirements: weight 9.
    expect(schedule.days[0]!.question_ids).toContain("q1");
    expect(schedule.days[0]!.question_ids).toContain("q6");
    expect(schedule.days[0]!.question_ids).not.toContain("q2");
  });

  it("gives every day whole-number minutes of at least fifteen", () => {
    for (const days of [1, 3, 7, 60]) {
      const schedule = allocateSchedule({ requirements, questions, days });
      for (const day of schedule.days) {
        expect(Number.isInteger(day.minutes)).toBe(true);
        expect(day.minutes).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it("turns surplus days into review that cycles through earlier days", () => {
    const schedule = allocateSchedule({
      requirements,
      questions: [question("q1", ["r1"], 1), question("q2", ["r3"], 1)],
      days: 10,
    });
    const reviewDays = schedule.days.filter((d) => d.focus.startsWith("Review:"));
    expect(reviewDays.length).toBeGreaterThan(0);
    for (const day of reviewDays) expect(day.question_ids.length).toBeGreaterThan(0);
    // Not every review day repeats the same material.
    const signatures = new Set(reviewDays.slice(0, 4).map((d) => d.question_ids.join(",")));
    expect(signatures.size).toBeGreaterThan(1);
  });

  it("schedules every must-have requirement that has a question", () => {
    const schedule = allocateSchedule({ requirements, questions, days: 5 });
    const scheduled = new Set(allIds(schedule));
    for (const r of requirements.filter((r) => r.priority === "must")) {
      const hasQuestion = questions.some(
        (q) => q.requirement_ids.includes(r.id) && scheduled.has(q.id),
      );
      expect(hasQuestion).toBe(true);
    }
  });

  it("still returns a full schedule when no questions were generated", () => {
    const schedule = allocateSchedule({ requirements, questions: [], days: 4 });
    expect(schedule.days).toHaveLength(4);
    for (const day of schedule.days) {
      expect(day.question_ids).toEqual([]);
      expect(day.minutes).toBe(15);
      expect(day.focus).toMatch(/No questions/);
    }
  });

  it("names the day after its dominant category and requirements", () => {
    const schedule = allocateSchedule({
      requirements,
      questions: [question("q1", ["r1"], 3), question("q2", ["r1"], 3)],
      days: 1,
    });
    expect(schedule.days[0]!.focus).toBe("Technical: Requirement r1");
  });

  it("rejects a day count that is not a positive whole number", () => {
    expect(() => allocateSchedule({ requirements, questions, days: 0 })).toThrow();
    expect(() => allocateSchedule({ requirements, questions, days: 2.5 })).toThrow();
  });

  it("is deterministic", () => {
    const a = allocateSchedule({ requirements, questions, days: 6 });
    const b = allocateSchedule({ requirements, questions, days: 6 });
    expect(a).toEqual(b);
  });
});
