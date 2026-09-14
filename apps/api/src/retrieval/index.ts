import path from "node:path";
import { coreEnv, isProduction, repoRoot } from "../config/env.js";
import { SearchBudget, createSearchCache } from "./searchCache.js";
import type { ResearchDeps } from "../pipeline/types.js";
import { crawl } from "./crawl.js";
import { searchDiscussion } from "./discussion.js";
import type { FetchOptions } from "./fetchPage.js";
import { RobotsCache } from "./robots.js";

export { crawl, isSameSite, registrableDomain } from "./crawl.js";
export { extractContent } from "./cleanHtml.js";
export { fetchPage } from "./fetchPage.js";
export { rankLinks, scoreLink } from "./rankLinks.js";
export { RobotsCache } from "./robots.js";
export { searchDiscussion } from "./discussion.js";
export { guardUrl, isPrivateAddress } from "./urlGuard.js";

const MAX_DEPTH = 2;

export function fetchOptionsFromEnv(): FetchOptions {
  const env = coreEnv();
  return {
    timeoutMs: env.FETCH_TIMEOUT_MS,
    guard: {
      // Off in production. Local runs need it so the batch CLI can crawl the
      // fixture site on localhost.
      allowPrivate: !isProduction() || env.ALLOW_PRIVATE_URLS,
    },
  };
}

/**
 * The seam between the pipeline and the outside world. Both the API job runner
 * and the batch CLI build their research dependencies here, so there is exactly
 * one place that decides what the pipeline is allowed to fetch.
 */
export function createResearchDeps(): ResearchDeps {
  const env = coreEnv();
  const fetchOptions = fetchOptionsFromEnv();
  // One robots cache per process: a crawl of twelve pages should read robots.txt
  // once, not twelve times.
  const robots = new RobotsCache(fetchOptions);
  // Kept on disk locally so repeated test runs reuse paid results; on a deployed
  // host the disk is ephemeral, so memory is enough.
  const searchCache = createSearchCache({
    file: isProduction() ? undefined : path.join(repoRoot, ".cache", "tavily.json"),
  });
  const searchBudget = new SearchBudget(env.TAVILY_MAX_SEARCHES);

  return {
    crawl: (startUrl) =>
      crawl(startUrl, {
        maxPages: env.CRAWL_MAX_PAGES,
        maxDepth: MAX_DEPTH,
        fetch: fetchOptions,
        robots,
      }),
    searchDiscussion: (companyName, companyUrl) =>
      searchDiscussion(companyName, {
        timeoutMs: env.FETCH_TIMEOUT_MS,
        tavilyApiKey: env.TAVILY_API_KEY,
        companyUrl,
        cache: searchCache,
        budget: searchBudget,
      }),
  };
}
