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

// Longer lines are a posting pasted without line breaks, or a wall of prose.
const LONG_LINE_CHARS = 400;

/**
 * Breaks an overlong line at sentence ends and bullet glyphs. Without this a
 * posting pasted as one line is one unit: longer than any budget it is dropped
 * whole, and one mention of "equal opportunity" would delete all of it.
 */
function splitLongLine(line: string): string[] {
  if (line.length <= LONG_LINE_CHARS) return [line];
  const pieces = line.split(/(?<=[.!?])\s+(?=[\p{Lu}\d•·-])|\s+(?=[•·▪]\s)/u).filter((p) => p.trim());
  // No sentence breaks at all: fall back to fixed slices so the budget can still cut it.
  return pieces.every((p) => p.length <= LONG_LINE_CHARS * 4)
    ? pieces
    : (line.match(new RegExp(`[\\s\\S]{1,${LONG_LINE_CHARS}}`, "g")) ?? [line]);
}

function splitSections(jd: string): Section[] {
  const sections: Section[] = [{ kind: null, lines: [] }];
  for (const line of jd.split("\n").flatMap(splitLongLine)) {
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

// Share of the leftover budget kept from the top of the posting; the rest comes
// from the bottom, where requirements under an unrecognised heading usually are.
const HEAD_SHARE = 0.4;
const GAP_MARKER = "[…]";

/**
 * Every recognised requirement section is kept whole. Other lines fill what is
 * left from both ends: the top carries the title and summary, and the bottom is
 * where a requirements list sits when its heading is worded in a way the
 * heading lexicon does not know ("What you bring to the team").
 */
function keepRequirementsThenEnds(sections: Section[], maxChars: number): string {
  const isRequirement = (s: Section) => s.kind === "must" || s.kind === "nice";
  const reserved = join(sections.filter(isRequirement)).length;
  const budget = Math.max(0, maxChars - reserved - GAP_MARKER.length - 2);

  // Tag each other line with its position so the result stays in posting order.
  const others = sections.flatMap((s, si) =>
    isRequirement(s) ? [] : s.lines.map((line, li) => ({ key: `${si}:${li}`, line })),
  );
  const keep = new Set<string>();
  let headLeft = Math.floor(budget * HEAD_SHARE);
  for (const { key, line } of others) {
    if (line.length + 1 > headLeft) break;
    keep.add(key);
    headLeft -= line.length + 1;
  }
  let tailLeft = budget - (Math.floor(budget * HEAD_SHARE) - headLeft);
  for (const { key, line } of [...others].reverse()) {
    if (keep.has(key) || line.length + 1 > tailLeft) break;
    keep.add(key);
    tailLeft -= line.length + 1;
  }

  const out: string[] = [];
  let skipped = false;
  sections.forEach((s, si) => {
    s.lines.forEach((line, li) => {
      if (isRequirement(s) || keep.has(`${si}:${li}`)) {
        if (skipped) out.push(GAP_MARKER);
        skipped = false;
        out.push(line);
      } else {
        skipped = true;
      }
    });
  });
  return out.join("\n").trim();
}

/**
 * Returns the posting unchanged when it fits. When it does not, it removes, in
 * order: benefits and legal sections, then stray legal sentences, then — only if
 * still too long — ordinary text from the middle, keeping the top, the bottom
 * and every requirements section whole. The requirement sections are the reason extraction exists, so
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

  if (text.length > maxChars) text = keepRequirementsThenEnds(sections, maxChars);

  // Requirement sections alone longer than the ceiling: a hard cut is the only
  // option left, and it keeps the start of them.
  if (text.length > maxChars) text = text.slice(0, maxChars);
  // Whatever happened above, the model never gets an empty posting for a real one.
  if (text.trim().length === 0) text = jd.slice(0, maxChars);

  return { text, condensed: true, removedChars: jd.length - text.length };
}
