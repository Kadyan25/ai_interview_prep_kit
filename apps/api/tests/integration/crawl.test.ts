import type http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureServer, listenOn } from "../../src/cli/fixtureServer.js";
import { crawl } from "../../src/retrieval/crawl.js";
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
