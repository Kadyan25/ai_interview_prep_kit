import type { FetchedPage } from "../types.js";

/**
 * Picks the page that actually describes how they interview. Keyword counting
 * rather than a model call: it is free, instant and explainable, and the model
 * gets the winning page's text anyway.
 */
const SIGNALS = [
  "interview",
  "take-home",
  "take home",
  "rounds",
  "onsite",
  "on-site",
  "hiring process",
  "our process",
  "stages",
  "screen",
  "assessment",
  "what to expect",
  "how we hire",
];

const THRESHOLD = 4;

export function scoreHiringPage(page: FetchedPage): number {
  const haystack = `${page.title}\n${page.text}`.toLowerCase();
  let score = 0;
  for (const signal of SIGNALS) {
    const occurrences = haystack.split(signal).length - 1;
    if (occurrences > 0) score += Math.min(occurrences, 3);
  }
  return score;
}

export function findHiringPage(pages: FetchedPage[]): {
  page: FetchedPage | null;
  score: number;
} {
  let best: FetchedPage | null = null;
  let bestScore = 0;

  for (const page of pages) {
    const score = scoreHiringPage(page);
    if (score > bestScore) {
      best = page;
      bestScore = score;
    }
  }

  return bestScore >= THRESHOLD ? { page: best, score: bestScore } : { page: null, score: bestScore };
}
