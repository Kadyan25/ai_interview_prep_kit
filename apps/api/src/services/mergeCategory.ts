import type { ItemStateMap, KitBody, Question, QuestionCategory } from "@prep/shared";
import { countedRequirementIds, validateKitBody } from "@prep/shared";
import { AppError } from "../lib/errors.js";
import { checkCoverage } from "../pipeline/coverage.js";
import { allocateSchedule } from "../pipeline/schedule.js";
import { fallbackQuestion } from "../pipeline/steps/fallbackQuestions.js";
import type { DraftQuestion } from "../pipeline/types.js";
import type { KitSnapshot } from "./regenerate.js";

export function survives(itemState: ItemStateMap, question: Question, category: QuestionCategory): boolean {
  if (question.category !== category) return true;
  const state = itemState[question.id];
  return state?.pinned === true || state?.origin === "edited" || state?.origin === "manual";
}

/** Pure: the regenerated category merged into the kit as it is now. */
export function mergeCategory(
  current: KitSnapshot,
  category: QuestionCategory,
  drafts: DraftQuestion[],
): { set: Record<string, unknown>; scheduleStale?: boolean } {
  if (!current.body) throw new AppError("INVALID_INPUT", "This kit has no content yet, so there is nothing to regenerate.");
  const body = current.body;
  const itemState: ItemStateMap = { ...(current.itemState ?? {}) };
  const counters = { ...current.counters };
  const requirements = body.role.requirements;

  const accepted = drafts
    .map((d) => ({ ...d, requirement_ids: countedRequirementIds(d, requirements) }))
    .filter((d) => d.category === "company-fit" || d.requirement_ids.length > 0 || requirements.length === 0);

  const fresh: Question[] = accepted.map((draft) => {
    counters.q += 1;
    const id = `q${counters.q}`;
    itemState[id] = { origin: "generated", pinned: false };
    return { ...draft, id };
  });

  // Fresh questions fill the replaced questions' slots in order, so the user's
  // arrangement of what they kept is left as they made it.
  const replacedIds: string[] = [];
  const questions: Question[] = [];
  let next = 0;
  for (const question of body.questions) {
    if (survives(itemState, question, category)) {
      questions.push(question);
    } else {
      replacedIds.push(question.id);
      delete itemState[question.id];
      if (next < fresh.length) questions.push(fresh[next++]!);
    }
  }
  questions.push(...fresh.slice(next));

  for (const must of checkCoverage(requirements, questions).uncovered.filter((r) => r.priority === "must")) {
    counters.q += 1;
    const id = `q${counters.q}`;
    itemState[id] = { origin: "generated", pinned: false };
    questions.push({ ...fallbackQuestion(must), id });
  }

  const report = checkCoverage(requirements, questions);
  const schedule = structuredClone(body.schedule);
  for (const day of schedule.days) day.question_ids = day.question_ids.filter((id) => !replacedIds.includes(id));

  // A plan the user edited or pinned is theirs to re-run, not ours.
  const scheduleState = itemState.schedule;
  const scheduleOwnedByUser = scheduleState?.origin === "edited" || scheduleState?.pinned === true;
  const nextBody: KitBody = {
    ...body,
    questions,
    coverage: { ...body.coverage, uncovered_requirement_ids: report.uncoveredIds },
    schedule: scheduleOwnedByUser ? schedule : allocateSchedule({ requirements, questions, days: current.input.days }),
  };
  assertValid(nextBody);

  return {
    set: {
      "body.questions": nextBody.questions,
      "body.coverage": nextBody.coverage,
      "body.schedule": nextBody.schedule,
      itemState,
      counters,
    },
    ...(scheduleOwnedByUser ? { scheduleStale: true } : {}),
  };
}

function assertValid(body: KitBody): void {
  const result = validateKitBody(body);
  if (!result.ok) {
    throw new AppError(
      "KIT_INVALID",
      `Regeneration would have left the kit inconsistent: ${result.errors.slice(0, 3).join("; ")}`,
    );
  }
}
