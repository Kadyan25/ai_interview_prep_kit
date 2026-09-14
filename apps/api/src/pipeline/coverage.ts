import { countedRequirementIds, type QuestionCategory, type Requirement } from "@prep/shared";

/**
 * Coverage is measured in code. The model is never asked "did you cover
 * everything?" — it would say yes. What counts as covering is defined once, in
 * the shared package, so the pipeline and a user's edits agree.
 */

/** Anything that cites requirements: a question, a flashcard, a draft of either. */
export type CoverableQuestion = {
  requirement_ids: string[];
};

/**
 * Models occasionally cite a requirement id that does not exist. Those are
 * removed before counting, otherwise a hallucinated id would read as coverage.
 */
export function stripDanglingIds<T extends CoverableQuestion>(
  questions: T[],
  requirements: Requirement[],
): { questions: T[]; removed: number } {
  const known = new Set(requirements.map((r) => r.id));
  let removed = 0;

  const cleaned = questions.map((question) => {
    const kept = question.requirement_ids.filter((id) => known.has(id));
    removed += question.requirement_ids.length - kept.length;
    return kept.length === question.requirement_ids.length
      ? question
      : { ...question, requirement_ids: kept };
  });

  return { questions: cleaned, removed };
}

type CitingQuestion = CoverableQuestion & { category: QuestionCategory };

/**
 * Rewrites each question's citations to the ones that genuinely count: ids that
 * exist, of a kind its category can exercise, at most three. A question left
 * citing nothing is dropped unless it is company-fit, which may stand alone.
 * The kit then shows what a question is really practice for, and coverage
 * cannot be claimed by a list of ids.
 */
export function alignCitations<T extends CitingQuestion>(
  questions: T[],
  requirements: Requirement[],
): { questions: T[]; dropped: number } {
  let dropped = 0;
  const aligned: T[] = [];
  for (const question of questions) {
    const counted = countedRequirementIds(question, requirements);
    if (counted.length === 0 && question.category !== "company-fit" && question.requirement_ids.length > 0) {
      dropped += 1;
      continue;
    }
    aligned.push(counted.length === question.requirement_ids.length ? question : { ...question, requirement_ids: counted });
  }
  return { questions: aligned, dropped };
}

export type CoverageReport = {
  uncovered: Requirement[];
  uncoveredIds: string[];
  uncoveredMustIds: string[];
  coveredIds: string[];
};

/** A requirement is covered when a question of a suitable category cites it. */
export function checkCoverage(requirements: Requirement[], questions: CitingQuestion[]): CoverageReport {
  const cited = new Set(questions.flatMap((q) => countedRequirementIds(q, requirements)));
  const uncovered = requirements.filter((r) => !cited.has(r.id));

  return {
    uncovered,
    uncoveredIds: uncovered.map((r) => r.id),
    uncoveredMustIds: uncovered.filter((r) => r.priority === "must").map((r) => r.id),
    coveredIds: requirements.filter((r) => cited.has(r.id)).map((r) => r.id),
  };
}
