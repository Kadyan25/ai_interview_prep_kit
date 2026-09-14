import { JD_PROMPT_CHARS } from "../steps/condenseJd.js";
import { systemFor, untrusted } from "./system.js";

export const extractRequirementsSystem = systemFor(
  `Read one job description and report what it actually asks for.

Rules you must follow:
- Every requirement carries "evidence": a span copied word for word from the job
  description. Copy it exactly, do not paraphrase, do not fix typos.
- If you cannot quote the job description for something, do not report it.
- Do not add industry-standard expectations that the posting does not mention.
- "kind" is "technical" for tools, languages, systems and engineering practice,
  "behavioural" for collaboration, communication, ownership and leadership,
  "domain" for industry or product knowledge.
- "priority" is "must" when the posting treats it as required and "nice" when it
  is optional, preferred or a bonus.
- "cue" is the single word or phrase in the posting that told you the priority,
  such as "required", "must", "bonus", "nice to have". Use "" if there was none.
- Split compound sentences into separate requirements when they can be assessed
  separately. Keep each requirement text under 120 characters.
- A short posting yields a short list. That is correct, not a failure.`,
);

export function extractRequirementsUser(jd: string): string {
  return [
    "Extract the role details and requirements from this job description.",
    // The caller has already fitted the posting to JD_PROMPT_CHARS; this cap is
    // only a backstop and must never be the thing that shortens a posting.
    untrusted("jd", jd, JD_PROMPT_CHARS),
    `Reply with JSON of exactly this shape:
{
  "company": "company name if the posting states one, else \\"\\"",
  "title": "the role title as written",
  "seniority": "one of: intern, junior, mid, senior, staff, lead, principal, unspecified",
  "location": "location or working arrangement as written, else \\"\\"",
  "responsibilities": ["what the person will do, each under 120 characters"],
  "requirements": [
    {
      "text": "the requirement in your own words, under 120 characters",
      "kind": "technical | behavioural | domain",
      "priority": "must | nice",
      "evidence": "verbatim span copied from the posting",
      "cue": "the word that signalled the priority, or \\"\\""
    }
  ]
}`,
  ].join("\n\n");
}
