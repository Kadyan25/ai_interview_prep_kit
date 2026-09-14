import { z } from "zod";
import type { CompanyBrief, DiscussionHit } from "@prep/shared";
import { writeBriefSystem, writeBriefUser } from "../prompts/writeBrief.js";
import type { FetchedPage, PipelineDeps, Warnings } from "../types.js";

const schema = z.object({
  summary: z.string().min(1),
  what_they_do: z.string().min(1),
  how_they_hire: z.string().default(""),
});

export type BriefContext = {
  companyLabel: string;
  roleTitle: string;
  jd: string;
  pages: FetchedPage[];
  hiringPageUrl: string | null;
  hiringProcess: string | null;
  discussion: DiscussionHit[];
};

export async function writeBrief(
  context: BriefContext,
  deps: PipelineDeps,
  warnings: Warnings,
): Promise<CompanyBrief> {
  const brief = await deps.llm.generateJson({
    task: "writeBrief",
    system: writeBriefSystem,
    user: writeBriefUser({
      companyLabel: context.companyLabel,
      roleTitle: context.roleTitle,
      jd: context.jd,
      pages: context.pages,
      hiringProcess: context.hiringProcess,
      discussion: context.discussion,
    }),
    schema,
    maxOutputTokens: 1500,
  });

  // Sources are recorded by the code, not by the model, so the list is always
  // exactly what was actually fetched.
  const sources = [
    ...context.pages.map((p) => p.url),
    ...(context.hiringPageUrl ? [context.hiringPageUrl] : []),
    ...context.discussion.map((d) => d.url),
  ].filter((url, index, all) => all.indexOf(url) === index);

  if (context.pages.length === 0) {
    warnings.add(
      "The company site could not be read, so the brief is inferred from the job description alone.",
    );
  }

  return {
    summary: brief.summary.trim(),
    what_they_do: brief.what_they_do.trim(),
    sources,
    how_they_hire: howTheyHire(context, brief.how_they_hire.trim()),
  };
}

const NOTHING_FOUND =
  "No public description of their interview process was found, so prepare for a standard loop.";

/**
 * Which source the process description rests on decides how it is worded. A
 * company's own page is stated as fact; candidate posts are labelled as reports,
 * because a thread from three years ago is not the company's current process.
 */
export function howTheyHire(
  context: Pick<BriefContext, "hiringProcess" | "discussion">,
  modelText: string,
): string {
  if (context.hiringProcess) {
    return modelText || "Their hiring page describes a process; see the linked source.";
  }
  // Models sometimes answer "nothing was found" instead of the empty string asked for.
  const saysNothing = /^(there (is|was|were|are) )?(no|none)\b/i.test(modelText);
  if (context.discussion.length > 0 && modelText && !saysNothing) {
    return `Their site does not describe the process. Unverified candidate reports: ${modelText}`;
  }
  return NOTHING_FOUND;
}
