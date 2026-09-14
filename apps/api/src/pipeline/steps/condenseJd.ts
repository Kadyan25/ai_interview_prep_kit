import { classifyHeading } from "./sections.js";

/**
 * How much of a posting is sent to the model for requirement extraction.
 *
 * Postings put their requirements late, after "about us" and "what you'll do", so
 * a posting must reach the model whole wherever possible. The ceiling comes from
 * the provider rather than from convenience: Groq's free tier allows 8,000 tokens
 * a minute, and 16,000 characters is roughly 4,000 tokens, which leaves room for
 * the instructions and the reply.
 */
export const JD_PROMPT_CHARS = 16_000;

export type CondensedJd = {
  text: string;
  /** True when anything was removed to fit. */
  condensed: boolean;
  removedChars: number;
};

type Section = { kind: ReturnType<typeof classifyHeading>; lines: string[] };

// Paragraph-level legal text that turns up outside any heading.
const BOILERPLATE_LINE =
  /equal (employment )?opportunity|regardless of (race|age|gender|religion|sex)|reasonable accommodation|e-verify|pay transparency|privacy notice|we do not discriminate|protected (veteran|characteristic)/i;

function splitSections(jd: string): Section[] {
  const sections: Section[] = [{ kind: null, lines: [] }];
  for (const line of jd.split("\n")) {
    const kind = classifyHeading(line.toLowerCase().replace(/[‘’]/g, "'"));
    if (kind) sections.push({ kind, lines: [line] });
    else sections[sections.length - 1]!.lines.push(line);
  }
  return sections.filter((s) => s.lines.length > 0);
}

function join(sections: Section[]): string {
  return sections
    .map((s) => s.lines.join("\n"))
    .join("\n")
    .trim();
}

/**
 * Returns the posting unchanged when it fits. When it does not, it removes, in
 * order: benefits and legal sections, then stray legal paragraphs, then — only if
 * still too long — ordinary text from the end while keeping every requirements
 * section whole. The requirement sections are the reason extraction exists, so
 * they are the last thing ever cut.
 */
export function condenseJobDescription(jd: string, maxChars = JD_PROMPT_CHARS): CondensedJd {
  if (jd.length <= maxChars) return { text: jd, condensed: false, removedChars: 0 };

  let sections = splitSections(jd).filter((s) => s.kind !== "boilerplate");
  sections = sections.map((s) => ({
    ...s,
    lines: s.lines.filter((line) => !BOILERPLATE_LINE.test(line)),
  }));

  let text = join(sections);

  if (text.length > maxChars) {
    const isRequirementSection = (s: Section) => s.kind === "must" || s.kind === "nice";
    const reserved = join(sections.filter(isRequirementSection)).length;
    let budget = Math.max(0, maxChars - reserved);

    // Keep other sections from the top, where the role title and summary live,
    // until the budget left over after the requirements runs out.
    const kept: Section[] = [];
    for (const section of sections) {
      if (isRequirementSection(section)) {
        kept.push(section);
        continue;
      }
      const lines: string[] = [];
      for (const line of section.lines) {
        if (line.length + 1 > budget) break;
        lines.push(line);
        budget -= line.length + 1;
      }
      if (lines.length > 0) kept.push({ ...section, lines });
    }
    text = join(kept);
  }

  // Requirement sections alone longer than the ceiling: a hard cut is the only
  // option left, and it keeps the start of them.
  if (text.length > maxChars) text = text.slice(0, maxChars);

  return { text, condensed: true, removedChars: jd.length - text.length };
}
