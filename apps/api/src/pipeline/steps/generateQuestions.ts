import { z } from "zod";
import type { QuestionCategory, Requirement } from "@prep/shared";
import {
  generateForGapsUser,
  generateQuestionsSystem,
  generateQuestionsUser,
} from "../prompts/generateQuestions.js";
import type { DraftQuestion, PipelineDeps } from "../types.js";

const questionsSchema = z.object({
  questions: z
    .array(
      z.object({
        requirement_ids: z.array(z.string()).default([]),
        prompt: z.string().min(1),
        answer_outline: z.string().min(1),
        difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      }),
    )
    .default([]),
});

const SYSTEM_DESIGN_HINT = /architect|scal|design|distributed|system|infrastructure|platform|throughput|latency/i;
const SENIOR_ENOUGH = /mid|senior|staff|lead|principal/i;

export type QuestionContext = {
  roleTitle: string;
  seniority: string;
  company: string;
  requirements: Requirement[];
  hiringProcess: string | null;
  companySummary: string | null;
};

/**
 * Which requirements each category call is responsible for. Technical and
 * behavioural never share a call: mixing them produces questions that are
 * vaguely about both and sharply about neither.
 */
export function routeRequirements(
  context: QuestionContext,
): Record<QuestionCategory, Requirement[]> {
  const technical = context.requirements.filter(
    (r) => r.kind === "technical" || r.kind === "domain",
  );
  const behavioural = context.requirements.filter((r) => r.kind === "behavioural");

  const seniorityTriggers = SENIOR_ENOUGH.test(context.seniority);
  const hiringTriggers = Boolean(
    context.hiringProcess && /system design|architecture|design round/i.test(context.hiringProcess),
  );

  const systemDesign = technical.filter(
    (r) =>
      r.kind === "technical" &&
      (SYSTEM_DESIGN_HINT.test(r.text) || seniorityTriggers || hiringTriggers),
  );

  return {
    technical,
    behavioural,
    "system-design": systemDesign,
    // Company-fit is not driven by requirements; it always runs.
    "company-fit": [],
  };
}

/** Two questions per requirement, floored at 3 and capped at 12. */
export function questionCount(requirementCount: number): number {
  return Math.min(12, Math.max(3, requirementCount * 2));
}

export async function generateForCategory(
  category: QuestionCategory,
  requirements: Requirement[],
  context: QuestionContext,
  deps: PipelineDeps,
): Promise<DraftQuestion[]> {
  const count =
    category === "company-fit" ? 4 : questionCount(requirements.length);

  const result = await deps.llm.generateJson({
    task: `generateQuestions:${category}`,
    system: generateQuestionsSystem(category),
    user: generateQuestionsUser({
      category,
      roleTitle: context.roleTitle,
      seniority: context.seniority,
      company: context.company,
      requirements,
      count,
      hiringProcess: context.hiringProcess,
      companySummary: context.companySummary,
    }),
    schema: questionsSchema,
    maxOutputTokens: 4096,
  });

  return result.questions.map((q) => ({
    requirement_ids: q.requirement_ids,
    category,
    prompt: q.prompt.trim(),
    answer_outline: q.answer_outline.trim(),
    difficulty: q.difficulty,
  }));
}

export type CategoryOutcome = {
  category: QuestionCategory;
  status: "done" | "skipped" | "failed";
  count: number;
  note?: string;
};

/**
 * One model call per category, run in sequence. The client's limiter would allow
 * parallel calls, but free-tier quotas are the binding constraint and a failed
 * category should not take the others down with it.
 */
export async function generateQuestions(
  context: QuestionContext,
  deps: PipelineDeps,
): Promise<{ questions: DraftQuestion[]; outcomes: CategoryOutcome[] }> {
  const routed = routeRequirements(context);
  const questions: DraftQuestion[] = [];
  const outcomes: CategoryOutcome[] = [];

  const categories: QuestionCategory[] = [
    "technical",
    "behavioural",
    "system-design",
    "company-fit",
  ];

  for (const category of categories) {
    const requirements = routed[category];
    if (category !== "company-fit" && requirements.length === 0) {
      outcomes.push({
        category,
        status: "skipped",
        count: 0,
        note: `No ${category} requirements in this posting`,
      });
      continue;
    }

    try {
      const generated = await generateForCategory(category, requirements, context, deps);
      questions.push(...generated);
      outcomes.push({ category, status: "done", count: generated.length });
    } catch (error) {
      // One bad category must not cost the candidate the whole kit.
      const message = error instanceof Error ? error.message : String(error);
      deps.logger.warn({ category, error: message }, "question category failed");
      outcomes.push({ category, status: "failed", count: 0, note: message });
    }
  }

  return { questions, outcomes };
}

/** Targeted generation for requirements the coverage check found bare. */
export async function generateForGaps(
  gaps: Requirement[],
  context: QuestionContext,
  deps: PipelineDeps,
): Promise<DraftQuestion[]> {
  const byCategory = new Map<QuestionCategory, Requirement[]>();
  for (const requirement of gaps) {
    const category: QuestionCategory =
      requirement.kind === "behavioural" ? "behavioural" : "technical";
    const bucket = byCategory.get(category) ?? [];
    bucket.push(requirement);
    byCategory.set(category, bucket);
  }

  const produced: DraftQuestion[] = [];

  for (const [category, requirements] of byCategory) {
    try {
      const result = await deps.llm.generateJson({
        task: `generateForGaps:${category}`,
        system: generateQuestionsSystem(category),
        user: generateForGapsUser({
          roleTitle: context.roleTitle,
          company: context.company,
          category,
          requirements,
        }),
        schema: questionsSchema,
        maxOutputTokens: 3072,
      });
      produced.push(
        ...result.questions.map((q) => ({
          requirement_ids: q.requirement_ids,
          category,
          prompt: q.prompt.trim(),
          answer_outline: q.answer_outline.trim(),
          difficulty: q.difficulty,
        })),
      );
    } catch (error) {
      deps.logger.warn(
        { category, error: error instanceof Error ? error.message : String(error) },
        "gap generation failed",
      );
    }
  }

  return produced;
}
