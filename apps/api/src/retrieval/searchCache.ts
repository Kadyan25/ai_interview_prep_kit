import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Paid search results, remembered. Tavily's free plan is 1,000 credits and every
 * search costs one, so building a kit for the same company twice — which local
 * testing does constantly — must not pay twice. Candidate reports about a
 * company's interviews do not change within a week.
 */

export const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A search result as the provider returned it, before any relevance filtering. */
export type RawSearchResult = { title?: string; url?: string; content?: string };

type Entry = { at: number; hits: RawSearchResult[] };

export type SearchCache = {
  get(key: string): Promise<RawSearchResult[] | null>;
  set(key: string, hits: RawSearchResult[]): Promise<void>;
};

export function createSearchCache(options: {
  file?: string | undefined;
  ttlMs?: number;
  now?: () => number;
}): SearchCache {
  const ttl = options.ttlMs ?? SEARCH_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  let entries: Map<string, Entry> | null = null;

  async function load(): Promise<Map<string, Entry>> {
    if (entries) return entries;
    entries = new Map();
    if (!options.file) return entries;
    try {
      const raw = JSON.parse(await readFile(options.file, "utf8")) as Record<string, Entry>;
      for (const [key, entry] of Object.entries(raw)) entries.set(key, entry);
    } catch {
      // No file yet, or a damaged one: start empty rather than fail a kit.
    }
    return entries;
  }

  return {
    async get(key) {
      const entry = (await load()).get(key);
      return entry && now() - entry.at < ttl ? entry.hits : null;
    },
    async set(key, hits) {
      const map = await load();
      map.set(key, { at: now(), hits });
      if (!options.file) return;
      try {
        await mkdir(path.dirname(options.file), { recursive: true });
        await writeFile(options.file, JSON.stringify(Object.fromEntries(map), null, 2));
      } catch {
        // Losing the disk copy only costs a future credit; the memory copy still works.
      }
    },
  };
}

/**
 * A hard ceiling on paid searches per process, so a runaway batch or a retry loop
 * cannot drain the plan. Past it, discussion falls back to Hacker News alone.
 */
export class SearchBudget {
  private used = 0;

  constructor(private readonly limit: number) {}

  trySpend(): boolean {
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }

  get spent(): number {
    return this.used;
  }
}
