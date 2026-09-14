import type { DiscussionHit } from "@prep/shared";
import { capContext, systemFor, untrusted } from "./system.js";
import type { FetchedPage } from "../types.js";

export const writeBriefSystem = systemFor(
  `Write a short company brief for a candidate about to interview there.

Rules:
- Use only the sources provided. If they do not say something, do not say it either.
- "summary" is 2 to 3 sentences on who the company is and why this role exists.
- "what_they_do" is 2 to 4 sentences on the product and who uses it, concrete enough
  that the candidate could repeat it in an interview.
- "how_they_hire" describes their interview process if a source describes it. If no
  source does, say plainly that no public description of their process was found.
- If their hiring page is not provided but public discussion is, "how_they_hire"
  summarises only what candidates report about the process (stages, formats, topics),
  attributed to candidates. If the discussion says nothing about the process, return "".
- If the only source is the job description, say that the brief is inferred from the
  posting alone. Do not dress up a guess as research.`,
);

export function writeBriefUser(context: {
  companyLabel: string;
  roleTitle: string;
  jd: string;
  pages: FetchedPage[];
  hiringProcess: string | null;
  discussion: DiscussionHit[];
}): string {
  const blocks: string[] = [
    `Company: ${context.companyLabel}. Role being hired: ${context.roleTitle}.`,
  ];

  if (context.pages.length > 0) {
    blocks.push("Pages fetched from the company's own site:");
    for (const page of context.pages.slice(0, 5)) {
      blocks.push(untrusted(`page:${page.url}`, `${page.title}\n\n${page.text}`, 2500));
    }
  } else {
    blocks.push(
      "No pages from the company's site were available. The job description below is the only source.",
    );
  }

  if (context.hiringProcess) {
    blocks.push(`Their hiring process page said:\n${untrusted("hiring_page", context.hiringProcess, 2000)}`);
  }

  if (context.discussion.length > 0) {
    const text = context.discussion
      .slice(0, 5)
      .map((hit) => `${hit.title}: ${hit.snippet}`)
      .join("\n\n");
    blocks.push(
      `Public discussion of interviewing there. Treat it as hearsay and attribute it as such:\n${untrusted(
        "discussion",
        text,
        2000,
      )}`,
    );
  }

  blocks.push(`The job description:\n${untrusted("jd", context.jd, 3000)}`);

  blocks.push(`Reply with JSON of exactly this shape:
{
  "summary": "2 to 3 sentences",
  "what_they_do": "2 to 4 sentences",
  "how_they_hire": "what their process looks like, or an honest statement that none was found"
}`);

  return capContext(blocks);
}
