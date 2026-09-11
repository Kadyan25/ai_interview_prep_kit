import { z } from "zod";

/**
 * The kit body is the assessment's Appendix A shape, field for field.
 * Only two additive fields are ours: `company_brief.how_they_hire` and top-level
 * `warnings`. Nothing else may be added here — builder state (origin, pinned)
 * lives on the Kit document beside the body so the body stays pure and the
 * batch CLI can write it out untouched.
 */

export const ID_PATTERN = /^[rqf]\d+$/;

export const requirementKinds = ["technical", "behavioural", "domain"] as const;
export const requirementPriorities = ["must", "nice"] as const;
export const questionCategories = [
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
] as const;

export const requirementKindSchema = z.enum(requirementKinds);
export const requirementPrioritySchema = z.enum(requirementPriorities);
export const questionCategorySchema = z.enum(questionCategories);

export type RequirementKind = (typeof requirementKinds)[number];
export type RequirementPriority = (typeof requirementPriorities)[number];
export type QuestionCategory = (typeof questionCategories)[number];

const idOf = (prefix: "r" | "q" | "f") =>
  z.string().regex(new RegExp(`^${prefix}\\d+$`), `id must look like ${prefix}1`);

const isoDateString = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), "must be an ISO-8601 timestamp");

export const sourceSchema = z.object({
  company: z.string(),
  company_url: z.string(),
  role: z.string(),
  location: z.string(),
  jd_chars: z.number().int().min(0),
  researched_at: isoDateString,
  pages_used: z.array(z.string()),
});

export const companyBriefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
  /** Additive: what the hiring page said, or an honest statement that none was found. */
  how_they_hire: z.string().optional(),
});

export const requirementSchema = z.object({
  id: idOf("r"),
  text: z.string().min(1),
  kind: requirementKindSchema,
  priority: requirementPrioritySchema,
});

export const roleSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(requirementSchema),
});

export const questionSchema = z.object({
  id: idOf("q"),
  requirement_ids: z.array(z.string()),
  category: questionCategorySchema,
  prompt: z.string().min(1),
  answer_outline: z.string().min(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export const flashcardSchema = z.object({
  id: idOf("f"),
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string()),
});

export const scheduleDaySchema = z.object({
  day: z.number().int().min(1),
  focus: z.string(),
  question_ids: z.array(z.string()),
  minutes: z.number().int().min(0),
});

export const scheduleSchema = z.object({
  days_available: z.number().int().min(1),
  days: z.array(scheduleDaySchema),
});

export const coverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string()),
  passes: z.number().int().min(0),
});

const kitBodyShape = z.object({
  source: sourceSchema,
  company_brief: companyBriefSchema,
  role: roleSchema,
  questions: z.array(questionSchema),
  flashcards: z.array(flashcardSchema),
  schedule: scheduleSchema,
  coverage: coverageSchema,
  /** Additive: honest notes about thin input or missing research. */
  warnings: z.array(z.string()).optional(),
});

/**
 * Referential integrity. Zod's object rules cannot see across arrays, so every
 * cross-reference in the kit is checked here. A kit that fails any of these is
 * never saved and never written to a batch output.
 */
export const kitBodySchema = kitBodyShape.superRefine((kit, ctx) => {
  const requirementIds = new Set<string>();
  kit.role.requirements.forEach((r, i) => {
    if (requirementIds.has(r.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["role", "requirements", i, "id"],
        message: `duplicate requirement id ${r.id}`,
      });
    }
    requirementIds.add(r.id);
  });

  const questionIds = new Set<string>();
  kit.questions.forEach((q, i) => {
    if (questionIds.has(q.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questions", i, "id"],
        message: `duplicate question id ${q.id}`,
      });
    }
    questionIds.add(q.id);

    q.requirement_ids.forEach((rid, j) => {
      if (!requirementIds.has(rid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["questions", i, "requirement_ids", j],
          message: `question ${q.id} references unknown requirement ${rid}`,
        });
      }
    });

    // company-fit questions are about the company, not a specific requirement.
    // Every other category must tie back to at least one requirement, otherwise
    // the coverage check has nothing to measure.
    if (
      q.category !== "company-fit" &&
      q.requirement_ids.length === 0 &&
      requirementIds.size > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questions", i, "requirement_ids"],
        message: `${q.category} question ${q.id} must reference at least one requirement`,
      });
    }
  });

  const flashcardIds = new Set<string>();
  kit.flashcards.forEach((f, i) => {
    if (flashcardIds.has(f.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["flashcards", i, "id"],
        message: `duplicate flashcard id ${f.id}`,
      });
    }
    flashcardIds.add(f.id);

    f.requirement_ids.forEach((rid, j) => {
      if (!requirementIds.has(rid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["flashcards", i, "requirement_ids", j],
          message: `flashcard ${f.id} references unknown requirement ${rid}`,
        });
      }
    });
  });

  if (kit.schedule.days.length !== kit.schedule.days_available) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["schedule", "days"],
      message: `schedule has ${kit.schedule.days.length} days but days_available is ${kit.schedule.days_available}`,
    });
  }

  kit.schedule.days.forEach((d, i) => {
    if (d.day !== i + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schedule", "days", i, "day"],
        message: `days must be numbered 1..N in order; expected ${i + 1}, got ${d.day}`,
      });
    }
    d.question_ids.forEach((qid, j) => {
      if (!questionIds.has(qid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["schedule", "days", i, "question_ids", j],
          message: `day ${d.day} references unknown question ${qid}`,
        });
      }
    });
  });

  kit.coverage.uncovered_requirement_ids.forEach((rid, i) => {
    if (!requirementIds.has(rid)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage", "uncovered_requirement_ids", i],
        message: `coverage references unknown requirement ${rid}`,
      });
    }
  });
});

export type KitBody = z.infer<typeof kitBodyShape>;
export type KitSource = z.infer<typeof sourceSchema>;
export type CompanyBrief = z.infer<typeof companyBriefSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type KitRole = z.infer<typeof roleSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Flashcard = z.infer<typeof flashcardSchema>;
export type ScheduleDay = z.infer<typeof scheduleDaySchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type Coverage = z.infer<typeof coverageSchema>;

export type KitValidation =
  | { ok: true; body: KitBody }
  | { ok: false; errors: string[] };

/** Human-readable validation used by the pipeline's repair step and by tests. */
export function validateKitBody(input: unknown): KitValidation {
  const parsed = kitBodySchema.safeParse(input);
  if (parsed.success) return { ok: true, body: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    ),
  };
}

/**
 * What the batch CLI writes. The body already carries no builder state, so this
 * is identity — it exists so the boundary is explicit and testable.
 */
export function toCanonicalKit(body: KitBody): KitBody {
  return body;
}
