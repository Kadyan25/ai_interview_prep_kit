import type { Question, Requirement, Schedule, ScheduleDay } from "@prep/shared";
import { AppError } from "../lib/errors.js";

/**
 * Schedule allocation is code, not a model call: the number of days has to be
 * exactly right, every question has to appear, and the reasoning has to be the
 * same every run. A model cannot promise any of that.
 */

const PRIORITY_WEIGHT: Record<Requirement["priority"], number> = { must: 3, nice: 1 };
const MINUTES_BY_DIFFICULTY: Record<1 | 2 | 3, number> = { 1: 15, 2: 25, 3: 40 };
const MIN_DAY_MINUTES = 15;

const CATEGORY_LABEL: Record<Question["category"], string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System design",
  "company-fit": "Company fit",
};

export function questionMinutes(question: Question): number {
  return MINUTES_BY_DIFFICULTY[question.difficulty];
}

/** Harder work on higher-priority requirements sorts first, so it lands earliest. */
export function questionWeight(
  question: Question,
  requirements: Map<string, Requirement>,
): number {
  const priorities = question.requirement_ids
    .map((id) => requirements.get(id))
    .filter((r): r is Requirement => Boolean(r))
    .map((r) => PRIORITY_WEIGHT[r.priority]);
  // A company-fit question carries no requirement, so it weighs the same as a
  // nice-to-have rather than dropping out of the ordering entirely.
  const priority = priorities.length > 0 ? Math.max(...priorities) : 1;
  return priority * question.difficulty;
}

function truncate(text: string, max = 40): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function focusFor(
  questions: Question[],
  requirements: Map<string, Requirement>,
  isReview: boolean,
): string {
  if (questions.length === 0) {
    return isReview ? "Review: consolidate what you have covered" : "Open study";
  }

  const counts = new Map<Question["category"], number>();
  for (const q of questions) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  const dominant = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0]![0];

  // Name the requirements this day actually leans on, most-cited first, so two
  // days covering the same set do not end up with the same label.
  const citations = new Map<string, number>();
  for (const q of questions) {
    for (const id of q.requirement_ids) {
      if (!requirements.has(id)) continue;
      citations.set(id, (citations.get(id) ?? 0) + 1);
    }
  }

  const ordered = [...citations.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0], undefined, { numeric: true });
  });

  const texts = ordered
    .slice(0, 2)
    .map(([id]) => truncate(requirements.get(id)!.text))
    .filter((text, index, all) => all.indexOf(text) === index);

  const label = CATEGORY_LABEL[dominant];
  const body = texts.length > 0 ? `${label}: ${texts.join(", ")}` : label;
  return isReview ? `Review: ${body}` : body;
}

function sumMinutes(questions: Question[]): number {
  return questions.reduce((total, q) => total + questionMinutes(q), 0);
}

export type AllocateScheduleInput = {
  requirements: Requirement[];
  questions: Question[];
  days: number;
};

export function allocateSchedule({
  requirements,
  questions,
  days,
}: AllocateScheduleInput): Schedule {
  if (!Number.isInteger(days) || days < 1) {
    throw new AppError("INVALID_INPUT", "Days until the interview must be a whole number of 1 or more.");
  }

  const byId = new Map(requirements.map((r) => [r.id, r]));
  const order = new Map(requirements.map((r, index) => [r.id, index]));

  if (questions.length === 0) {
    // Nothing to schedule is still a schedule — it says so instead of pretending.
    return {
      days_available: days,
      days: Array.from({ length: days }, (_, i) => ({
        day: i + 1,
        focus: "No questions were generated — re-read the job description and your own notes",
        question_ids: [],
        minutes: MIN_DAY_MINUTES,
      })),
    };
  }

  const sorted = [...questions].sort((a, b) => {
    const weightDiff = questionWeight(b, byId) - questionWeight(a, byId);
    if (weightDiff !== 0) return weightDiff;
    const aOrder = order.get(a.requirement_ids[0] ?? "") ?? Number.MAX_SAFE_INTEGER;
    const bOrder = order.get(b.requirement_ids[0] ?? "") ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });

  // With three days or more the last one is review: no new hard material the day
  // before an interview.
  const reviewDays = days >= 3 ? 1 : 0;
  const studyDays = days - reviewDays;
  const target = Math.ceil(sumMinutes(sorted) / studyDays);

  // Filled by running total rather than day by day: a greedy pass that stops at
  // the target overshoots early and starves the last study day, which is how a
  // 14-day plan ended up with 15 minutes on day 13.
  const buckets: Question[][] = Array.from({ length: studyDays }, () => []);
  let used = 0;
  for (const question of sorted) {
    const day = Math.min(Math.floor(used / target), studyDays - 1);
    buckets[day]!.push(question);
    used += questionMinutes(question);
  }

  const studied = buckets.filter((bucket) => bucket.length > 0);
  const result: ScheduleDay[] = [];
  let emptyDayCount = 0;

  for (let day = 0; day < studyDays; day += 1) {
    const bucket = buckets[day]!;
    if (bucket.length > 0) {
      result.push({
        day: day + 1,
        focus: focusFor(bucket, byId, false),
        question_ids: bucket.map((q) => q.id),
        minutes: Math.max(sumMinutes(bucket), MIN_DAY_MINUTES),
      });
      continue;
    }
    // More days than material: cycle back through what was studied rather than
    // repeating one day over and over.
    const source = studied[emptyDayCount % studied.length] ?? [];
    emptyDayCount += 1;
    result.push({
      day: day + 1,
      focus: focusFor(source, byId, true),
      question_ids: source.map((q) => q.id),
      minutes: Math.max(Math.ceil(sumMinutes(source) / 2), MIN_DAY_MINUTES),
    });
  }

  if (reviewDays === 1) {
    const hardMustHaves = sorted.filter(
      (q) =>
        q.difficulty === 3 &&
        q.requirement_ids.some((id) => byId.get(id)?.priority === "must"),
    );
    const candidates = hardMustHaves.length > 0 ? hardMustHaves : sorted;
    // The evening before an interview is for a light pass over the most important
    // material, not the heaviest day of the plan: take the top questions that fit
    // half a study day at review pace.
    const budget = Math.max(Math.ceil(target / 2), MIN_DAY_MINUTES);
    const finalQuestions: Question[] = [];
    let reviewMinutes = 0;
    for (const question of candidates) {
      const cost = Math.ceil(questionMinutes(question) / 2);
      if (finalQuestions.length > 0 && reviewMinutes + cost > budget) break;
      finalQuestions.push(question);
      reviewMinutes += cost;
    }
    result.push({
      day: days,
      focus: focusFor(finalQuestions, byId, true),
      question_ids: finalQuestions.map((q) => q.id),
      minutes: Math.max(reviewMinutes, MIN_DAY_MINUTES),
    });
  }

  assertScheduleIsSound(result, sorted, days);

  return { days_available: days, days: result };
}

function assertScheduleIsSound(
  schedule: ScheduleDay[],
  questions: Question[],
  days: number,
): void {
  if (schedule.length !== days) {
    throw new AppError("KIT_INVALID", `Schedule produced ${schedule.length} days, expected ${days}.`);
  }
  for (const day of schedule) {
    if (!Number.isInteger(day.minutes) || day.minutes < MIN_DAY_MINUTES) {
      throw new AppError("KIT_INVALID", `Day ${day.day} has invalid minutes: ${day.minutes}.`);
    }
  }
  const scheduled = new Set(schedule.flatMap((d) => d.question_ids));
  const missing = questions.filter((q) => !scheduled.has(q.id));
  if (missing.length > 0) {
    throw new AppError(
      "KIT_INVALID",
      `Schedule left ${missing.length} question(s) unallocated: ${missing.map((q) => q.id).join(", ")}.`,
    );
  }
}
