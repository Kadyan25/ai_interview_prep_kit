import { fetchPage, type FetchOptions } from "./fetchPage.js";
import { scopePath } from "./crawl.js";
import { isJobListing } from "./rankLinks.js";

/**
 * Where to start a crawl, beyond the homepage.
 *
 * Following links from the homepage finds what the homepage links to, which on a
 * large site is the product, not the hiring process. Measured on ten real sites:
 * the crawler read plenty of text from six of them and still found a description
 * of hiring on two, while hex.tech alone lists 72 hiring-related URLs in its
 * sitemap. So the sitemap is read first, and a handful of conventional paths are
 * offered as candidates. They cost nothing unless they rank high enough to fetch.
 */

const SITEMAP_PATHS = ["sitemap.xml", "sitemap_index.xml"];
const MAX_SITEMAP_BYTES_URLS = 5_000;
const MAX_NESTED_SITEMAPS = 2;
const MAX_SITEMAP_SEEDS = 8;

/** Paths that carry hiring information on a large share of company sites. */
const CONVENTIONAL_PATHS = [
  "careers",
  "jobs",
  "careers/interview-process",
  "interview-process",
  "how-we-hire",
  "handbook/hiring",
  "about",
  "culture",
];

/** Worth reading as a page: about how they work or hire, not a single job ad. */
const HIRING_URL =
  /interview|how-we-hire|hiring|recruit|careers?\/(process|life|culture|about|faq)|life-at|handbook|culture|values|about-us/i;

/** Worth opening as a child sitemap: broader, since the file name is all we have. */
const HIRING_SITEMAP = /career|job|hiring|interview|handbook|about|culture|people|company/i;

export type Seed = { url: string; score: number };

function unique(seeds: Seed[]): Seed[] {
  const seen = new Set<string>();
  return seeds.filter((seed) => {
    if (seen.has(seed.url)) return false;
    seen.add(seed.url);
    return true;
  });
}

/** Reads sitemap.xml (following a sitemap index one level) and returns its URLs. */
export async function sitemapUrls(startUrl: string, options: FetchOptions): Promise<string[]> {
  const origin = new URL(startUrl).origin;
  for (const path of SITEMAP_PATHS) {
    const result = await fetchPage(`${origin}/${path}`, { ...options, anyContentType: true });
    if (!result.ok) continue;

    const locations = [...result.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
      .map((match) => match[1]!)
      .slice(0, MAX_SITEMAP_BYTES_URLS);
    const isIndex = /<sitemapindex/i.test(result.html);
    if (!isIndex) return locations;

    // A sitemap index points at more sitemaps; only the hiring-ish ones are worth opening.
    const nested = locations.filter((url) => HIRING_SITEMAP.test(url)).slice(0, MAX_NESTED_SITEMAPS);
    const urls: string[] = [];
    for (const child of nested) {
      const page = await fetchPage(child, { ...options, anyContentType: true });
      if (!page.ok) continue;
      urls.push(...[...page.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]!));
    }
    return urls.slice(0, MAX_SITEMAP_BYTES_URLS);
  }
  return [];
}

/**
 * Seeds for one crawl: conventional paths under the start path, plus the most
 * hiring-like URLs the sitemap lists. Scored above ordinary links so they are
 * visited before whatever the homepage happens to point at.
 */
export async function discoverSeeds(startUrl: string, options: FetchOptions): Promise<Seed[]> {
  const base = new URL(scopePath(startUrl), startUrl);
  const conventional = CONVENTIONAL_PATHS.map((path, index) => ({
    url: new URL(path, base).toString(),
    // Ahead of homepage links (max 9), and in the order listed.
    score: 20 - index,
  }));

  let fromSitemap: Seed[] = [];
  try {
    const urls = await sitemapUrls(startUrl, options);
    fromSitemap = urls
      // A sitemap lists every job ad too, and those repeat the posting the user pasted.
      .filter((url) => HIRING_URL.test(url) && !isJobListing(url))
      .slice(0, MAX_SITEMAP_SEEDS)
      .map((url) => ({ url, score: 12 }));
  } catch {
    // A missing or unreadable sitemap is the normal case, not a failure.
  }

  return unique([...conventional, ...fromSitemap]);
}
