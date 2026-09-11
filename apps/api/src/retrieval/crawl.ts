import net from "node:net";
import type { SkippedPage } from "@prep/shared";
import type { CrawlResult, FetchedPage } from "../pipeline/types.js";
import { extractContent } from "./cleanHtml.js";
import { fetchPage, type FetchOptions } from "./fetchPage.js";
import { rankLinks } from "./rankLinks.js";
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

export type CrawlOptions = {
  maxPages: number;
  maxDepth: number;
  fetch: FetchOptions;
  robots: RobotsCache;
  politeDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onPage?: (url: string, index: number) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  let reachable = false;
  let requests = 0;

  while (frontier.length > 0 && pages.length < options.maxPages) {
    frontier.sort((a, b) => b.score - a.score || a.depth - b.depth);
    const candidate = frontier.shift()!;
    const key = candidate.url.replace(/\/$/, "");
    if (visited.has(key)) continue;
    visited.add(key);

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
    const extracted = extractContent(result.html, result.url);
    if (extracted.text.length < 120) {
      skipped.push({ url: result.url, reason: "page had almost no readable text" });
    } else {
      pages.push({ url: result.url, title: extracted.title, text: extracted.text });
      options.onPage?.(result.url, pages.length);
    }

    if (candidate.depth >= options.maxDepth) continue;

    for (const { link, score } of rankLinks(extracted.links)) {
      if (!isSameSite(link.url, startUrl)) continue;
      if (visited.has(link.url.replace(/\/$/, ""))) continue;
      frontier.push({ url: link.url, depth: candidate.depth + 1, score });
    }
  }

  return { pages, skipped, reachable };
}
