import type { Requirement } from "@prep/shared";
import { systemFor } from "./system.js";

export const flashcardsSystem = systemFor(
  `Write revision flashcards for a candidate preparing for this interview.

Rules:
- The front is a prompt the candidate can answer out loud in under a minute: a
  definition, a tradeoff, a command, a metric, a first principle.
- The back is the answer, not a hint. Two or three sentences at most.
- Cover the concepts the requirements imply, not the job posting's phrasing.
- "requirement_ids" must only use ids from the list you are given.
- No card that simply repeats an interview question.`,
);

export function flashcardsUser(context: {
  roleTitle: string;
  requirements: Requirement[];
  questionPrompts: string[];
  count: number;
}): string {
  const requirementLines = context.requirements
    .map((r) => `- ${r.id} [${r.priority}] ${r.text}`)
    .join("\n");

  const asked =
    context.questionPrompts.length > 0
      ? `\n\nQuestions already in this kit, so cards stay complementary rather than duplicating them:\n${context.questionPrompts
          .slice(0, 12)
          .map((p) => `- ${p}`)
          .join("\n")}`
      : "";

  return `Role: ${context.roleTitle}.

Requirements:
${requirementLines || "- none could be quoted from the posting"}${asked}

Write ${context.count} flashcards.

Reply with JSON of exactly this shape:
{
  "flashcards": [
    { "front": "the prompt", "back": "the answer", "requirement_ids": ["r1"] }
  ]
}`;
}
