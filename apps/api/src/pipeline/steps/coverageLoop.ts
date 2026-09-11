import type { Coverage, Requirement } from "@prep/shared";
import { checkCoverage, stripDanglingIds } from "../coverage.js";
import type { DraftQuestion, PipelineDeps, Warnings } from "../types.js";
import { generateForGaps, type QuestionContext } from "./generateQuestions.js";

const MAX_PASSES = 3;

/**
 * Check, generate for what is missing, check again. The loop stops when there
 * are no gaps, when a pass adds nothing, or at three passes. Passes are counted
 * as checks actually run, which is what `coverage.passes` reports.
 */
export async function runCoverageLoop(
  requirements: Requirement[],
  initialQuestions: DraftQuestion[],
  context: QuestionContext,
  deps: PipelineDeps,
  warnings: Warnings,
): Promise<{ questions: DraftQuestion[]; coverage: Coverage }> {
  let questions = stripDanglingIds(initialQuestions, requirements).questions;
  let passes = 1;
  let report = checkCoverage(requirements, questions);

  while (passes < MAX_PASSES && report.uncovered.length > 0) {
    // The third pass is only worth an extra model call when a must-have is still
    // missing and the previous pass was actually productive.
    if (passes === 2 && report.uncoveredMustIds.length === 0) break;

    const before = questions.length;
    const generated = await generateForGaps(report.uncovered, context, deps);
    const cleaned = stripDanglingIds(generated, requirements).questions.filter(
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

  if (report.uncoveredMustIds.length > 0) {
    const texts = requirements
      .filter((r) => report.uncoveredMustIds.includes(r.id))
      .map((r) => r.text);
    warnings.add(
      `No question covers ${report.uncoveredMustIds.length} required item${
        report.uncoveredMustIds.length === 1 ? "" : "s"
      }: ${texts.join("; ")}.`,
    );
  } else if (report.uncoveredIds.length > 0) {
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
