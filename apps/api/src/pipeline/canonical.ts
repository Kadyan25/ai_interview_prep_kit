import type {
  Coverage,
  CompanyBrief,
  Flashcard,
  KitBody,
  KitCounters,
  KitSource,
  Question,
  Requirement,
  Schedule,
} from "@prep/shared";
import { validateKitBody } from "@prep/shared";
import { AppError } from "../lib/errors.js";
import type { DraftFlashcard, DraftQuestion, DraftRequirement } from "./types.js";

/**
 * Ids are assigned in one place so they are always sequential, never reused, and
 * never invented by a model.
 */

export function assignRequirementIds(drafts: DraftRequirement[]): Requirement[] {
  return drafts.map((draft, index) => ({
    id: `r${index + 1}`,
    text: draft.text,
    kind: draft.kind,
    priority: draft.priority,
  }));
}

export function assignQuestionIds(drafts: DraftQuestion[], startAt = 0): Question[] {
  return drafts.map((draft, index) => ({ ...draft, id: `q${startAt + index + 1}` }));
}

export function assignFlashcardIds(drafts: DraftFlashcard[], startAt = 0): Flashcard[] {
  return drafts.map((draft, index) => ({ ...draft, id: `f${startAt + index + 1}` }));
}

export function countersFor(body: KitBody): KitCounters {
  return {
    r: body.role.requirements.length,
    q: body.questions.length,
    f: body.flashcards.length,
  };
}

export type AssembleInput = {
  source: KitSource;
  company_brief: CompanyBrief;
  role: KitBody["role"];
  questions: Question[];
  flashcards: Flashcard[];
  schedule: Schedule;
  coverage: Coverage;
  warnings: string[];
};

/**
 * Builds the Appendix A body and refuses to return anything that does not
 * validate. Everything downstream can then assume a well-formed kit.
 */
export function assembleKit(input: AssembleInput): KitBody {
  const body: KitBody = {
    source: input.source,
    company_brief: input.company_brief,
    role: input.role,
    questions: input.questions,
    flashcards: input.flashcards,
    schedule: input.schedule,
    coverage: input.coverage,
    ...(input.warnings.length > 0 ? { warnings: input.warnings } : {}),
  };

  const result = validateKitBody(body);
  if (!result.ok) {
    throw new AppError(
      "KIT_INVALID",
      `The assembled kit failed validation: ${result.errors.slice(0, 5).join("; ")}`,
      result.errors,
    );
  }
  return result.body;
}

/**
 * Last-resort repair before assembly: drops the pieces that cannot be referenced
 * rather than failing the whole kit. Returns what it removed so the caller can
 * warn honestly.
 */
export function pruneUnreferenced(
  questions: Question[],
  flashcards: Flashcard[],
  requirements: Requirement[],
): { questions: Question[]; flashcards: Flashcard[]; dropped: string[] } {
  const known = new Set(requirements.map((r) => r.id));
  const dropped: string[] = [];

  const cleanQuestions = questions
    .map((q) => ({ ...q, requirement_ids: q.requirement_ids.filter((id) => known.has(id)) }))
    .filter((q) => {
      // Only company-fit questions are allowed to stand alone.
      if (q.category === "company-fit" || q.requirement_ids.length > 0 || known.size === 0) {
        return true;
      }
      dropped.push(q.id);
      return false;
    });

  const cleanFlashcards = flashcards.map((f) => ({
    ...f,
    requirement_ids: f.requirement_ids.filter((id) => known.has(id)),
  }));

  return { questions: cleanQuestions, flashcards: cleanFlashcards, dropped };
}
