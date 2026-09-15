import net from "node:net";
import type { SkippedPage } from "@prep/shared";
import type { CrawlResult, FetchedPage } from "../pipeline/types.js";
import { extractContent } from "./cleanHtml.js";
import { fetchPage, type FetchOptions } from "./fetchPage.js";
import { isJobListing, rankLinks } from "./rankLinks.js";
import { discoverSeeds, type Seed } from "./seeds.js";
import type { RobotsCache } from "./robots.js";

/** A gap between requests to one site. Slower than necessary, and deliberately so. */
export const POLITE_DELAY_MS = 500;

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "gob", "or", "ne"]);

/**
 * Registrable domain, so acme.com and careers.acme.com count as one site while
 * acme.com and acmecdn.net do not. Hosts that are bare IPs or single labels
 * (localhost, a container name) only match themselves.
 */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase();
  if (net.isIP(host) !== 0) return host;
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const last = labels[labels.length - 1]!;
  const secondLast = labels[labels.length - 2]!;
  if (last.length === 2 && SECOND_LEVEL.has(secondLast) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

export function isSameSite(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    // A bare IP or localhost has no registrable domain to speak of, so require
    // the exact host and port to match.
    if (net.isIP(left.hostname) !== 0 || !left.hostname.includes(".")) {
      return left.host === right.host;
    }
    return registrableDomain(left.hostname) === registrableDomain(right.hostname);
  } catch {
    return false;
  }
}

function isBareHost(hostname: string): boolean {
  return net.isIP(hostname.replace(/^\[|\]$/g, "")) !== 0 || !hostname.includes(".");
}

/** The directory a start URL names: "/acme/" for "/acme", "/acme/" and "/acme/index.html". */
export function scopePath(startUrl: string): string {
  const pathname = new URL(startUrl).pathname;
  if (pathname.endsWith("/")) return pathname;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return last.includes(".") ? pathname.slice(0, pathname.lastIndexOf("/") + 1) : `${pathname}/`;
}

/**
 * Whether a link belongs to the company being researched. On a real domain that
 * is the whole registrable domain. On a bare IP or localhost several companies
 * can share one host under different paths (localhost:8099/acme/,
 * localhost:8099/other/), so the crawl also stays below the start path.
 */
export function inCrawlScope(url: string, startUrl: string): boolean {
  if (!isSameSite(url, startUrl)) return false;
  try {
    if (!isBareHost(new URL(startUrl).hostname)) return true;
    const scope = scopePath(startUrl);
    const pathname = new URL(url).pathname;
    return pathname.startsWith(scope) || pathname === scope.slice(0, -1);
  } catch {
    return false;
  }
}

export type CrawlOptions = {
  maxPages: number;
  maxDepth: number;
  fetch: FetchOptions;
  robots: RobotsCache;
  politeDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onPage?: (url: string, index: number) => void;
  /** Off in tests that only exercise link following. */
  seeds?: (startUrl: string, fetch: FetchOptions) => Promise<Seed[]>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Locale prefixes such as /en-in/ or /es/. Two-letter paths that are words on
 * their own (/ai/, /go/) are not locales, so bare codes come from a fixed list.
 */
const LOCALE = /^(?:[a-z]{2}-[a-z]{2}|en|es|de|fr|it|pt|nl|ja|ko|zh|sv|pl|tr|ru|da|fi|nb|he|id|hi)$/i;

/** Individual job ads fetched per crawl; one or two show the house style, more waste budget. */
export const MAX_JOB_LISTINGS = 2;

/**
 * One key per page. Tracking parameters, fragments, a trailing slash and
 * index.html all point at the same document, and fetching it three times under
 * three spellings spent a quarter of a live crawl's budget.
 */
export function pageKey(raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname
      .replace(/\/index\.html?$/i, "/")
      // /es/company and /de-de/company are translations of /company; one is enough.
      .replace(/^\/([^/]+)(?=\/|$)/, (whole, first: string) => (LOCALE.test(first) ? "" : whole))
      .replace(/\/+$/, "");
    return `${url.protocol}//${url.host.toLowerCase()}${path}`;
  } catch {
    return raw;
  }
}

/**
 * Pages read per top-level section (/customers, /blog). A live crawl of hex.tech
 * spent eight of its twelve pages on customer stories.
 */
export const MAX_PAGES_PER_SECTION = 3;


/**
 * "/en-in/blog/culture" → "blog", measured below the path the crawl started at,
 * so a site that lives at example.com/acme/ has sections of its own.
 * The homepage and section index pages have no section and are never capped.
 */
export function sectionOf(raw: string, startUrl: string): string | null {
  try {
    const base = scopePath(startUrl);
    let path = new URL(raw).pathname;
    if (path.startsWith(base)) path = path.slice(base.length);
    const segments = path.split("/").filter(Boolean);
    const at = segments.findIndex((segment) => !LOCALE.test(segment));
    // A section's own index page (/blog) is not one of its pages.
    return at >= 0 && at < segments.length - 1 ? segments[at]!.toLowerCase() : null;
  } catch {
    return null;
  }
}

type Candidate = { url: string; depth: number; score: number };

/**
 * Breadth-first, budgeted, and ordered by link score rather than document order:
 * with only twelve pages to spend, visiting /careers before /pricing is the
 * difference between finding the hiring process and missing it.
 */
export async function crawl(startUrl: string, options: CrawlOptions): Promise<CrawlResult> {
  const sleep = options.sleep ?? defaultSleep;
  const politeDelay = options.politeDelayMs ?? POLITE_DELAY_MS;

  const pages: FetchedPage[] = [];
  const skipped: SkippedPage[] = [];
  const visited = new Set<string>();
  const frontier: Candidate[] = [{ url: startUrl, depth: 0, score: Number.MAX_SAFE_INTEGER }];

  // The sitemap and the conventional hiring paths, tried before the homepage's own
  // links. A seed that does not exist costs one request and no page budget.
  for (const seed of await (options.seeds ?? discoverSeeds)(startUrl, options.fetch)) {
    if (inCrawlScope(seed.url, startUrl)) frontier.push({ url: seed.url, depth: 1, score: seed.score });
  }

  let reachable = false;
  let requests = 0;
  let listings = 0;
  const sections = new Map<string, number>();

  while (frontier.length > 0 && pages.length < options.maxPages) {
    frontier.sort((a, b) => b.score - a.score || a.depth - b.depth);
    const candidate = frontier.shift()!;
    const key = pageKey(candidate.url);
    if (visited.has(key)) continue;
    visited.add(key);

    if (isJobListing(candidate.url)) {
      if (listings >= MAX_JOB_LISTINGS) continue;
      listings += 1;
    }
    const section = sectionOf(candidate.url, startUrl);
    if (section) {
      const count = sections.get(section) ?? 0;
      if (count >= MAX_PAGES_PER_SECTION) continue;
      sections.set(section, count + 1);
    }

    if (!(await options.robots.isAllowed(candidate.url))) {
      skipped.push({ url: candidate.url, reason: "disallowed by robots.txt" });
      continue;
    }

    if (requests > 0) await sleep(politeDelay);
    requests += 1;

    const result = await fetchPage(candidate.url, options.fetch);
    if (!result.ok) {
      skipped.push({ url: candidate.url, reason: result.reason });
      continue;
    }

    reachable = true;
    // A redirect can land on a page already read under another address.
    const finalKey = pageKey(result.url);
    if (finalKey !== key) {
      if (visited.has(finalKey)) continue;
      visited.add(finalKey);
    }

    const extracted = extractContent(result.html, result.url);
    if (extracted.text.length < 120) {
      skipped.push({ url: result.url, reason: "page had almost no readable text" });
    } else {
      pages.push({ url: result.url, title: extracted.title, text: extracted.text });
      options.onPage?.(result.url, pages.length);
    }

    if (candidate.depth >= options.maxDepth) continue;

    for (const { link, score } of rankLinks(extracted.links)) {
      if (!inCrawlScope(link.url, startUrl)) continue;
      if (visited.has(pageKey(link.url))) continue;
      frontier.push({ url: link.url, depth: candidate.depth + 1, score });
    }
  }

  return { pages, skipped, reachable };
}
