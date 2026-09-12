import { z } from "zod";
import type { Requirement } from "@prep/shared";
import { flashcardsSystem, flashcardsUser } from "../prompts/flashcards.js";
import { stripDanglingIds } from "../coverage.js";
import type { DraftFlashcard, DraftQuestion, PipelineDeps } from "../types.js";

const schema = z.object({
  flashcards: z
    .array(
      z.object({
        front: z.string().min(1),
        back: z.string().min(1),
        requirement_ids: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

export async function generateFlashcards(
  roleTitle: string,
  requirements: Requirement[],
  questions: DraftQuestion[],
  deps: PipelineDeps,
): Promise<DraftFlashcard[]> {
  const count = Math.min(20, Math.max(6, requirements.length * 2));

  const result = await deps.llm.generateJson({
    task: "generateFlashcards",
    system: flashcardsSystem,
    user: flashcardsUser({
      roleTitle,
      requirements,
      questionPrompts: questions.map((q) => q.prompt),
      count,
    }),
    schema,
    maxOutputTokens: 8192,
  });

  const drafts: DraftFlashcard[] = result.flashcards.map((card) => ({
    front: card.front.trim(),
    back: card.back.trim(),
    requirement_ids: card.requirement_ids,
  }));

  // Flashcards may stand alone, so invented ids are stripped but cards are kept.
  return stripDanglingIds(drafts, requirements).questions;
}
