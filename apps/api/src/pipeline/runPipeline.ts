import type { DiscussionHit, KitSource, SkippedPage } from "@prep/shared";
import { AppError } from "../lib/errors.js";
import { assembleKit, assignFlashcardIds, assignQuestionIds, pruneUnreferenced } from "./canonical.js";
import { allocateSchedule } from "./schedule.js";
import { runCoverageLoop } from "./steps/coverageLoop.js";
import { extractRequirements } from "./steps/extractRequirements.js";
import { findHiringPage } from "./steps/findHiringPage.js";
import { generateFlashcards } from "./steps/generateFlashcards.js";
import { generateQuestions, type QuestionContext } from "./steps/generateQuestions.js";
import { parseInput } from "./steps/parseInput.js";
import { summariseHiring } from "./steps/summariseHiring.js";
import { writeBrief } from "./steps/writeBrief.js";
import {
  Warnings,
  type FetchedPage,
  type PipelineDeps,
  type PipelineInput,
  type PipelineOutput,
} from "./types.js";

/** The step list the UI renders before anything has run. */
export const PIPELINE_STEPS = [
  { name: "parse-input", label: "Reading the job description" },
  { name: "extract-requirements", label: "Extracting requirements" },
  { name: "crawl-company", label: "Reading the company site" },
  { name: "find-hiring-page", label: "Looking for their hiring process" },
  { name: "summarise-hiring", label: "Summarising the hiring process" },
  { name: "search-discussion", label: "Searching public discussion" },
  { name: "write-brief", label: "Writing the company brief" },
  { name: "generate-questions", label: "Writing questions by category" },
  { name: "coverage", label: "Checking every requirement is covered" },
  { name: "flashcards", label: "Building flashcards" },
  { name: "schedule", label: "Laying out the day-by-day plan" },
  { name: "assemble", label: "Assembling and validating the kit" },
] as const;

export type PipelineStepName = (typeof PIPELINE_STEPS)[number]["name"];

/**
 * The whole generation, as one function with injected dependencies. The HTTP job
 * runner and the batch CLI call this identically; neither the database nor
 * Express appears below this line.
 */
export async function runPipeline(
  input: PipelineInput,
  deps: PipelineDeps,
): Promise<PipelineOutput> {
  const now = deps.now ?? (() => new Date());
  const warnings = new Warnings();

  const report = async (
    name: PipelineStepName,
    status: "running" | "done" | "skipped" | "failed",
    note?: string,
  ): Promise<void> => {
    await deps.onProgress?.(name, status, note);
  };

  async function step<T>(name: PipelineStepName, fn: () => Promise<T> | T): Promise<T> {
    await report(name, "running");
    try {
      const value = await fn();
      await report(name, "done");
      return value;
    } catch (error) {
      await report(name, "failed", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  const parsed = await step("parse-input", () => parseInput(input, warnings));

  const role = await step("extract-requirements", () =>
    extractRequirements(parsed, deps, warnings),
  );

  const companyLabel = role.company || parsed.companyLabel;

  /* ---------------------------------------------------------------------- *
   * Research. Every branch below continues on failure and records why.
   * ---------------------------------------------------------------------- */

  let pages: FetchedPage[] = [];
  let skipped: SkippedPage[] = [];
  let reachable = false;

  if (!parsed.companyUrl) {
    await report(
      "crawl-company",
      "skipped",
      parsed.companyUrlProblem ? "The company URL was not usable" : "No company URL was supplied",
    );
  } else if (!deps.research) {
    await report("crawl-company", "skipped", "Research is disabled for this run");
  } else {
    await report("crawl-company", "running");
    try {
      const result = await deps.research.crawl(parsed.companyUrl);
      pages = result.pages;
      skipped = result.skipped;
      reachable = result.reachable;
      if (pages.length === 0) {
        warnings.add(
          `${parsed.companyUrl} could not be read, so the brief and the company questions rely on the job description alone.`,
        );
        await report("crawl-company", "done", "Site could not be read — continuing without it");
      } else {
        await report("crawl-company", "done", `Read ${pages.length} pages`);
      }
    } catch (error) {
      warnings.add(`The company site could not be read: ${message(error)}`);
      await report("crawl-company", "done", "Site could not be read — continuing without it");
    }
  }

  let hiringPageUrl: string | null = null;
  let hiringProcess: string | null = null;

  if (pages.length === 0) {
    await report("find-hiring-page", "skipped", "No pages to search");
    await report("summarise-hiring", "skipped", "No hiring page found");
    warnings.add("No page describing their interview process was found.");
  } else {
    const found = await step("find-hiring-page", () => findHiringPage(pages));
    if (!found.page) {
      hiringPageUrl = null;
      await report("summarise-hiring", "skipped", "No hiring page found");
      warnings.add("No page describing their interview process was found on their site.");
    } else {
      hiringPageUrl = found.page.url;
      await report("summarise-hiring", "running");
      try {
        hiringProcess = await summariseHiring(found.page, deps);
        await report(
          "summarise-hiring",
          "done",
          hiringProcess ? `From ${found.page.url}` : "That page did not describe a process",
        );
        if (!hiringProcess) {
          hiringPageUrl = null;
          warnings.add("No page describing their interview process was found on their site.");
        }
      } catch (error) {
        await report("summarise-hiring", "failed", message(error));
        hiringProcess = null;
      }
    }
  }

  let discussion: DiscussionHit[] = [];
  if (!deps.research) {
    await report("search-discussion", "skipped", "Research is disabled for this run");
  } else {
    await report("search-discussion", "running");
    try {
      discussion = await deps.research.searchDiscussion(companyLabel, parsed.companyUrl ?? undefined);
      await report(
        "search-discussion",
        "done",
        discussion.length > 0 ? `${discussion.length} mentions found` : "Nothing public found",
      );
    } catch (error) {
      await report("search-discussion", "done", `Search failed: ${message(error)}`);
    }
    if (discussion.length === 0) {
      warnings.add(
        `No public discussion of ${companyLabel}'s interview process was found, so nothing here is second-hand.`,
      );
    }
  }

  /* ---------------------------------------------------------------------- *
   * Generation.
   * ---------------------------------------------------------------------- */

  const brief = await step("write-brief", () =>
    writeBrief(
      {
        companyLabel,
        roleTitle: role.title,
        jd: parsed.jd,
        pages,
        hiringPageUrl,
        hiringProcess,
        discussion,
      },
      deps,
      warnings,
    ),
  );

  const questionContext: QuestionContext = {
    roleTitle: role.title,
    seniority: role.seniority,
    company: companyLabel,
    requirements: role.requirements,
    hiringProcess,
    companySummary: brief.what_they_do,
  };

  const generated = await step("generate-questions", () =>
    generateQuestions(questionContext, deps),
  );

  for (const outcome of generated.outcomes) {
    if (outcome.status === "failed") {
      warnings.add(`The ${outcome.category} questions could not be generated on this run.`);
    }
  }

  const covered = await step("coverage", () =>
    runCoverageLoop(role.requirements, generated.questions, questionContext, deps, warnings),
  );

  const flashcardDrafts = await step("flashcards", async () => {
    try {
      return await generateFlashcards(role.title, role.requirements, covered.questions, deps);
    } catch (error) {
      deps.logger.warn({ error: message(error) }, "flashcards failed");
      warnings.add("Flashcards could not be generated on this run.");
      return [];
    }
  });

  const questions = assignQuestionIds(covered.questions);
  const flashcards = assignFlashcardIds(flashcardDrafts);

  const schedule = await step("schedule", () =>
    allocateSchedule({ requirements: role.requirements, questions, days: parsed.days }),
  );

  const source: KitSource = {
    company: companyLabel,
    // What was supplied, even if it could not be crawled, so the kit shows what was attempted.
    company_url: parsed.companyUrl ?? parsed.rawCompanyUrl,
    role: role.title,
    location: role.location,
    jd_chars: parsed.jdChars,
    researched_at: now().toISOString(),
    pages_used: pages.map((p) => p.url),
  };

  const body = await step("assemble", () => {
    const roleBody = {
      title: role.title,
      seniority: role.seniority,
      responsibilities: role.responsibilities,
      requirements: role.requirements,
    };

    try {
      return assembleKit({
        source,
        company_brief: brief,
        role: roleBody,
        questions,
        flashcards,
        schedule,
        coverage: covered.coverage,
        warnings: warnings.list(),
      });
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "KIT_INVALID") throw error;

      // One repair attempt: drop what cannot be referenced, re-allocate the
      // schedule around what is left, and try once more.
      deps.logger.warn({ error: error.message }, "kit failed validation, repairing");
      const pruned = pruneUnreferenced(questions, flashcards, role.requirements);
      if (pruned.dropped.length > 0) {
        warnings.add(
          `${pruned.dropped.length} question${pruned.dropped.length === 1 ? "" : "s"} had to be dropped because ${pruned.dropped.length === 1 ? "it referenced" : "they referenced"} requirements that do not exist.`,
        );
      }
      return assembleKit({
        source,
        company_brief: brief,
        role: roleBody,
        questions: pruned.questions,
        flashcards: pruned.flashcards,
        schedule: allocateSchedule({
          requirements: role.requirements,
          questions: pruned.questions,
          days: parsed.days,
        }),
        coverage: covered.coverage,
        warnings: warnings.list(),
      });
    }
  });

  const missedMustHaves = body.coverage.uncovered_requirement_ids.some(
    (id) => role.requirements.find((r) => r.id === id)?.priority === "must",
  );
  // "partial" means the kit is usable but something honest is missing from it.
  const siteUnreachable =
    Boolean(parsed.companyUrlProblem) ||
    (Boolean(parsed.companyUrl) && Boolean(deps.research) && (!reachable || pages.length === 0));

  return {
    body,
    research: { hiringPageUrl, hiringProcess, discussion, skipped },
    status: missedMustHaves || siteUnreachable ? "partial" : "ready",
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
