import type { Coverage, Requirement } from "@prep/shared";
import { alignCitations, checkCoverage } from "../coverage.js";
import type { DraftQuestion, PipelineDeps, Warnings } from "../types.js";
import { fallbackQuestion } from "./fallbackQuestions.js";
import { generateForGaps, type QuestionContext } from "./generateQuestions.js";

const MAX_PASSES = 3;

/**
 * Check, generate for what is missing, check again. The loop stops when there
 * are no gaps, when a pass adds nothing, or at three passes. Passes are counted
 * as checks actually run, which is what `coverage.passes` reports.
 *
 * A must-have still bare after that gets a plain question written in code, so
 * the kit never ships with a required item nobody can practise.
 */
export async function runCoverageLoop(
  requirements: Requirement[],
  initialQuestions: DraftQuestion[],
  context: QuestionContext,
  deps: PipelineDeps,
  warnings: Warnings,
): Promise<{ questions: DraftQuestion[]; coverage: Coverage }> {
  const initial = alignCitations(initialQuestions, requirements);
  let questions = initial.questions;
  let passes = 1;
  let report = checkCoverage(requirements, questions);

  while (passes < MAX_PASSES && report.uncovered.length > 0) {
    // The third pass is only worth an extra model call when a must-have is still
    // missing and the previous pass was actually productive.
    if (passes === 2 && report.uncoveredMustIds.length === 0) break;

    const before = questions.length;
    const generated = await generateForGaps(report.uncovered, context, deps);
    const cleaned = alignCitations(generated, requirements).questions.filter(
      (q) => q.requirement_ids.length > 0,
    );

    questions = [...questions, ...cleaned];
    passes += 1;
    report = checkCoverage(requirements, questions);

    deps.logger.info(
      { pass: passes, added: questions.length - before, remaining: report.uncovered.length },
      "coverage pass",
    );

    if (questions.length === before) break; // a pass that adds nothing will not help
  }

  if (initial.dropped > 0) {
    deps.logger.info({ dropped: initial.dropped }, "questions dropped: they cited only requirements they cannot exercise");
  }

  const bareMusts = requirements.filter((r) => report.uncoveredMustIds.includes(r.id));
  if (bareMusts.length > 0) {
    questions = [...questions, ...bareMusts.map(fallbackQuestion)];
    report = checkCoverage(requirements, questions);
    warnings.add(
      `The generated questions did not cover ${bareMusts.length} required item${
        bareMusts.length === 1 ? "" : "s"
      }, so a plain practice question was written for ${bareMusts.length === 1 ? "it" : "each"}: ${bareMusts
        .map((r) => r.text)
        .join("; ")}.`,
    );
  }

  if (report.uncoveredIds.length > 0) {
    warnings.add(
      `${report.uncoveredIds.length} nice-to-have requirement${
        report.uncoveredIds.length === 1 ? " has" : "s have"
      } no dedicated question.`,
    );
  }

  return {
    questions,
    coverage: { uncovered_requirement_ids: report.uncoveredIds, passes },
  };
}
