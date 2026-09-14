import type { PageLink } from "./cleanHtml.js";

/**
 * Deterministic link scoring, no model call. The crawl budget is twelve pages, so
 * the order they are visited in decides whether the hiring page is found at all.
 */

const SCORES: { score: number; patterns: string[] }[] = [
  { score: 5, patterns: ["careers", "career", "jobs", "hiring", "join-us", "join us", "work-with-us", "interview", "apply"] },
  { score: 4, patterns: ["handbook", "how-we-hire", "how we hire", "hiring-process", "hiring process", "recruiting", "recruitment", "life-at", "what-to-expect"] },
  { score: 3, patterns: ["about", "company", "team", "culture", "values", "mission", "people"] },
  { score: 2, patterns: ["engineering", "blog", "tech", "product", "docs"] },
  { score: -5, patterns: ["login", "signin", "sign-in", "signup", "privacy", "terms", "legal", "cookie", "cart", "pricing", "status", "press"] },
];

const BAD_ENDINGS = [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".zip", ".mp4", ".webp", ".ico", ".css", ".js", ".xml", ".rss"];

const LISTING_ROOTS = new Set(["careers", "career", "jobs", "job", "positions", "openings", "roles", "vacancies", "opportunities"]);
// Not "recruit": /careers/recruiting-coordinator is a job ad, not a process page.
const PROCESS_WORDS = /hire|hiring|interview|process|expect|how-we|life-at|culture|benefit|values/;

/**
 * An individual job ad such as /careers/senior-backend-engineer-4821. Its text
 * repeats a posting the user already pasted, and a careers page can link fifty of
 * them, so they must not crowd out the pages that describe how hiring works.
 */
export function isJobListing(raw: string): boolean {
  let segments: string[];
  try {
    segments = new URL(raw).pathname
      .toLowerCase()
      .split("/")
      .filter((segment) => segment && !/^index\.html?$/.test(segment));
  } catch {
    return false;
  }
  const root = segments.findIndex((segment) => LISTING_ROOTS.has(segment));
  if (root === -1 || root === segments.length - 1) return false;
  const rest = segments.slice(root + 1).join("/");
  return !PROCESS_WORDS.test(rest);
}

// Below "about" (3) but above zero: worth a visit only once better pages run out.
const JOB_LISTING_SCORE = 1;

export function scoreLink(link: PageLink): number {
  let url: URL;
  try {
    url = new URL(link.url);
  } catch {
    return -10;
  }

  const path = url.pathname.toLowerCase();
  if (BAD_ENDINGS.some((ending) => path.endsWith(ending))) return -10;
  if (url.protocol !== "http:" && url.protocol !== "https:") return -10;
  if (isJobListing(link.url)) return JOB_LISTING_SCORE;

  const haystack = `${path} ${link.text.toLowerCase()}`;
  let score = 0;
  for (const { score: value, patterns } of SCORES) {
    if (patterns.some((pattern) => haystack.includes(pattern))) score += value;
  }
  return score;
}

/** Highest score first; ties broken by the shorter path, then alphabetically. */
export function rankLinks(links: PageLink[]): { link: PageLink; score: number }[] {
  return links
    .map((link) => ({ link, score: scoreLink(link) }))
    .filter((entry) => entry.score > -10)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aPath = safePath(a.link.url);
      const bPath = safePath(b.link.url);
      if (aPath.length !== bPath.length) return aPath.length - bPath.length;
      return aPath.localeCompare(bPath);
    });
}

function safePath(raw: string): string {
  try {
    return new URL(raw).pathname;
  } catch {
    return raw;
  }
}
