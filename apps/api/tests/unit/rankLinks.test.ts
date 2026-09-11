import { describe, expect, it } from "vitest";
import { extractContent } from "../../src/retrieval/cleanHtml.js";
import { rankLinks, scoreLink } from "../../src/retrieval/rankLinks.js";
import { isSameSite, registrableDomain } from "../../src/retrieval/crawl.js";

const link = (url: string, text = "") => ({ url, text });

describe("scoreLink", () => {
  it("puts hiring pages above company pages above everything else", () => {
    const careers = scoreLink(link("https://acme.com/careers"));
    const about = scoreLink(link("https://acme.com/about"));
    const blog = scoreLink(link("https://acme.com/blog"));
    expect(careers).toBeGreaterThan(about);
    expect(about).toBeGreaterThan(blog);
  });

  it("scores a hiring page reached by anchor text, not just by path", () => {
    expect(scoreLink(link("https://acme.com/p/12", "How we hire"))).toBeGreaterThan(0);
  });

  it("pushes legal and account pages below zero", () => {
    expect(scoreLink(link("https://acme.com/privacy"))).toBeLessThan(0);
    expect(scoreLink(link("https://acme.com/login"))).toBeLessThan(0);
  });

  it("excludes assets and non-http links outright", () => {
    for (const url of [
      "https://acme.com/brochure.pdf",
      "https://acme.com/logo.png",
      "mailto:jobs@acme.com",
      "tel:+31201234567",
    ]) {
      expect(scoreLink(link(url)), url).toBe(-10);
    }
  });
});

describe("rankLinks", () => {
  it("orders by score, then by shorter path", () => {
    const ranked = rankLinks([
      link("https://acme.com/legal/privacy"),
      link("https://acme.com/blog"),
      // Scores 7: a careers path that is also an engineering one.
      link("https://acme.com/careers/engineering/backend"),
      link("https://acme.com/jobs"),
      link("https://acme.com/about"),
    ]);

    expect(ranked.map((r) => new URL(r.link.url).pathname)).toEqual([
      "/careers/engineering/backend",
      "/jobs",
      "/about",
      "/blog",
      "/legal/privacy",
    ]);
  });

  it("breaks a tie on score by preferring the shorter path", () => {
    const ranked = rankLinks([
      link("https://acme.com/company/team/leadership"),
      link("https://acme.com/about"),
    ]);
    expect(new URL(ranked[0]!.link.url).pathname).toBe("/about");
  });

  it("drops assets from the frontier entirely", () => {
    const ranked = rankLinks([link("https://acme.com/a.pdf"), link("https://acme.com/about")]);
    expect(ranked).toHaveLength(1);
  });
});

describe("extractContent", () => {
  const html = `<!doctype html><html><head><title>Acme</title></head>
    <body>
      <nav><a href="/careers">Careers</a></nav>
      <main><p>${"Readable body copy. ".repeat(20)}</p></main>
      <script>var tracking = 1;</script>
      <footer><a href="../legal/privacy.html">Privacy</a></footer>
    </body></html>`;

  it("resolves relative links against the page URL", () => {
    const page = extractContent(html, "https://acme.com/company/about.html");
    const urls = page.links.map((l) => l.url);
    expect(urls).toContain("https://acme.com/careers");
    expect(urls).toContain("https://acme.com/legal/privacy.html");
  });

  it("keeps the title and drops script contents", () => {
    const page = extractContent(html, "https://acme.com/");
    expect(page.title).toBe("Acme");
    expect(page.text).toContain("Readable body copy");
    expect(page.text).not.toContain("tracking");
  });

  it("collects links from navigation, which is where hiring pages hide", () => {
    const page = extractContent(html, "https://acme.com/");
    expect(page.links.some((l) => l.text === "Careers")).toBe(true);
  });
});

describe("registrableDomain and isSameSite", () => {
  it("treats subdomains of one company as the same site", () => {
    expect(registrableDomain("careers.acme.com")).toBe("acme.com");
    expect(isSameSite("https://careers.acme.com/x", "https://acme.com/")).toBe(true);
  });

  it("handles two-part public suffixes", () => {
    expect(registrableDomain("jobs.acme.co.uk")).toBe("acme.co.uk");
  });

  it("treats a different company as a different site", () => {
    expect(isSameSite("https://other.example/x", "https://acme.com/")).toBe(false);
  });

  it("requires an exact host for localhost and bare addresses", () => {
    expect(isSameSite("http://localhost:8099/acme/x", "http://localhost:8099/acme/")).toBe(true);
    expect(isSameSite("http://localhost:9000/x", "http://localhost:8099/")).toBe(false);
  });
});
