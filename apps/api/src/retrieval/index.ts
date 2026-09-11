import type { ResearchDeps } from "../pipeline/types.js";

/**
 * The seam between the pipeline and the outside world. Both the API job runner
 * and the batch CLI build their research dependencies here, so there is exactly
 * one place that decides what the pipeline is allowed to fetch.
 *
 * Returns undefined while retrieval is unavailable; the pipeline then runs from
 * the job description alone and says so in the kit's warnings.
 */
export function createResearchDeps(): ResearchDeps | undefined {
  return undefined;
}
