import type { EvaluateOutput, EvaluateResult } from "@prep/shared";
import { toCanonicalKit } from "@prep/shared";
import { AppError, toAppError } from "../lib/errors.js";
import { runPipeline } from "../pipeline/runPipeline.js";
import type { PipelineDeps } from "../pipeline/types.js";
import type { BatchCase } from "./cases.js";

export type BatchProgress = (event: {
  index: number;
  total: number;
  id: string;
  status: "ok" | "failed";
  durationMs: number;
  detail: string;
}) => void;

export type BatchHooks = {
  onProgress?: BatchProgress;
  /** Called with everything so far after each case, so a crash late in a run keeps the earlier kits. */
  persist?: (payload: EvaluateOutput) => Promise<void>;
};

async function runCase(testCase: BatchCase, deps: PipelineDeps): Promise<{ result: EvaluateResult; detail: string }> {
  try {
    if (testCase.problem) throw new AppError("INVALID_INPUT", `Invalid case: ${testCase.problem}.`);
    const output = await runPipeline(
      { jd: testCase.jd, companyUrl: testCase.company_url, days: testCase.days },
      deps,
    );
    const body = output.body;
    return {
      result: { id: testCase.id, status: "ok", kit: toCanonicalKit(body), error: null },
      detail: `${body.questions.length} questions, ${body.coverage.uncovered_requirement_ids.length} uncovered, ${body.warnings?.length ?? 0} warnings`,
    };
  } catch (error) {
    const appError = toAppError(error);
    return {
      result: {
        id: testCase.id,
        status: "failed",
        kit: null,
        error: { code: appError.code, message: appError.message },
      },
      detail: `${appError.code}: ${appError.message}`,
    };
  }
}

/**
 * Runs every case in order and returns the Appendix B payload. One case failing
 * never stops the run: the grader's file has to come back with an entry for
 * every input, whatever happened.
 */
export async function runBatch(
  cases: BatchCase[],
  deps: PipelineDeps,
  hooks: BatchHooks = {},
): Promise<EvaluateOutput> {
  const payload: EvaluateOutput = { version: "1.0", generated_at: new Date().toISOString(), kits: [] };

  for (const [index, testCase] of cases.entries()) {
    const started = Date.now();
    const { result, detail } = await runCase(testCase, deps);
    payload.kits.push(result);
    payload.generated_at = new Date().toISOString();

    hooks.onProgress?.({
      index,
      total: cases.length,
      id: testCase.id,
      status: result.status,
      durationMs: Date.now() - started,
      detail,
    });
    await hooks.persist?.(payload);
  }

  return payload;
}
