import type { QuestionCategory, Requirement } from "@prep/shared";
import { capContext, systemFor, untrusted } from "./system.js";

const CATEGORY_BRIEF: Record<QuestionCategory, string> = {
  technical: `Write technical interview questions. Probe the specific tools, languages and
practices the posting names. Favour questions about tradeoffs, debugging and real decisions
over trivia. Domain requirements are framed as "how would you apply this in their industry".`,

  behavioural: `Write behavioural interview questions. Each one asks for a specific past
situation, not a hypothetical or an opinion. The answer outline is a STAR skeleton: the
situation to pick, the action to emphasise, and the result worth stating.`,

  "system-design": `Write system design questions scoped to the kind of system this company
actually runs. Each answer outline lists the clarifying questions to ask first, the main
components, the bottleneck to name, and the tradeoff the interviewer is listening for.`,

  "company-fit": `Write questions about this specific company: what it builds, why the
candidate wants it, and how they would work inside its hiring and engineering culture. These
may have an empty requirement_ids array. Never invent facts about the company — use only what
the brief and the sources below actually say.`,
};

export function generateQuestionsSystem(category: QuestionCategory): string {
  return systemFor(
    `${CATEGORY_BRIEF[category]}

Rules for every question:
- "requirement_ids" must only use ids from the list you are given. Never invent an id.
- "difficulty" is 1 for a warm-up, 2 for a normal interview question, 3 for the hardest
  question a candidate at this level would face.
- "answer_outline" is what a strong answer covers, in 2 to 4 sentences. It is a plan for the
  candidate, not a model answer to recite.
- No duplicates, and no question that restates another in different words.`,
  );
}

export type QuestionPromptContext = {
  category: QuestionCategory;
  roleTitle: string;
  seniority: string;
  company: string;
  requirements: Requirement[];
  count: number;
  /** What the company's own hiring page said, when one was found. */
  hiringProcess?: string | null;
  /** Short company summary, used mostly by company-fit. */
  companySummary?: string | null;
};

export function generateQuestionsUser(context: QuestionPromptContext): string {
  const requirementLines = context.requirements
    .map((r) => `- ${r.id} [${r.priority}, ${r.kind}] ${r.text}`)
    .join("\n");

  const blocks = [
    `Role: ${context.roleTitle} (${context.seniority}) at ${context.company}.`,
    context.requirements.length > 0
      ? `Requirements to cover. Every id you cite must come from this list:\n${requirementLines}`
      : "This posting yielded no quotable requirements, so keep the questions general to the role title.",
  ];

  if (context.companySummary) {
    blocks.push(`What the company does:\n${untrusted("page:brief", context.companySummary, 1500)}`);
  }

  if (context.hiringProcess) {
    blocks.push(
      `Their published hiring process. Shape the questions to the rounds it describes:\n${untrusted(
        "hiring_page",
        context.hiringProcess,
        1500,
      )}`,
    );
  }

  blocks.push(
    `Write ${context.count} ${context.category} questions.

Reply with JSON of exactly this shape:
{
  "questions": [
    {
      "requirement_ids": ["r1"],
      "prompt": "the question as an interviewer would ask it",
      "answer_outline": "what a strong answer covers, 2 to 4 sentences",
      "difficulty": 1
    }
  ]
}`,
  );

  return capContext(blocks);
}

/** Follow-up call used by the coverage loop for requirements nothing covered. */
export function generateForGapsUser(context: {
  roleTitle: string;
  company: string;
  category: QuestionCategory;
  requirements: Requirement[];
}): string {
  const lines = context.requirements
    .map((r) => `- ${r.id} [${r.priority}, ${r.kind}] ${r.text}`)
    .join("\n");

  return `Role: ${context.roleTitle} at ${context.company}.

These requirements have no interview question yet. Write exactly one ${context.category} question for each, citing only that requirement's id:
${lines}

Reply with JSON of exactly this shape:
{
  "questions": [
    {
      "requirement_ids": ["r1"],
      "prompt": "the question as an interviewer would ask it",
      "answer_outline": "what a strong answer covers, 2 to 4 sentences",
      "difficulty": 2
    }
  ]
}`;
}
