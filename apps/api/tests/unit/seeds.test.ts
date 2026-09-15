import { describe, expect, it } from "vitest";
import { discoverSeeds, sitemapUrls } from "../../src/retrieval/seeds.js";
import { embeddedText } from "../../src/retrieval/cleanHtml.js";
import type { FetchOptions } from "../../src/retrieval/fetchPage.js";

/**
 * Measured on ten real sites: the crawler read plenty of text from six of them
 * and still found a hiring-process page on two, because those pages are not
 * linked from a homepage. Sitemaps and conventional paths are how it gets there.
 */

function fakeFetch(files: Record<string, string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const body = files[new URL(url).pathname];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(body, { status: 200, headers: { "Content-Type": "application/xml" } });
  }) as typeof fetch;
}

const options = (impl: typeof fetch): FetchOptions => ({
  timeoutMs: 1000,
  guard: { allowPrivate: true },
  sleep: async () => undefined,
  fetchImpl: impl,
});

const sitemap = (urls: string[]) =>
  `<?xml version="1.0"?><urlset>${urls.map((u) => `<loc>${u}</loc>`).join("")}</urlset>`;

describe("sitemapUrls", () => {
  it("reads sitemap.xml", async () => {
    const impl = fakeFetch({
      "/sitemap.xml": sitemap(["https://acme.test/", "https://acme.test/careers/how-we-hire"]),
    });
    await expect(sitemapUrls("https://acme.test/", options(impl))).resolves.toEqual([
      "https://acme.test/",
      "https://acme.test/careers/how-we-hire",
    ]);
  });

  it("follows a sitemap index to the hiring-looking child only", async () => {
    const impl = fakeFetch({
      "/sitemap.xml": `<?xml version="1.0"?><sitemapindex><loc>https://acme.test/sitemap-careers.xml</loc><loc>https://acme.test/sitemap-products.xml</loc></sitemapindex>`,
      "/sitemap-careers.xml": sitemap(["https://acme.test/careers/interview-process"]),
      "/sitemap-products.xml": sitemap(["https://acme.test/products/widget"]),
    });
    const urls = await sitemapUrls("https://acme.test/", options(impl));
    expect(urls).toEqual(["https://acme.test/careers/interview-process"]);
  });

  it("returns nothing when there is no sitemap", async () => {
    await expect(sitemapUrls("https://acme.test/", options(fakeFetch({})))).resolves.toEqual([]);
  });
});

describe("discoverSeeds", () => {
  it("offers the conventional hiring paths above ordinary links", async () => {
    const seeds = await discoverSeeds("https://acme.test/", options(fakeFetch({})));
    const paths = seeds.map((s) => new URL(s.url).pathname);
    expect(paths).toContain("/careers");
    expect(paths).toContain("/careers/interview-process");
    expect(paths).toContain("/how-we-hire");
    // Ordinary links score at most 9 in rankLinks, so seeds must outrank them.
    expect(Math.min(...seeds.map((s) => s.score))).toBeGreaterThan(9);
  });

  it("adds the hiring URLs a sitemap lists and ignores the rest", async () => {
    const impl = fakeFetch({
      "/sitemap.xml": sitemap([
        "https://acme.test/products/widget",
        "https://acme.test/blog/2026-launch",
        "https://acme.test/careers/interview-process",
        "https://acme.test/life-at-acme",
      ]),
    });
    const urls = (await discoverSeeds("https://acme.test/", options(impl))).map((s) => s.url);
    expect(urls).toContain("https://acme.test/careers/interview-process");
    expect(urls).toContain("https://acme.test/life-at-acme");
    expect(urls).not.toContain("https://acme.test/products/widget");
  });

  it("keeps seeds under the start path, for hosts that carry several companies", async () => {
    const seeds = await discoverSeeds("http://127.0.0.1:8099/acme/", options(fakeFetch({})));
    for (const seed of seeds) expect(seed.url, seed.url).toContain("/acme/");
  });
});

describe("embeddedText", () => {
  it("recovers copy from a framework payload when the body is empty", () => {
    const html = `<html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">
      {"props":{"pageProps":{"blocks":["Northwind Rail builds scheduling software for regional freight depots.","Dispatchers plan loading bays with it, and drivers see when their slot is ready."]}},"buildId":"a1b2c3"}
    </script></body></html>`;
    const text = embeddedText(html);
    expect(text).toContain("Northwind Rail builds scheduling software");
    expect(text).toContain("Dispatchers plan loading bays");
    expect(text).not.toContain("a1b2c3");
  });

  it("skips ids, file names and urls", () => {
    const html = `<script>{"a":"https://cdn.example.com/assets/main.0f3a2b.js","b":"chunk-vendors.4a2b1c.css","c":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}</script>`;
    expect(embeddedText(html)).toBe("");
  });
});
