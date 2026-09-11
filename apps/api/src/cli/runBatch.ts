import type { EvaluateCase, EvaluateOutput, EvaluateResult } from "@prep/shared";
import { toCanonicalKit } from "@prep/shared";
import { toAppError } from "../lib/errors.js";
import { runPipeline } from "../pipeline/runPipeline.js";
import type { PipelineDeps } from "../pipeline/types.js";

export type BatchProgress = (event: {
  index: number;
  total: number;
  id: string;
  status: "ok" | "failed";
  durationMs: number;
  detail: string;
}) => void;

/**
 * Runs every case in order and returns the Appendix B payload. One case failing
 * never stops the run: the grader's file has to come back with an entry for
 * every input, whatever happened.
 */
export async function runBatch(
  cases: EvaluateCase[],
  deps: PipelineDeps,
  onProgress?: BatchProgress,
): Promise<EvaluateOutput> {
  const kits: EvaluateResult[] = [];

  for (const [index, testCase] of cases.entries()) {
    const started = Date.now();
    try {
      const output = await runPipeline(
        { jd: testCase.jd, companyUrl: testCase.company_url, days: testCase.days },
        deps,
      );
      kits.push({ id: testCase.id, status: "ok", kit: toCanonicalKit(output.body) });
      onProgress?.({
        index,
        total: cases.length,
        id: testCase.id,
        status: "ok",
        durationMs: Date.now() - started,
        detail: `${output.body.questions.length} questions, ${output.body.coverage.uncovered_requirement_ids.length} uncovered, ${output.body.warnings?.length ?? 0} warnings`,
      });
    } catch (error) {
      const appError = toAppError(error);
      kits.push({
        id: testCase.id,
        status: "failed",
        error: { code: appError.code, message: appError.message },
      });
      onProgress?.({
        index,
        total: cases.length,
        id: testCase.id,
        status: "failed",
        durationMs: Date.now() - started,
        detail: `${appError.code}: ${appError.message}`,
      });
    }
  }

  return { version: "1.0", generated_at: new Date().toISOString(), kits };
}
