import { describe, expect, it } from "vitest";
import { isAboutInterviewing, searchDiscussion } from "../../src/retrieval/discussion.js";
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

describe("howTheyHire", () => {
  const hit = { url: "https://news.ycombinator.com/item?id=3", title: "t", snippet: "s" };

  it("states the company's own page as fact", () => {
    expect(howTheyHire({ hiringProcess: "Three rounds", discussion: [] }, "Three rounds.")).toBe("Three rounds.");
  });

  it("labels a process taken from discussion as candidate reports", () => {
    const text = howTheyHire({ hiringProcess: null, discussion: [hit] }, "A recruiter call, then a pairing round.");
    expect(text).toMatch(/candidate reports/i);
    expect(text).toContain("A recruiter call, then a pairing round.");
  });

  it("says nothing was found when neither source describes a process", () => {
    expect(howTheyHire({ hiringProcess: null, discussion: [hit] }, "")).toMatch(/no public description/i);
    expect(
      howTheyHire({ hiringProcess: null, discussion: [hit] }, "No public description of the process was found."),
    ).not.toMatch(/candidate reports/i);
    expect(howTheyHire({ hiringProcess: null, discussion: [] }, "Made-up loop")).toMatch(/no public description/i);
  });
});
