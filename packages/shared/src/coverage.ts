import type { QuestionCategory, Requirement, RequirementKind } from "./kit.schema.js";

/**
 * What counts as a question covering a requirement. Shared, because the
 * pipeline, a regeneration and a hand edit must all agree on it.
 *
 * Citing an id is a claim, not proof. A technical question that lists
 * "mentoring" alongside two database requirements is not practice for
 * mentoring, so a citation only counts when the question's category can
 * actually exercise that kind of requirement, and only the first few citations
 * of any one question count.
 */

export const CATEGORY_COVERS: Record<QuestionCategory, readonly RequirementKind[]> = {
  technical: ["technical", "domain"],
  "system-design": ["technical", "domain"],
  behavioural: ["behavioural"],
  "company-fit": ["behavioural", "domain"],
};

// One question can reasonably exercise two or three things; ten citations is padding.
export const MAX_COUNTED_CITATIONS = 3;

type Citing = { category: QuestionCategory; requirement_ids: string[] };

/** The requirement ids a question genuinely covers, in the order it cited them. */
export function countedRequirementIds(question: Citing, requirements: Requirement[]): string[] {
  const kindOf = new Map(requirements.map((r) => [r.id, r.kind]));
  const allowed = CATEGORY_COVERS[question.category];
  const counted: string[] = [];
  for (const id of question.requirement_ids) {
    const kind = kindOf.get(id);
    if (!kind || !allowed.includes(kind) || counted.includes(id)) continue;
    counted.push(id);
    if (counted.length === MAX_COUNTED_CITATIONS) break;
  }
  return counted;
}

export function uncoveredRequirementIds(requirements: Requirement[], questions: Citing[]): string[] {
  const covered = new Set(questions.flatMap((q) => countedRequirementIds(q, requirements)));
  return requirements.filter((r) => !covered.has(r.id)).map((r) => r.id);
}
