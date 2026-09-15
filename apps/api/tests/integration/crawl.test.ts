import type http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureServer, listenOn } from "../../src/cli/fixtureServer.js";
import { MAX_JOB_LISTINGS, crawl, pageKey } from "../../src/retrieval/crawl.js";
import { fetchPage, type FetchOptions } from "../../src/retrieval/fetchPage.js";
import { RobotsCache } from "../../src/retrieval/robots.js";
import { findHiringPage } from "../../src/pipeline/steps/findHiringPage.js";

let server: http.Server;
let base: string;

const fetchOptions = (): FetchOptions => ({
  timeoutMs: 5000,
  // The fixture site is on loopback, which the guard blocks unless told not to.
  guard: { allowPrivate: true },
});

async function crawlSite(pathname: string, overrides: Partial<Parameters<typeof crawl>[1]> = {}) {
  const options = fetchOptions();
  return crawl(`${base}${pathname}`, {
    maxPages: 12,
    maxDepth: 2,
    fetch: options,
    robots: new RobotsCache(options),
    politeDelayMs: 0,
    ...overrides,
  });
}

beforeAll(async () => {
  server = createFixtureServer();
  const port = await listenOn(server, 0);
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("crawl against a real fixture site", () => {
  it("reads the homepage and follows relative links", async () => {
    const result = await crawlSite("/acme/");
    const urls = result.pages.map((p) => p.url);

    expect(result.reachable).toBe(true);
    expect(urls).toContain(`${base}/acme/`);
    expect(urls.some((u) => u.endsWith("/acme/about.html"))).toBe(true);
  });

  it("finds a hiring page that is two links deep and not under /careers", async () => {
    const result = await crawlSite("/acme/");
    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain(`${base}/acme/people/how-we-hire.html`);

    const found = findHiringPage(result.pages);
    expect(found.page?.url).toBe(`${base}/acme/people/how-we-hire.html`);
    expect(found.page?.text).toMatch(/take-home/i);
  });

  it("obeys robots.txt", async () => {
    const result = await crawlSite("/acme/");
    expect(result.pages.some((p) => p.url.includes("/internal/"))).toBe(false);
    expect(
      result.skipped.some(
        (s) => s.url.includes("/internal/") && s.reason.includes("robots"),
      ),
    ).toBe(true);
  });

  it("stays on the same site", async () => {
    const result = await crawlSite("/acme/");
    expect(result.pages.every((p) => p.url.startsWith(base))).toBe(true);
  });

  it("respects the page budget", async () => {
    const result = await crawlSite("/acme/", { maxPages: 2 });
    expect(result.pages).toHaveLength(2);
  });

  it("does not descend past the depth limit", async () => {
    // how-we-hire is only reachable at depth 2, via about.
    const shallow = await crawlSite("/acme/", { maxDepth: 1 });
    expect(shallow.pages.some((p) => p.url.includes("how-we-hire"))).toBe(false);
  });

  it("prefers hiring and company pages over legal ones", async () => {
    const result = await crawlSite("/acme/", { maxPages: 3 });
    const paths = result.pages.map((p) => new URL(p.url).pathname);
    expect(paths.some((p) => p.includes("privacy"))).toBe(false);
  });

  it("reports honestly when a company publishes nothing about hiring", async () => {
    const result = await crawlSite("/nohire/");
    expect(result.pages.length).toBeGreaterThan(1);
    expect(findHiringPage(result.pages).page).toBeNull();
  });

  it("reads the hiring process page before individual job ads, and only a couple of those", async () => {
    const result = await crawlSite("/jobsite/");
    const paths = result.pages.map((p) => new URL(p.url).pathname);

    expect(paths).toContain("/jobsite/careers/how-we-hire.html");
    const ads = paths.filter((p) => /-\d+\.html$/.test(p));
    expect(ads.length).toBeLessThanOrEqual(MAX_JOB_LISTINGS);
    expect(paths.indexOf("/jobsite/careers/how-we-hire.html")).toBeLessThan(
      Math.min(...ads.map((ad) => paths.indexOf(ad))),
    );
  });

  it("fetches a page once however many ways it is linked", async () => {
    const result = await crawlSite("/jobsite/");
    const keys = result.pages.map((p) => pageKey(p.url));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k.endsWith("/jobsite/about.html"))).toHaveLength(1);
    expect(keys.filter((k) => k.endsWith("/jobsite/careers"))).toHaveLength(1);
  });

  it("stays below the start path when companies share one host", async () => {
    for (const start of ["/acme/", "/acme"]) {
      const result = await crawlSite(start);
      const paths = result.pages.map((p) => new URL(p.url).pathname);
      expect(paths.length).toBeGreaterThan(1);
      expect(paths.every((p) => p.startsWith("/acme")), `${start}: ${paths.join(", ")}`).toBe(true);
    }
  });

  it("reaches a hiring page on a site with no links to follow", async () => {
    // /spa/ renders in the browser: its body is an empty div and its copy lives in
    // a JSON payload, so there is no link on it at all. Only the conventional
    // paths get the crawler to /spa/careers/ and from there to how-we-hire.
    const result = await crawlSite("/spa/");
    const paths = result.pages.map((p) => new URL(p.url).pathname);

    expect(paths).toContain("/spa/careers/");
    expect(paths).toContain("/spa/careers/how-we-hire.html");
    expect(findHiringPage(result.pages).page?.url).toContain("how-we-hire");
  });

  it("reads the copy a client-rendered page ships as JSON", async () => {
    const result = await crawlSite("/spa/");
    const home = result.pages.find((p) => new URL(p.url).pathname === "/spa/");
    expect(home?.text).toContain("Northwind Rail builds scheduling software");
  });

  it("does not read a sign-in page as company research", async () => {
    // A probe for /interview-process on a real site redirected to its login page.
    const walled = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("robots.txt")) return new Response("", { status: 404 });
      const body = url.includes("/login")
        ? "<html><head><title>Log in</title></head><body><main><p>Sign in to continue to your dashboard. Enter the email address you use at work and we will send you a link.</p></main></body></html>"
        : `<html><head><title>Home</title></head><body><main><p>${"Readable body copy. ".repeat(20)}</p><a href="/login?next=/interview-process">Interview process</a></main></body></html>`;
      return new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
    }) as typeof fetch;

    const options = { ...fetchOptions(), fetchImpl: walled };
    const result = await crawl("https://walled.test/", {
      maxPages: 5,
      maxDepth: 2,
      fetch: options,
      robots: new RobotsCache(options),
      politeDelayMs: 0,
      seeds: async () => [],
    });

    expect(result.pages.some((p) => p.url.includes("/login"))).toBe(false);
    expect(result.skipped.some((s) => s.reason.includes("sign-in wall"))).toBe(true);
  });

  it("returns unreachable rather than throwing for a dead host", async () => {
    const options = fetchOptions();
    const result = await crawl("http://127.0.0.1:1/", {
      maxPages: 4,
      maxDepth: 1,
      fetch: { ...options, timeoutMs: 1500 },
      robots: new RobotsCache(options),
      politeDelayMs: 0,
    });

    expect(result.reachable).toBe(false);
    expect(result.pages).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
  });
});

describe("fetchPage against a real server", () => {
  it("refuses a URL the guard rejects", async () => {
    const result = await fetchPage(`${base}/acme/`, {
      timeoutMs: 2000,
      guard: { allowPrivate: false },
    });
    expect(result.ok).toBe(false);
  });

  it("returns a reason instead of throwing on 404", async () => {
    const result = await fetchPage(`${base}/acme/missing.html`, fetchOptions());
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("404");
  });

  it("follows a directory redirect to index.html", async () => {
    const result = await fetchPage(`${base}/acme/blog`, fetchOptions());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toContain("Engineering blog");
  });

  it("reads robots.txt as text", async () => {
    const result = await fetchPage(`${base}/robots.txt`, fetchOptions());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toContain("Disallow");
  });
});
