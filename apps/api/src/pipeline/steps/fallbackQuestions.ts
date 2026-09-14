import type { Requirement } from "@prep/shared";
import type { DraftQuestion } from "../types.js";

/**
 * The last resort for a must-have the model never covered, even after being
 * asked for it by name. A kit must not ship with a required item nobody can
 * practise, and a plain question written in code from the requirement's own
 * words is honest about what it is: the kit's warnings say which ones they are.
 */
export function fallbackQuestion(requirement: Requirement): DraftQuestion {
  const text = requirement.text.replace(/[.\s]+$/, "");

  if (requirement.kind === "behavioural") {
    return {
      requirement_ids: [requirement.id],
      category: "behavioural",
      prompt: `The role asks for this: "${text}". Tell me about a time you showed it. What did you do, and what changed because of it?`,
      answer_outline: `Pick one real situation where you showed "${text}". Say what you did yourself, not the team, what got in the way, and the outcome, with a number if you have one.`,
      difficulty: 2,
    };
  }

  return {
    requirement_ids: [requirement.id],
    category: "technical",
    prompt: `The role asks for this: "${text}". Walk me through a real piece of work where you used it, and one decision you would make differently today.`,
    answer_outline: `Name the project and your part in it. Explain the key choices you made about "${text}" and the trade-offs behind them. Close with what you would change now and why.`,
    difficulty: 2,
  };
}
