import mongoose from "mongoose";
import type { KitBody, KitResearch, QuestionCategory } from "@prep/shared";
import { validateKitBody } from "@prep/shared";
import { AppError } from "../lib/errors.js";
import type { KitDoc } from "../models/Kit.js";
import { GenerationJob } from "../models/GenerationJob.js";
import { checkCoverage } from "../pipeline/coverage.js";
import { allocateSchedule } from "../pipeline/schedule.js";
import { findHiringPage } from "../pipeline/steps/findHiringPage.js";
import { mergeCategory, survives } from "./mergeCategory.js";
import {
  generateForCategory,
  generateForGaps,
  type QuestionContext,
} from "../pipeline/steps/generateQuestions.js";
import { summariseHiring } from "../pipeline/steps/summariseHiring.js";
import { writeBrief } from "../pipeline/steps/writeBrief.js";
import { Warnings, type FetchedPage, type PipelineDeps } from "../pipeline/types.js";

export type RegenSection = "brief" | "category" | "schedule";

/** Which kit sections a running job holds the pen on. */
export function lockedSectionsFor(type: string): string[] {
  switch (type) {
    case "full":
      return ["brief", "questions", "flashcards", "role", "schedule"];
    case "regen_brief":
      return ["brief"];
    case "regen_category":
      return ["questions"];
    case "regen_schedule":
      return ["schedule"];
    default:
      return [];
  }
}

export async function activeLockedSections(kitId: mongoose.Types.ObjectId): Promise<string[]> {
  const running = await GenerationJob.find({
    kitId,
    status: { $in: ["queued", "running"] },
  }).select("type");
  return [...new Set(running.flatMap((job) => lockedSectionsFor(job.type)))];
}

/** The fields of a kit a regeneration reads and writes. */
export type KitSnapshot = Pick<KitDoc, "body" | "itemState" | "counters" | "research" | "input">;

type StepReporter = (step: string, status: "running" | "done" | "skipped" | "failed", note?: string) => Promise<void>;

/**
 * A regeneration in two halves. The slow half (crawling, model calls) works from
 * the kit as it was when the job started. The commit half is pure code and runs
 * against the kit as it is at the moment of writing, so an edit the user made
 * while the model was busy — to any section, even an item inside the one being
 * regenerated — is part of what gets merged, not what gets overwritten.
 */
export type RegenPlan = {
  note: string;
  commit: (current: KitSnapshot) => { set: Record<string, unknown>; scheduleStale?: boolean };
};

function questionContext(kit: KitSnapshot, body: KitBody): QuestionContext {
  return {
    roleTitle: body.role.title,
    seniority: body.role.seniority,
    company: body.source.company,
    requirements: body.role.requirements,
    hiringProcess: kit.research?.hiringProcess ?? null,
    companySummary: body.company_brief.what_they_do,
  };
}

/** Refuses up front what a regeneration must not do, before any model call is spent. */
export function assertRegenerable(kit: KitSnapshot, section: RegenSection, category?: QuestionCategory): void {
  const body = requireBody(kit);
  const state = kit.itemState ?? {};
  if (section === "brief" && state.company_brief?.pinned) {
    throw new AppError("INVALID_INPUT", "The brief is pinned. Unpin it to rewrite it.");
  }
  if (section === "schedule" && state.schedule?.pinned) {
    throw new AppError("INVALID_INPUT", "The schedule is pinned. Unpin it to re-plan it.");
  }
  if (section === "category" && category && category !== "company-fit") {
    if (requirementsForCategory(body, category).length === 0) {
      throw new AppError(
        "INVALID_INPUT",
        `This posting has no requirements that ${category} questions can practise, so there is nothing to regenerate.`,
      );
    }
  }
}

/**
 * Rewrites the company brief from a fresh read of their site. The brief is one
 * item, so it is replaced wholesale and its origin resets to generated.
 */
export async function regenerateBrief(kit: KitSnapshot, deps: PipelineDeps, onProgress: StepReporter): Promise<RegenPlan> {
  const body = requireBody(kit);

  let pages: FetchedPage[] = [];
  let skipped = kit.research?.skipped ?? [];
  let hiringProcess: string | null = null;

  await onProgress("crawl-company", "running");
  if (kit.input.companyUrl && deps.research) {
    const crawled = await deps.research.crawl(kit.input.companyUrl);
    pages = crawled.pages;
    skipped = crawled.skipped;
    await onProgress("crawl-company", "done", `Read ${pages.length} pages`);
  } else {
    await onProgress("crawl-company", "skipped", "No company URL on this kit");
  }

  await onProgress("find-hiring-page", "running");
  const found = pages.length > 0 ? findHiringPage(pages) : { page: null, score: 0 };
  await onProgress("find-hiring-page", "done", found.page ? found.page.url : "No hiring page found");

  if (found.page) {
    await onProgress("summarise-hiring", "running");
    hiringProcess = await summariseHiring(found.page, deps);
    await onProgress("summarise-hiring", "done");
  } else {
    await onProgress("summarise-hiring", "skipped", "No hiring page found");
  }
  const hiringPageUrl = hiringProcess && found.page ? found.page.url : null;

  await onProgress("write-brief", "running");
  const discussion = kit.research?.discussion ?? [];
  const brief = await writeBrief(
    { companyLabel: body.source.company, roleTitle: body.role.title, jd: kit.input.jd, pages, hiringPageUrl, hiringProcess, discussion },
    deps,
    new Warnings(),
  );
  await onProgress("write-brief", "done");

  const research: KitResearch = { hiringPageUrl, hiringProcess, discussion, skipped };

  return {
    note: pages.length > 0 ? `Rewritten from ${pages.length} pages` : "Rewritten from the posting",
    commit: (current) => {
      if (current.itemState?.company_brief?.pinned) {
        throw new AppError("INVALID_INPUT", "The brief was pinned while it was being rewritten, so it was left alone.");
      }
      return {
        set: {
          "body.company_brief": brief,
          "body.source.pages_used": pages.map((p) => p.url),
          "itemState.company_brief": { origin: "generated", pinned: false },
          research,
        },
      };
    },
  };
}

/**
 * Replaces the generated, unpinned questions in one category. Edited, manual and
 * pinned questions survive where they are, fresh questions take the replaced
 * questions' places in order, every other category is untouched, and coverage
 * is re-checked in code, with one targeted model call for any must-have the new
 * questions leave bare.
 */
export async function regenerateCategory(
  kit: KitSnapshot,
  category: QuestionCategory,
  deps: PipelineDeps,
  onProgress: StepReporter,
): Promise<RegenPlan> {
  const body = requireBody(kit);
  const context = questionContext(kit, body);

  await onProgress("generate-questions", "running");
  const drafts = await generateForCategory(category, requirementsForCategory(body, category), context, deps);
  await onProgress("generate-questions", "done", `${drafts.length} drafted`);

  // Predict the result from the snapshot to decide whether a gap call is worth it.
  await onProgress("coverage", "running");
  const predicted = [...body.questions.filter((q) => survives(kit.itemState ?? {}, q, category)), ...drafts];
  const gaps = checkCoverage(body.role.requirements, predicted).uncovered.filter((r) => r.priority === "must");
  const gapDrafts = gaps.length > 0 ? await generateForGaps(gaps, context, deps) : [];
  await onProgress("coverage", "done", gaps.length > 0 ? `${gaps.length} must-haves needed another pass` : "Every must-have covered");

  return {
    note: `${drafts.length} new ${category} questions`,
    commit: (current) => mergeCategory(current, category, [...drafts, ...gapDrafts]),
  };
}

/** Re-lays the plan over whatever questions the kit currently has. */
export function regenerateSchedule(): RegenPlan {
  return {
    note: "Schedule re-planned",
    commit: (current) => {
      const body = requireBody(current);
      if (current.itemState?.schedule?.pinned) {
        throw new AppError("INVALID_INPUT", "The schedule is pinned. Unpin it to re-plan it.");
      }
      const schedule = allocateSchedule({ requirements: body.role.requirements, questions: body.questions, days: current.input.days });
      assertValid({ ...body, schedule });
      return { set: { "body.schedule": schedule, "itemState.schedule": { origin: "generated", pinned: false } } };
    },
  };
}

function requirementsForCategory(body: KitBody, category: QuestionCategory): KitBody["role"]["requirements"] {
  if (category === "company-fit") return [];
  if (category === "behavioural") return body.role.requirements.filter((r) => r.kind === "behavioural");
  return body.role.requirements.filter((r) => r.kind === "technical" || r.kind === "domain");
}

function requireBody(kit: KitSnapshot): KitBody {
  if (!kit.body) {
    throw new AppError("INVALID_INPUT", "This kit has no content yet, so there is nothing to regenerate.");
  }
  return kit.body;
}

function assertValid(body: KitBody): void {
  const result = validateKitBody(body);
  if (!result.ok) {
    throw new AppError(
      "KIT_INVALID",
      `Regeneration would have left the kit inconsistent: ${result.errors.slice(0, 3).join("; ")}`,
    );
  }
}
