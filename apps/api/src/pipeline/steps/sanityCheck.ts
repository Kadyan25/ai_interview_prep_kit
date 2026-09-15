import type { Question, Requirement } from "@prep/shared";
import { uncoveredRequirementIds } from "@prep/shared";
import { isEngineeringTitle, isNonEngineeringTitle, processHasDesignRound } from "../roles.js";

/**
 * A last look at a finished kit for mistakes that rules upstream should have
 * prevented but might not. It never changes the kit; it tells the user, so a
 * wrong-looking kit is flagged rather than trusted.
 *
 * Each check is here because the mistake happened on a real posting: design rounds
 * on a sales, product or design role, and every requirement of a nurse practitioner
 * typed "technical". Run over the real-kit fixtures, it flags those kits and none of
 * the good ones.
 */

// Below this, one kind of requirement throughout is plausible, not suspicious.
const MIN_REQUIREMENTS_FOR_KIND_CHECK = 5;

export type SanityInput = {
  roleTitle: string;
  hiringProcess: string | null;
  requirements: Requirement[];
  questions: Pick<Question, "category" | "requirement_ids">[];
};

export function sanityWarnings(kit: SanityInput): string[] {
  const warnings: string[] = [];

  const designQuestions = kit.questions.filter((q) => q.category === "system-design").length;
  if (designQuestions > 0 && isNonEngineeringTitle(kit.roleTitle) && !processHasDesignRound(kit.hiringProcess)) {
    warnings.push(
      `This kit has ${designQuestions} system-design question${designQuestions === 1 ? "" : "s"}, but "${kit.roleTitle}" does not usually have a design round. Skip them unless you know yours does.`,
    );
  }

  const kinds = new Set(kit.requirements.map((r) => r.kind));
  if (
    kit.requirements.length >= MIN_REQUIREMENTS_FOR_KIND_CHECK &&
    kinds.size === 1 &&
    !isEngineeringTitle(kit.roleTitle)
  ) {
    const [kind] = [...kinds];
    warnings.push(
      `Every requirement was read as ${kind}, which is unusual for "${kit.roleTitle}". Check the role tab: licences, availability and people skills may be mislabelled, and the question mix follows these labels.`,
    );
  }

  const musts = new Set(kit.requirements.filter((r) => r.priority === "must").map((r) => r.id));
  const bare = uncoveredRequirementIds(kit.requirements, kit.questions as Question[]).filter((id) => musts.has(id));
  if (bare.length > 0) {
    warnings.push(
      `${bare.length} required item${bare.length === 1 ? " has" : "s have"} no question that practises ${bare.length === 1 ? "it" : "them"}.`,
    );
  }

  return warnings;
}
