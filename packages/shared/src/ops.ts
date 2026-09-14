import { z } from "zod";
import {
  questionCategorySchema,
  requirementKindSchema,
  requirementPrioritySchema,
  validateKitBody,
  type KitBody,
  type Question,
  type QuestionCategory,
} from "./kit.schema.js";
import type { ItemOrigin, ItemStateMap, KitCounters } from "./types.js";
import { uncoveredRequirementIds } from "./coverage.js";

/**
 * Edits are operations, not documents.
 *
 * The client sends what the user did ("move q7 to position 2 of behavioural"),
 * never the whole kit. The same reducer runs in the browser for an instant
 * optimistic update and on the server as the authority, so the two can never
 * disagree about what an edit means. It also makes regeneration tractable:
 * the server knows which items a human touched, because touching them is the
 * only thing that sets their origin to "edited".
 */

const difficultySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const newQuestionSchema = z.object({
  requirement_ids: z.array(z.string()).default([]),
  category: questionCategorySchema,
  prompt: z.string().trim().min(1, "A question needs a prompt."),
  answer_outline: z.string().trim().min(1, "A question needs an answer outline."),
  difficulty: difficultySchema,
});

const newFlashcardSchema = z.object({
  front: z.string().trim().min(1, "A flashcard needs a front."),
  back: z.string().trim().min(1, "A flashcard needs a back."),
  requirement_ids: z.array(z.string()).default([]),
});

export const opSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("update_question"),
    id: z.string(),
    fields: z
      .object({
        prompt: z.string().trim().min(1).optional(),
        answer_outline: z.string().trim().min(1).optional(),
        difficulty: difficultySchema.optional(),
        requirement_ids: z.array(z.string()).optional(),
      })
      .refine((f) => Object.keys(f).length > 0, "No fields to update."),
  }),
  z.object({
    op: z.literal("move_question"),
    id: z.string(),
    category: questionCategorySchema,
    index: z.number().int().min(0),
  }),
  z.object({
    op: z.literal("reorder_questions"),
    category: questionCategorySchema,
    ids: z.array(z.string()),
  }),
  z.object({ op: z.literal("add_question"), question: newQuestionSchema }),
  z.object({ op: z.literal("delete_question"), id: z.string() }),
  z.object({
    op: z.literal("update_flashcard"),
    id: z.string(),
    fields: z
      .object({
        front: z.string().trim().min(1).optional(),
        back: z.string().trim().min(1).optional(),
        requirement_ids: z.array(z.string()).optional(),
      })
      .refine((f) => Object.keys(f).length > 0, "No fields to update."),
  }),
  z.object({ op: z.literal("add_flashcard"), flashcard: newFlashcardSchema }),
  z.object({ op: z.literal("delete_flashcard"), id: z.string() }),
  z.object({
    op: z.literal("update_brief"),
    fields: z
      .object({
        summary: z.string().trim().min(1).optional(),
        what_they_do: z.string().trim().min(1).optional(),
        how_they_hire: z.string().trim().optional(),
      })
      .refine((f) => Object.keys(f).length > 0, "No fields to update."),
  }),
  z.object({
    op: z.literal("update_requirement"),
    id: z.string(),
    fields: z
      .object({
        text: z.string().trim().min(1).optional(),
        kind: requirementKindSchema.optional(),
        priority: requirementPrioritySchema.optional(),
      })
      .refine((f) => Object.keys(f).length > 0, "No fields to update."),
  }),
  z.object({
    op: z.literal("update_schedule_day"),
    day: z.number().int().min(1),
    fields: z
      .object({
        focus: z.string().trim().min(1).optional(),
        minutes: z.number().int().min(0).optional(),
        question_ids: z.array(z.string()).optional(),
      })
      .refine((f) => Object.keys(f).length > 0, "No fields to update."),
  }),
  z.object({ op: z.literal("pin"), id: z.string() }),
  z.object({ op: z.literal("unpin"), id: z.string() }),
]);

export const opsSchema = z.array(opSchema).min(1).max(100);

export type Op = z.infer<typeof opSchema>;

/** Which section an op touches, for the lock check during regeneration. */
export type KitSection = "brief" | "questions" | "flashcards" | "role" | "schedule";

export function sectionForOp(op: Op): KitSection {
  switch (op.op) {
    case "update_brief":
      return "brief";
    case "update_requirement":
      return "role";
    case "update_schedule_day":
      return "schedule";
    case "update_flashcard":
    case "add_flashcard":
    case "delete_flashcard":
      return "flashcards";
    default:
      return "questions";
  }
}

export class OpsError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "OpsError";
    this.details = details;
  }
}

export type KitState = {
  body: KitBody;
  itemState: ItemStateMap;
  counters: KitCounters;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** An edit to a generated item marks it edited; a manual item stays manual. */
function touch(state: ItemStateMap, id: string): void {
  const current = state[id];
  const origin: ItemOrigin = current?.origin === "manual" ? "manual" : "edited";
  state[id] = { origin, pinned: current?.pinned ?? false };
}

function requireQuestion(body: KitBody, id: string): number {
  const index = body.questions.findIndex((q) => q.id === id);
  if (index < 0) throw new OpsError(`Question ${id} is not in this kit.`);
  return index;
}

/**
 * Rewrites the order of one category in place, leaving every other category's
 * position in the array untouched. The flat array is the source of truth; a
 * category is a view over it.
 */
function reorderCategory(questions: Question[], category: QuestionCategory, ids: string[]): Question[] {
  const slots: number[] = [];
  questions.forEach((q, index) => {
    if (q.category === category) slots.push(index);
  });

  const inCategory = slots.map((index) => questions[index]!);
  const byId = new Map(inCategory.map((q) => [q.id, q]));

  const ordered: Question[] = [];
  for (const id of ids) {
    const question = byId.get(id);
    if (!question) throw new OpsError(`Question ${id} is not in ${category}.`);
    if (ordered.some((q) => q.id === id)) throw new OpsError(`Question ${id} listed twice.`);
    ordered.push(question);
    byId.delete(id);
  }
  // Anything the client did not mention keeps its relative order at the end.
  ordered.push(...inCategory.filter((q) => byId.has(q.id)));

  const next = [...questions];
  slots.forEach((slot, i) => {
    next[slot] = ordered[i]!;
  });
  return next;
}

function moveQuestion(
  questions: Question[],
  id: string,
  category: QuestionCategory,
  index: number,
): Question[] {
  const from = questions.findIndex((q) => q.id === id);
  if (from < 0) throw new OpsError(`Question ${id} is not in this kit.`);

  const moving = { ...questions[from]!, category };
  const rest = questions.filter((_q, i) => i !== from);

  const targetSlots: number[] = [];
  rest.forEach((q, i) => {
    if (q.category === category) targetSlots.push(i);
  });

  const clamped = Math.min(index, targetSlots.length);
  const insertAt = clamped < targetSlots.length ? targetSlots[clamped]! : rest.length;

  return [...rest.slice(0, insertAt), moving, ...rest.slice(insertAt)];
}

function pruneFromSchedule(body: KitBody, questionId: string): void {
  for (const day of body.schedule.days) {
    day.question_ids = day.question_ids.filter((id) => id !== questionId);
  }
}

/**
 * Applies a batch of operations and returns the new state. The batch is
 * all-or-nothing: if the result would not be a valid kit, nothing is kept.
 */
export function applyOps(state: KitState, ops: Op[]): KitState {
  const body = clone(state.body);
  const itemState: ItemStateMap = clone(state.itemState);
  const counters: KitCounters = { ...state.counters };

  for (const op of ops) {
    switch (op.op) {
      case "update_question": {
        const index = requireQuestion(body, op.id);
        body.questions[index] = { ...body.questions[index]!, ...op.fields };
        touch(itemState, op.id);
        break;
      }

      case "move_question": {
        body.questions = moveQuestion(body.questions, op.id, op.category, op.index);
        touch(itemState, op.id);
        break;
      }

      case "reorder_questions": {
        body.questions = reorderCategory(body.questions, op.category, op.ids);
        break;
      }

      case "add_question": {
        counters.q += 1;
        const id = `q${counters.q}`;
        body.questions.push({ id, ...op.question });
        itemState[id] = { origin: "manual", pinned: false };
        break;
      }

      case "delete_question": {
        const index = requireQuestion(body, op.id);
        body.questions.splice(index, 1);
        // A deleted question must not linger in the plan.
        pruneFromSchedule(body, op.id);
        delete itemState[op.id];
        break;
      }

      case "update_flashcard": {
        const index = body.flashcards.findIndex((f) => f.id === op.id);
        if (index < 0) throw new OpsError(`Flashcard ${op.id} is not in this kit.`);
        body.flashcards[index] = { ...body.flashcards[index]!, ...op.fields };
        touch(itemState, op.id);
        break;
      }

      case "add_flashcard": {
        counters.f += 1;
        const id = `f${counters.f}`;
        body.flashcards.push({ id, ...op.flashcard });
        itemState[id] = { origin: "manual", pinned: false };
        break;
      }

      case "delete_flashcard": {
        const index = body.flashcards.findIndex((f) => f.id === op.id);
        if (index < 0) throw new OpsError(`Flashcard ${op.id} is not in this kit.`);
        body.flashcards.splice(index, 1);
        delete itemState[op.id];
        break;
      }

      case "update_brief": {
        body.company_brief = { ...body.company_brief, ...op.fields };
        touch(itemState, "company_brief");
        break;
      }

      case "update_requirement": {
        const index = body.role.requirements.findIndex((r) => r.id === op.id);
        if (index < 0) throw new OpsError(`Requirement ${op.id} is not in this kit.`);
        body.role.requirements[index] = { ...body.role.requirements[index]!, ...op.fields };
        touch(itemState, op.id);
        break;
      }

      case "update_schedule_day": {
        const day = body.schedule.days.find((d) => d.day === op.day);
        if (!day) throw new OpsError(`Day ${op.day} is not in this schedule.`);
        Object.assign(day, op.fields);
        touch(itemState, "schedule");
        break;
      }

      case "pin":
      case "unpin": {
        const current = itemState[op.id];
        if (!current) throw new OpsError(`${op.id} is not something that can be pinned.`);
        itemState[op.id] = { ...current, pinned: op.op === "pin" };
        break;
      }
    }
  }

  // Deleting, moving or re-tagging a question can uncover a requirement. The
  // stored list is what the role tab flags, so it follows every edit.
  body.coverage = {
    ...body.coverage,
    uncovered_requirement_ids: uncoveredRequirementIds(body.role.requirements, body.questions),
  };

  const validation = validateKitBody(body);
  if (!validation.ok) {
    throw new OpsError("That change would leave the kit inconsistent.", validation.errors);
  }

  return { body: validation.body, itemState, counters };
}

/** Parses and validates ops from an untrusted request body. */
export function parseOps(input: unknown): Op[] {
  const result = opsSchema.safeParse(input);
  if (!result.success) {
    throw new OpsError(
      "Those edits could not be read.",
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  return result.data;
}
