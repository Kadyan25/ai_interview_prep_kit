import type { DiscussionHit } from "@prep/shared";
import { fetchJson } from "./fetchJson.js";
import type { RawSearchResult, SearchBudget, SearchCache } from "./searchCache.js";

const HN_ENDPOINT = "https://hn.algolia.com/api/v1/search";
const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const MAX_HITS = 5;
const SNIPPET_CHARS = 320;

type HnHit = {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  url?: string | null;
  story_url?: string | null;
  comment_text?: string | null;
  story_text?: string | null;
};

type TavilyResult = RawSearchResult;

function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function snippet(text: string): string {
  const clean = stripHtml(text);
  return clean.length > SNIPPET_CHARS ? `${clean.slice(0, SNIPPET_CHARS)}…` : clean;
}

// Phrases about being a candidate. A bare "interview" also matches press
// interviews with founders, and a bare "hiring" matches opinion threads.
const HIRING_TERMS =
  /\b(interview(?:s|ing)? (?:process|loop|rounds?|questions?|experience|stages?|for)|interviewed (?:at|with|for)|(?:hiring|recruiting) (?:process|manager|bar)|got hired|recruiters?|on-?site interview|take-?home|leetcode|phone screen|coding (?:test|challenge|round|exercise)|system design (?:round|interview)|(?:job )?offer from)\b/i;
// Monthly hiring threads mention hundreds of companies, none of them about interviewing.
const HIRING_THREAD = /who is hiring|who wants to be hired|seeking freelancer/i;
// How far either side of the company name a hiring term may sit and still be about it.
const NEAR_CHARS = 160;
// Names this short are also ordinary words ("Hex", "Box", "Ramp"), so case must match.
const SHORT_NAME_CHARS = 4;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The company's own domain, e.g. "hex.tech", which is an unambiguous mention. */
function domainOf(companyUrl: string | undefined): string | null {
  if (!companyUrl) return null;
  try {
    return new URL(companyUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Guards against a search for "Hex" returning threads about hex editors. The
 * name must appear as a whole word (case-sensitive when short) with an
 * interview or hiring term close by; a mention of the company's domain counts.
 */
export function isAboutInterviewing(
  text: string,
  title: string,
  company: string,
  companyUrl?: string,
): boolean {
  if (HIRING_THREAD.test(title)) return false;
  const name = company.trim();
  if (name.length < 3) return false;

  const patterns = [
    new RegExp(`\\b${escapeRegExp(name)}\\b`, name.length <= SHORT_NAME_CHARS ? "g" : "gi"),
  ];
  const domain = domainOf(companyUrl);
  if (domain) patterns.push(new RegExp(escapeRegExp(domain), "gi"));

  const haystack = `${title}\n${text}`;
  return patterns.some((pattern) =>
    [...haystack.matchAll(pattern)].some((match) => {
      const at = match.index ?? 0;
      const window = haystack.slice(Math.max(0, at - NEAR_CHARS), at + match[0].length + NEAR_CHARS);
      return HIRING_TERMS.test(window);
    }),
  );
}

export type DiscussionOptions = {
  timeoutMs: number;
  tavilyApiKey?: string | undefined;
  companyUrl?: string | undefined;
  cache?: SearchCache;
  budget?: SearchBudget;
  fetchImpl?: typeof fetch;
};

async function searchHackerNews(
  company: string,
  options: DiscussionOptions,
): Promise<DiscussionHit[]> {
  const query = encodeURIComponent(`"${company}" interview`);
  const url = `${HN_ENDPOINT}?query=${query}&tags=(story,comment)&hitsPerPage=10`;
  const payload = await fetchJson<{ hits?: HnHit[] }>(url, {
    timeoutMs: options.timeoutMs,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  if (!payload?.hits) return [];

  const hits: DiscussionHit[] = [];
  for (const hit of payload.hits) {
    const title = (hit.title ?? hit.story_title ?? "").trim();
    const body = hit.comment_text ?? hit.story_text ?? "";
    const text = stripHtml(body);
    if (text.length < 40 && title.length === 0) continue;
    if (!isAboutInterviewing(text, title, company, options.companyUrl)) continue;

    hits.push({
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      title: title || "Hacker News comment",
      snippet: snippet(body || title),
    });
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
}

async function searchTavily(
  company: string,
  options: DiscussionOptions,
): Promise<DiscussionHit[]> {
  if (!options.tavilyApiKey) return [];

  const cacheKey = `${company.trim().toLowerCase()}|${domainOf(options.companyUrl) ?? ""}`;
  const cached = await options.cache?.get(cacheKey);
  if (cached) return relevantTavilyHits(cached, company, options);
  if (options.budget && !options.budget.trySpend()) return [];

  const payload = await fetchJson<{ results?: TavilyResult[] }>(TAVILY_ENDPOINT, {
    timeoutMs: options.timeoutMs,
    method: "POST",
    headers: { Authorization: `Bearer ${options.tavilyApiKey}` },
    body: {
      query: `"${company}" interview process`,
      max_results: MAX_HITS,
      // "basic" costs one credit; "advanced" costs two. Never let the API pick.
      search_depth: "basic",
      auto_parameters: false,
    },
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  // A failed call is not cached, so the next kit may try again.
  if (!payload?.results) return [];

  // Raw results are kept so a later change to the relevance filter costs no credits.
  await options.cache?.set(cacheKey, payload.results);
  return relevantTavilyHits(payload.results, company, options);
}

function relevantTavilyHits(
  results: TavilyResult[],
  company: string,
  options: DiscussionOptions,
): DiscussionHit[] {
  return results
    .filter((result): result is Required<TavilyResult> => Boolean(result.url && result.title))
    .filter((result) =>
      isAboutInterviewing(result.content ?? "", result.title, company, options.companyUrl),
    )
    .map((result) => ({
      url: result.url,
      title: result.title,
      snippet: snippet(result.content ?? ""),
    }))
    .slice(0, MAX_HITS);
}

/**
 * What candidates say publicly about interviewing there. Hacker News needs no
 * key and covers technology companies well; Tavily widens it when a key is set.
 * Finding nothing is a normal result and the kit says so.
 */
export async function searchDiscussion(
  company: string,
  options: DiscussionOptions,
): Promise<DiscussionHit[]> {
  if (company.trim().length < 3) return [];

  const [hn, tavily] = await Promise.all([
    searchHackerNews(company, options),
    searchTavily(company, options),
  ]);

  const merged: DiscussionHit[] = [];
  const seen = new Set<string>();
  for (const hit of [...hn, ...tavily]) {
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);
    merged.push(hit);
    if (merged.length >= MAX_HITS * 2) break;
  }
  return merged;
}
