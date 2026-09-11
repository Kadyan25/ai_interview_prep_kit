import type { Requirement } from "@prep/shared";

/**
 * Coverage is measured in code. The model is never asked "did you cover
 * everything?" — it would say yes.
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

export type CoverageReport = {
  uncovered: Requirement[];
  uncoveredIds: string[];
  uncoveredMustIds: string[];
  coveredIds: string[];
};

/** A requirement is covered when at least one question names it. */
export function checkCoverage(
  requirements: Requirement[],
  questions: CoverableQuestion[],
): CoverageReport {
  const cited = new Set<string>();
  for (const question of questions) {
    for (const id of question.requirement_ids) cited.add(id);
  }

  const uncovered = requirements.filter((r) => !cited.has(r.id));

  return {
    uncovered,
    uncoveredIds: uncovered.map((r) => r.id),
    uncoveredMustIds: uncovered.filter((r) => r.priority === "must").map((r) => r.id),
    coveredIds: requirements.filter((r) => cited.has(r.id)).map((r) => r.id),
  };
}
