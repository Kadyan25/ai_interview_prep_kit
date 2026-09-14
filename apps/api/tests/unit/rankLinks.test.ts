import { describe, expect, it } from "vitest";
import { extractContent } from "../../src/retrieval/cleanHtml.js";
import { isJobListing, rankLinks, scoreLink } from "../../src/retrieval/rankLinks.js";
import { isSameSite, pageKey, registrableDomain, sectionOf } from "../../src/retrieval/crawl.js";

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

describe("isJobListing", () => {
  it("recognises individual job ads under the usual roots", () => {
    for (const url of [
      "https://hex.tech/careers/senior-software-engineer-4821",
      "https://acme.com/jobs/123",
      "https://acme.com/en/positions/backend/remote",
      "https://acme.com/careers/openings/staff-pm",
      "https://hex.tech/careers/recruiting-coordinator/",
    ]) {
      expect(isJobListing(url), url).toBe(true);
    }
  });

  it("leaves careers indexes and hiring process pages alone", () => {
    for (const url of [
      "https://acme.com/careers",
      "https://acme.com/careers/",
      "https://acme.com/careers/index.html",
      "https://acme.com/careers/how-we-hire",
      "https://acme.com/jobs/interview-process",
      "https://acme.com/careers/life-at-acme",
      "https://acme.com/about/team",
    ]) {
      expect(isJobListing(url), url).toBe(false);
    }
  });

  it("ranks a job ad below the about page", () => {
    expect(scoreLink(link("https://acme.com/careers/backend-engineer-12"))).toBeLessThan(
      scoreLink(link("https://acme.com/about")),
    );
  });
});

describe("sectionOf", () => {
  it("names the top-level section, skipping a locale prefix", () => {
    expect(sectionOf("https://hex.tech/customers/ramp/", "https://hex.tech")).toBe("customers");
    expect(sectionOf("https://www.coinbase.com/en-in/blog/culture", "https://www.coinbase.com/en-in")).toBe("blog");
  });

  it("leaves the homepage and section index pages uncapped", () => {
    expect(sectionOf("https://hex.tech/", "https://hex.tech")).toBeNull();
    expect(sectionOf("https://hex.tech/customers/", "https://hex.tech")).toBeNull();
  });

  it("measures below the path the crawl started at", () => {
    expect(sectionOf("http://127.0.0.1:8099/acme/people/how-we-hire.html", "http://127.0.0.1:8099/acme/")).toBe(
      "people",
    );
  });
});

describe("pageKey", () => {
  it("gives every spelling of one page the same key", () => {
    const spellings = [
      "https://Acme.com/about",
      "https://acme.com/about/",
      "https://acme.com/about?utm_source=nav",
      "https://acme.com/about#team",
      "https://acme.com/about/index.html",
    ];
    expect(new Set(spellings.map(pageKey)).size).toBe(1);
  });

  it("treats translations of a page as the same page", () => {
    const company = pageKey("https://about.gitlab.com/company/");
    expect(pageKey("https://about.gitlab.com/es/company/")).toBe(company);
    expect(pageKey("https://about.gitlab.com/de-de/company/")).toBe(company);
  });

  it("does not mistake a two-letter section for a locale", () => {
    expect(pageKey("https://acme.com/ai/")).not.toBe(pageKey("https://acme.com/"));
  });

  it("keeps different pages apart", () => {
    expect(pageKey("https://acme.com/about")).not.toBe(pageKey("https://acme.com/careers"));
    expect(pageKey("http://acme.com/about")).not.toBe(pageKey("https://acme.com/about"));
  });
});

describe("rankLinks", () => {
  it("orders by score, then by shorter path", () => {
    const ranked = rankLinks([
      link("https://acme.com/legal/privacy"),
      link("https://acme.com/blog"),
      // A single job ad: it repeats the posting the user pasted.
      link("https://acme.com/careers/engineering/backend"),
      link("https://acme.com/jobs"),
      link("https://acme.com/about"),
    ]);

    expect(ranked.map((r) => new URL(r.link.url).pathname)).toEqual([
      "/jobs",
      "/about",
      "/blog",
      "/careers/engineering/backend",
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

  it("keeps words in adjacent elements apart", () => {
    // Real job boards render headings and paragraphs with no whitespace
    // between the tags, which used to come out as "About the roleWe are".
    const tight =
      "<main><h2>About the role</h2><p>We are hiring.</p><ul><li>Go</li><li>gRPC</li></ul>" +
      "<p>First line<br>Second line</p>" +
      "<p>" + "Filler so main counts as content. ".repeat(10) + "</p></main>";
    const page = extractContent(tight, "https://acme.com/");

    expect(page.text).not.toMatch(/roleWe/);
    expect(page.text).not.toMatch(/GogRPC/);
    expect(page.text).not.toMatch(/lineSecond/);
    expect(page.text).toContain("About the role\nWe are hiring.");
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
