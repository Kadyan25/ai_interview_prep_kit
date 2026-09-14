import type { RequirementPriority } from "@prep/shared";
import type { DraftRequirement } from "../types.js";
import { classifyHeading, headingLabel } from "./sections.js";

/**
 * Anti-invention. The model must quote the job description verbatim for every
 * requirement it reports. If the quote is not actually in the text, the
 * requirement is dropped — reporting a thin list beats inventing a rich one.
 * Priority is then re-derived in code from the words around the quote, so
 * "nice to have" cannot be silently promoted to a must.
 */

const NICE_CUES = [
  "nice to have",
  "nice-to-have",
  "good to have",
  "bonus",
  "a plus",
  "plus",
  "preferred",
  "preferably",
  "ideally",
  "desirable",
  "familiarity",
  "exposure to",
  "optional",
];

const MUST_CUES = [
  "required",
  "must have",
  "must",
  "need to",
  "you need",
  "essential",
  "minimum",
  "at least",
  "proven",
  "strong",
  "solid",
  "expert",
  "deep experience",
];

const MIN_EVIDENCE_CHARS = 8;
// Long enough to reach the heading of a real requirements section of ten or more bullets.
const HEADING_LOOKBACK_LINES = 40;
const HEADING_MAX_CHARS = 60;
const LABEL_PREFIX_MAX_CHARS = 30;

/**
 * Boundaries between clauses inside one bullet: dashes, semicolons, and sentence
 * ends that are not abbreviations. In "Deep expertise in X — hands-on experience
 * strongly preferred", the "preferred" belongs to the second clause only.
 */
const CLAUSE_BOUNDARY = /\s-\s|[–—]|;|(?<!\b(?:e\.g|i\.e|etc|vs|incl))\.\s/g;

/**
 * Two normalisations of the same text, character-aligned: every run of
 * whitespace becomes exactly one character in both, so an index found in one is
 * valid in the other. Matching uses the flat form; cue lookup uses the form that
 * still knows where the lines are.
 */
function normalise(text: string, keepLines: boolean): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, (run) => (keepLines && /[\n\r]/.test(run) ? "\n" : " "))
    .trim();
}

export function normaliseForMatch(text: string): string {
  return normalise(text, false);
}

// Dashes, hyphens and whitespace: characters a model re-types without changing a word.
const RETYPED = /[\s­‐-―−-]/;

/** The text with re-typable characters removed, plus where each kept char came from. */
function withoutRetyped(text: string): { text: string; origin: number[] } {
  let out = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (RETYPED.test(char)) continue;
    out += char;
    origin.push(i);
  }
  return { text: out, origin };
}

/** Index of the quote inside the normalised job description, or -1. */
export function findEvidence(jd: string, evidence: string): number {
  const needle = normaliseForMatch(evidence);
  if (needle.length < MIN_EVIDENCE_CHARS) return -1; // too short to prove anything

  const haystack = normaliseForMatch(jd);
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return exact;

  // Models quote faithfully but re-type punctuation: an em dash becomes " - ", a
  // plain hyphen becomes a non-breaking one. That is not invention, so the match
  // ignores dashes and spacing — every letter, digit and other mark must still agree.
  const looseNeedle = withoutRetyped(needle).text;
  if (looseNeedle.length < MIN_EVIDENCE_CHARS) return -1;
  const looseHaystack = withoutRetyped(haystack);
  const at = looseHaystack.text.indexOf(looseNeedle);
  return at >= 0 ? looseHaystack.origin[at]! : -1;
}

type CueHit = { priority: RequirementPriority; distance: number; cue: string };

function findCues(haystack: string, spanStart: number, spanEnd: number): CueHit | null {
  let best: CueHit | null = null;

  const consider = (cue: string, priority: RequirementPriority) => {
    const pattern = new RegExp(`\\b${cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    for (let match = pattern.exec(haystack); match; match = pattern.exec(haystack)) {
      const start = match.index;
      const end = start + match[0].length;
      const distance =
        end <= spanStart ? spanStart - end : start >= spanEnd ? start - spanEnd : 0;
      if (!best || distance < best.distance) best = { priority, distance, cue };
    }
  };

  for (const cue of NICE_CUES) consider(cue, "nice");
  for (const cue of MUST_CUES) consider(cue, "must");

  return best;
}

/** The clause of a segment that contains a position. */
function clauseAround(segment: string, position: number): { start: number; end: number } {
  let start = 0;
  let end = segment.length;
  for (const match of segment.matchAll(CLAUSE_BOUNDARY)) {
    const matchStart = match.index ?? 0;
    const matchEnd = matchStart + match[0].length;
    if (matchEnd <= position) {
      start = matchEnd;
    } else if (matchStart >= position) {
      end = matchStart;
      break;
    } else {
      start = matchEnd;
    }
  }
  return { start, end };
}

/**
 * The nearest section heading above a line decides for it. Walking up stops at
 * the first heading of any kind, so a bullet under "Benefits" never inherits the
 * "Requirements" heading further up the page.
 */
function governingHeading(linesAbove: string[]): { priority: RequirementPriority; cue: string } | null {
  let scanned = 0;
  for (let i = linesAbove.length - 1; i >= 0 && scanned < HEADING_LOOKBACK_LINES; i -= 1) {
    const line = linesAbove[i]!.trim();
    if (line.length === 0) continue;
    scanned += 1;

    const kind = classifyHeading(line);
    if (kind === "must" || kind === "nice") return { priority: kind, cue: headingLabel(line) };
    if (kind === "neutral" || kind === "boilerplate") return null;

    // A short line ending in a colon is a heading even when its wording is unusual.
    if (line.length <= HEADING_MAX_CHARS && line.endsWith(":")) {
      const hit = findCues(line, line.length, line.length);
      return hit ? { priority: hit.priority, cue: hit.cue } : null;
    }
  }
  return null;
}

/**
 * Re-derives priority from the posting's own wording, in order of how directly
 * the wording applies:
 *   1. a cue in the same clause as the quote
 *   2. a short label in front of that clause, as in "Required — 5 years of Go"
 *   3. the section heading the quote sits under
 * Reaching across clauses or bullets is how "nice to have" leaks onto the wrong
 * requirement, so nothing further away is consulted. With no cue in range the
 * model's own answer stands.
 */
export function derivePriority(
  jd: string,
  evidence: string,
  modelPriority: RequirementPriority,
): { priority: RequirementPriority; cue: string | null } {
  const index = findEvidence(jd, evidence);
  if (index < 0) return { priority: modelPriority, cue: null };

  const lined = normalise(jd, true);
  const evidenceLength = normaliseForMatch(evidence).length;

  const segmentStart = lined.lastIndexOf("\n", Math.max(index - 1, 0)) + 1;
  const rawSegmentEnd = lined.indexOf("\n", index);
  const segmentEnd = rawSegmentEnd === -1 ? lined.length : rawSegmentEnd;
  const segment = lined.slice(segmentStart, segmentEnd);
  const position = index - segmentStart;

  const clause = clauseAround(segment, position);
  const clauseText = segment.slice(clause.start, clause.end);
  const quoteStart = position - clause.start;
  const quoteEnd = Math.min(clauseText.length, quoteStart + evidenceLength);

  const inClause = findCues(clauseText, quoteStart, quoteEnd);
  if (inClause) return { priority: inClause.priority, cue: inClause.cue };

  if (clause.start > 0) {
    const label = segment.slice(0, clause.start).replace(/[\s\-–—;.]+$/, "");
    if (label.trim().length <= LABEL_PREFIX_MAX_CHARS) {
      const fromLabel = findCues(label, label.length, label.length);
      if (fromLabel) return { priority: fromLabel.priority, cue: fromLabel.cue };
    }
  }

  const fromHeading = governingHeading(lined.slice(0, segmentStart).split("\n"));
  if (fromHeading) return fromHeading;

  return { priority: modelPriority, cue: null };
}

export type EvidenceOutcome = {
  kept: DraftRequirement[];
  dropped: { text: string; evidence: string }[];
  reprioritised: { text: string; from: RequirementPriority; to: RequirementPriority; cue: string }[];
};

export function applyEvidenceRules(jd: string, drafts: DraftRequirement[]): EvidenceOutcome {
  const kept: DraftRequirement[] = [];
  const dropped: EvidenceOutcome["dropped"] = [];
  const reprioritised: EvidenceOutcome["reprioritised"] = [];
  const seen = new Set<string>();

  for (const draft of drafts) {
    const text = draft.text?.trim() ?? "";
    const evidence = draft.evidence?.trim() ?? "";
    if (text.length === 0) continue;

    if (findEvidence(jd, evidence) < 0) {
      dropped.push({ text, evidence });
      continue;
    }

    const key = normaliseForMatch(text);
    if (seen.has(key)) continue;
    seen.add(key);

    const { priority, cue } = derivePriority(jd, evidence, draft.priority);
    if (cue && priority !== draft.priority) {
      reprioritised.push({ text, from: draft.priority, to: priority, cue });
    }

    kept.push({ ...draft, text, evidence, priority, ...(cue ? { cue } : {}) });
  }

  return { kept, dropped, reprioritised };
}
