import mongoose from "mongoose";
import type {
  ItemStateMap,
  KitBody,
  KitCounters,
  KitResearch,
  Question,
  QuestionCategory,
} from "@prep/shared";
import { validateKitBody } from "@prep/shared";
import { AppError } from "../lib/errors.js";
import type { KitDoc } from "../models/Kit.js";
import { GenerationJob } from "../models/GenerationJob.js";
import { checkCoverage } from "../pipeline/coverage.js";
import { allocateSchedule } from "../pipeline/schedule.js";
import { findHiringPage } from "../pipeline/steps/findHiringPage.js";
import { generateForCategory, type QuestionContext } from "../pipeline/steps/generateQuestions.js";
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

function questionContext(kit: KitDoc, body: KitBody): QuestionContext {
  return {
    roleTitle: body.role.title,
    seniority: body.role.seniority,
    company: body.source.company,
    requirements: body.role.requirements,
    hiringProcess: kit.research?.hiringProcess ?? null,
    companySummary: body.company_brief.what_they_do,
  };
}

export type RegenResult = {
  set: Record<string, unknown>;
  note: string;
  scheduleStale?: boolean;
};

/**
 * Rewrites the company brief from a fresh read of their site. The brief is one
 * item, so it is replaced wholesale and its origin resets to generated.
 */
export async function regenerateBrief(
  kit: KitDoc,
  deps: PipelineDeps,
  onProgress: (step: string, status: "running" | "done" | "skipped" | "failed", note?: string) => Promise<void>,
): Promise<RegenResult> {
  const body = requireBody(kit);

  let pages: FetchedPage[] = [];
  let skipped = kit.research?.skipped ?? [];
  let hiringPageUrl: string | null = null;
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
  await onProgress(
    "find-hiring-page",
    "done",
    found.page ? found.page.url : "No hiring page found",
  );

  if (found.page) {
    await onProgress("summarise-hiring", "running");
    hiringProcess = await summariseHiring(found.page, deps);
    hiringPageUrl = hiringProcess ? found.page.url : null;
    await onProgress("summarise-hiring", "done");
  } else {
    await onProgress("summarise-hiring", "skipped", "No hiring page found");
  }

  await onProgress("write-brief", "running");
  const warnings = new Warnings();
  const brief = await writeBrief(
    {
      companyLabel: body.source.company,
      roleTitle: body.role.title,
      jd: kit.input.jd,
      pages,
      hiringPageUrl,
      hiringProcess,
      discussion: kit.research?.discussion ?? [],
    },
    deps,
    warnings,
  );
  await onProgress("write-brief", "done");

  const itemState: ItemStateMap = { ...(kit.itemState ?? {}) };
  itemState.company_brief = { origin: "generated", pinned: false };

  const research: KitResearch = {
    hiringPageUrl,
    hiringProcess,
    discussion: kit.research?.discussion ?? [],
    skipped,
  };

  return {
    set: {
      "body.company_brief": brief,
      "body.source.pages_used": pages.map((p) => p.url),
      itemState,
      research,
    },
    note: pages.length > 0 ? `Rewritten from ${pages.length} pages` : "Rewritten from the posting",
  };
}

/**
 * Replaces the generated, unpinned questions in one category. Edited, manual and
 * pinned questions survive, every other category is untouched, and coverage is
 * recomputed in code afterwards.
 */
export async function regenerateCategory(
  kit: KitDoc,
  category: QuestionCategory,
  deps: PipelineDeps,
  onProgress: (step: string, status: "running" | "done" | "failed", note?: string) => Promise<void>,
): Promise<RegenResult> {
  const body = requireBody(kit);
  const itemState: ItemStateMap = { ...(kit.itemState ?? {}) };
  const counters: KitCounters = { ...kit.counters };

  const survives = (question: Question): boolean => {
    if (question.category !== category) return true;
    const state = itemState[question.id];
    return state?.pinned === true || state?.origin === "edited" || state?.origin === "manual";
  };

  const kept = body.questions.filter(survives);
  const replacedIds = body.questions.filter((q) => !survives(q)).map((q) => q.id);

  await onProgress("generate-questions", "running");
  const context = questionContext(kit, body);
  const requirements = requirementsForCategory(context, category);
  const drafts = await generateForCategory(category, requirements, context, deps);

  const known = new Set(body.role.requirements.map((r) => r.id));
  const fresh: Question[] = [];
  for (const draft of drafts) {
    const requirementIds = draft.requirement_ids.filter((id) => known.has(id));
    // A non company-fit question with nothing to point at cannot be scored for
    // coverage, so it is dropped rather than saved.
    if (category !== "company-fit" && requirementIds.length === 0 && known.size > 0) continue;
    counters.q += 1;
    const id = `q${counters.q}`;
    fresh.push({ ...draft, requirement_ids: requirementIds, id });
    itemState[id] = { origin: "generated", pinned: false };
  }

  for (const id of replacedIds) delete itemState[id];
  await onProgress(
    "generate-questions",
    "done",
    `${fresh.length} new, ${kept.filter((q) => q.category === category).length} kept`,
  );

  const questions = [...kept, ...fresh];

  await onProgress("coverage", "running");
  const report = checkCoverage(body.role.requirements, questions);
  await onProgress("coverage", "done", `${report.uncoveredIds.length} uncovered`);

  const next: KitBody = {
    ...body,
    questions,
    coverage: { uncovered_requirement_ids: report.uncoveredIds, passes: body.coverage.passes + 1 },
    schedule: body.schedule,
  };

  // Dead ids must never survive in the plan, whoever owns it.
  for (const day of next.schedule.days) {
    day.question_ids = day.question_ids.filter((id) => !replacedIds.includes(id));
  }

  const scheduleOwnedByUser = itemState.schedule?.origin === "edited";
  if (!scheduleOwnedByUser) {
    next.schedule = allocateSchedule({
      requirements: next.role.requirements,
      questions,
      days: kit.input.days,
    });
  }

  assertValid(next);

  return {
    set: { body: next, itemState, counters },
    note: `${fresh.length} new ${category} questions`,
    // The user edited the plan by hand, so it is theirs to re-run, not ours.
    ...(scheduleOwnedByUser ? { scheduleStale: true } : {}),
  };
}

/** Re-lays the plan over whatever questions the kit currently has. */
export function regenerateSchedule(kit: KitDoc): RegenResult {
  const body = requireBody(kit);
  const schedule = allocateSchedule({
    requirements: body.role.requirements,
    questions: body.questions,
    days: kit.input.days,
  });

  const itemState: ItemStateMap = { ...(kit.itemState ?? {}) };
  itemState.schedule = { origin: "generated", pinned: false };

  assertValid({ ...body, schedule });

  return {
    set: { "body.schedule": schedule, itemState },
    note: `${schedule.days.length} days re-planned`,
  };
}

function requirementsForCategory(
  context: QuestionContext,
  category: QuestionCategory,
): QuestionContext["requirements"] {
  if (category === "company-fit") return [];
  if (category === "behavioural") {
    return context.requirements.filter((r) => r.kind === "behavioural");
  }
  return context.requirements.filter((r) => r.kind === "technical" || r.kind === "domain");
}

function requireBody(kit: KitDoc): KitBody {
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
