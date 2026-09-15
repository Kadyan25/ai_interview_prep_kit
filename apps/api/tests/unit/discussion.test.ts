import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isAboutInterviewing,
  searchDiscussion,
  type DiscussionOptions,
} from "../../src/retrieval/discussion.js";
import {
  SEARCH_CACHE_TTL_MS,
  SearchBudget,
  createSearchCache,
} from "../../src/retrieval/searchCache.js";
import { howTheyHire } from "../../src/pipeline/steps/writeBrief.js";

/**
 * Relevance rules for public discussion. The live Hex run returned five Hacker
 * News hits, all about hex editors, colour codes or monthly hiring threads.
 */

describe("isAboutInterviewing", () => {
  it("accepts a comment that names the company next to an interview", () => {
    expect(
      isAboutInterviewing("I interviewed at Coinbase last spring, four rounds and a take-home.", "", "Coinbase"),
    ).toBe(true);
  });

  it("rejects a short name used as an ordinary word", () => {
    expect(
      isAboutInterviewing("In the interview they asked me to convert hex to decimal.", "", "Hex"),
    ).toBe(false);
    expect(
      isAboutInterviewing("The Hex interview process had a take-home and two calls.", "", "Hex"),
    ).toBe(true);
  });

  it("rejects press interviews and opinion threads that only say 'interview' or 'hiring'", () => {
    expect(isAboutInterviewing("", "Brian Armstrong (Coinbase) Interviewed on Clubhouse", "Coinbase")).toBe(false);
    expect(isAboutInterviewing("Sid of GitLab interview with Joe Jacks", "", "GitLab")).toBe(false);
    expect(
      isAboutInterviewing("GitLab is overvalued, and hiring more people will not fix that.", "", "GitLab"),
    ).toBe(false);
    expect(isAboutInterviewing("", "Coinbase Interviews for Engineering Roles", "Coinbase")).toBe(true);
  });

  it("requires the whole word, not a substring", () => {
    expect(isAboutInterviewing("My GitLabs interview went fine.", "", "GitLab")).toBe(false);
  });

  it("rejects monthly hiring threads even when the company posts in them", () => {
    expect(
      isAboutInterviewing(
        "Coinbase | Remote | Hiring backend engineers, interviews are async.",
        "Ask HN: Who is hiring? (May 2026)",
        "Coinbase",
      ),
    ).toBe(false);
  });

  it("rejects a mention with no hiring term close by", () => {
    const text = `Coinbase fees went up again. ${"Unrelated words. ".repeat(20)} My interview elsewhere was fine.`;
    expect(isAboutInterviewing(text, "", "Coinbase")).toBe(false);
  });

  it("counts the company's domain as a mention", () => {
    expect(
      isAboutInterviewing("The hex.tech interview loop had a SQL exercise.", "", "Hex Technologies", "https://hex.tech/"),
    ).toBe(true);
  });
});

describe("searchDiscussion", () => {
  const fakeFetch = (hits: unknown[]): typeof fetch =>
    (async () => new Response(JSON.stringify({ hits }), { status: 200 })) as typeof fetch;

  it("keeps only relevant Hacker News hits", async () => {
    const hits = await searchDiscussion("Hex", {
      timeoutMs: 1000,
      fetchImpl: fakeFetch([
        { objectID: "1", story_title: "Show HN: a hex viewer", comment_text: "Convert hex in your interview answers quickly please." },
        { objectID: "2", story_title: "Ask HN: Who is hiring? (June 2026)", comment_text: "Hex | Data | hiring, interviews remote" },
        { objectID: "3", story_title: "Data notebooks", comment_text: "I interviewed at Hex for a frontend role, it was a pairing round." },
      ]),
    });
    expect(hits.map((hit) => hit.url)).toEqual(["https://news.ycombinator.com/item?id=3"]);
  });

  it("returns nothing rather than throwing when the search is down", async () => {
    const down = (async () => new Response("", { status: 503 })) as typeof fetch;
    await expect(searchDiscussion("Coinbase", { timeoutMs: 1000, fetchImpl: down })).resolves.toEqual([]);
  });
});

describe("Tavily credit protection", () => {
  const tavilyResults = [
    {
      title: "Stripe Interview Process",
      url: "https://example.com/stripe-interviews",
      content: "Candidates describe the Stripe interview process as a phone screen, then a bug squash.",
    },
  ];

  /** Counts paid calls; Hacker News answers with nothing. */
  function countingFetch(tavilyStatus = 200) {
    const calls = { tavily: 0 };
    const impl = (async (input: string | URL | Request) => {
      if (String(input).includes("tavily")) {
        calls.tavily += 1;
        return new Response(JSON.stringify({ results: tavilyResults }), { status: tavilyStatus });
      }
      return new Response(JSON.stringify({ hits: [] }), { status: 200 });
    }) as typeof fetch;
    return { calls, impl };
  }

  const options = (impl: typeof fetch, extra: Partial<DiscussionOptions> = {}): DiscussionOptions => ({
    timeoutMs: 1000,
    tavilyApiKey: "test-key",
    companyUrl: "https://stripe.com",
    fetchImpl: impl,
    ...extra,
  });

  it("searches a company once and answers repeats from the cache", async () => {
    const { calls, impl } = countingFetch();
    const cache = createSearchCache({});
    const first = await searchDiscussion("Stripe", options(impl, { cache }));
    const second = await searchDiscussion("stripe", options(impl, { cache }));

    expect(calls.tavily).toBe(1);
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("keeps the cache across processes through its file", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "tavily-")), "cache.json");
    const { calls, impl } = countingFetch();
    await searchDiscussion("Stripe", options(impl, { cache: createSearchCache({ file }) }));
    await searchDiscussion("Stripe", options(impl, { cache: createSearchCache({ file }) }));
    expect(calls.tavily).toBe(1);
  });

  it("searches again once a cached result is a week old", async () => {
    let now = 0;
    const cache = createSearchCache({ now: () => now });
    const { calls, impl } = countingFetch();
    await searchDiscussion("Stripe", options(impl, { cache }));
    now = SEARCH_CACHE_TTL_MS + 1;
    await searchDiscussion("Stripe", options(impl, { cache }));
    expect(calls.tavily).toBe(2);
  });

  it("stops calling once the budget is spent", async () => {
    const { calls, impl } = countingFetch();
    const budget = new SearchBudget(1);
    await searchDiscussion("Stripe", options(impl, { budget }));
    const overBudget = await searchDiscussion("Stripe", options(impl, { budget }));
    expect(calls.tavily).toBe(1);
    expect(overBudget).toEqual([]);
  });

  it("does not cache a failed search", async () => {
    const cache = createSearchCache({});
    const failing = countingFetch(500);
    await searchDiscussion("Stripe", options(failing.impl, { cache }));
    const working = countingFetch();
    const hits = await searchDiscussion("Stripe", options(working.impl, { cache }));
    expect(working.calls.tavily).toBe(1);
    expect(hits).toHaveLength(1);
  });

  it("makes no paid call without a key", async () => {
    const { calls, impl } = countingFetch();
    await searchDiscussion("Stripe", options(impl, { tavilyApiKey: undefined }));
    expect(calls.tavily).toBe(0);
  });
});

describe("howTheyHire", () => {
  const hit = { url: "https://news.ycombinator.com/item?id=3", title: "t", snippet: "s" };
  const page = { url: "https://acme.test/about", title: "About", text: "About Acme." };

  it("states the company's own hiring page as fact", () => {
    expect(howTheyHire({ hiringProcess: "Three rounds", discussion: [], pages: [] }, "Three rounds.")).toBe(
      "Three rounds.",
    );
  });

  it("labels a process that could only have come from discussion as candidate reports", () => {
    const text = howTheyHire({ hiringProcess: null, discussion: [hit], pages: [] }, "A recruiter call, then pairing.");
    expect(text).toMatch(/candidate reports/i);
    expect(text).toContain("A recruiter call, then pairing.");
  });

  it("does not call it candidate reports when their own pages were read", () => {
    // A live run labelled the fixture site's own how-we-hire text as candidate reports.
    const bothSources = howTheyHire({ hiringProcess: null, discussion: [hit], pages: [page] }, "Screen, take-home, panel.");
    expect(bothSources).toMatch(/their site and public posts/i);
    expect(bothSources).not.toMatch(/candidate reports/i);

    const siteOnly = howTheyHire({ hiringProcess: null, discussion: [], pages: [page] }, "Screen, take-home, panel.");
    expect(siteOnly).toMatch(/rest of their site/i);
    expect(siteOnly).toContain("Screen, take-home, panel.");
  });

  it("says nothing was found when no source describes a process", () => {
    expect(howTheyHire({ hiringProcess: null, discussion: [hit], pages: [page] }, "")).toMatch(/no public description/i);
    expect(
      howTheyHire({ hiringProcess: null, discussion: [hit], pages: [] }, "No public description was found."),
    ).toMatch(/no public description/i);
    expect(howTheyHire({ hiringProcess: null, discussion: [], pages: [] }, "Made-up loop")).toMatch(
      /no public description/i,
    );
  });
});
