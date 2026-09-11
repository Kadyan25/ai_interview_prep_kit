import type { DiscussionHit } from "@prep/shared";
import { fetchJson } from "./fetchJson.js";

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

type TavilyResult = { title?: string; url?: string; content?: string };

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

/** Guards against a search for "Acme" returning threads about something else. */
function mentionsCompany(haystack: string, company: string): boolean {
  const name = company.trim().toLowerCase();
  if (name.length < 3) return false;
  return haystack.toLowerCase().includes(name);
}

export type DiscussionOptions = {
  timeoutMs: number;
  tavilyApiKey?: string | undefined;
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
    const combined = `${title} ${stripHtml(body)}`;
    if (!mentionsCompany(combined, company)) continue;
    if (stripHtml(body).length < 40 && title.length === 0) continue;

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

  const payload = await fetchJson<{ results?: TavilyResult[] }>(TAVILY_ENDPOINT, {
    timeoutMs: options.timeoutMs,
    method: "POST",
    body: {
      api_key: options.tavilyApiKey,
      query: `${company} interview process`,
      max_results: MAX_HITS,
      search_depth: "basic",
    },
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  if (!payload?.results) return [];

  return payload.results
    .filter((result): result is Required<TavilyResult> => Boolean(result.url && result.title))
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
