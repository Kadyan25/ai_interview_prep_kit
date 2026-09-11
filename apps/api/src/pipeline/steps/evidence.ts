import type { RequirementPriority } from "@prep/shared";
import type { DraftRequirement } from "../types.js";

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
  "requirements",
  "requirement",
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
const HEADING_LOOKBACK_LINES = 6;
const HEADING_MAX_CHARS = 60;

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

/** Index of the quote inside the normalised job description, or -1. */
export function findEvidence(jd: string, evidence: string): number {
  const needle = normaliseForMatch(evidence);
  if (needle.length < MIN_EVIDENCE_CHARS) return -1; // too short to prove anything
  return normaliseForMatch(jd).indexOf(needle);
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

/** A short line ending in a colon, e.g. "Nice to have:". */
function headingCue(lines: string[]): CueHit | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!.trim();
    if (line.length === 0 || line.length > HEADING_MAX_CHARS) continue;
    if (!line.endsWith(":")) continue;
    const hit = findCues(line, line.length, line.length);
    if (hit) return hit;
  }
  return null;
}

/**
 * Re-derives priority from the posting's own wording. The cue has to sit in the
 * same bullet or sentence as the quote, or in a section heading above it —
 * reaching across unrelated lines is how "nice to have" leaks onto the wrong
 * requirement. With no cue in range the model's own answer stands.
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
  const end = index + evidenceLength;

  const segmentStart = lined.lastIndexOf("\n", Math.max(index - 1, 0)) + 1;
  const rawSegmentEnd = lined.indexOf("\n", end);
  const segmentEnd = rawSegmentEnd === -1 ? lined.length : rawSegmentEnd;
  const segment = lined.slice(segmentStart, segmentEnd);

  const inSegment = findCues(segment, index - segmentStart, end - segmentStart);
  if (inSegment) return { priority: inSegment.priority, cue: inSegment.cue };

  const preceding = lined.slice(0, segmentStart).split("\n").slice(-HEADING_LOOKBACK_LINES);
  const fromHeading = headingCue(preceding);
  if (fromHeading) return { priority: fromHeading.priority, cue: fromHeading.cue };

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
