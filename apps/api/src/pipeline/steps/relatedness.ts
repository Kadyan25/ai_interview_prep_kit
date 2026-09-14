import type { DraftRequirement } from "../types.js";

/**
 * Checks that a requirement is about what its quote says. The substring check
 * alone proves only that the quote exists: a model can report "10+ years of
 * COBOL" and quote the word "experience", and the quote is real.
 */

const STOPWORDS = new Set(
  "a an and are as at be but by can for from has have in into is it its of on or our that the their this to we will with you your who what when where which while within".split(
    " ",
  ),
);

// Words every requirement uses. Sharing only these proves nothing.
const GENERIC = new Set(
  "ability able experience experienced years year skills skill knowledge work working strong solid good great excellent team teams role including related relevant proven understanding familiarity background plus required preferred must nice have using use".split(
    " ",
  ),
);

// Short enough that "communicator" meets "communication" and "leading" meets "leadership".
const STEM_CHARS = 4;
const ENGLISH_MARKERS = /\b(the|and|you|with|our|will|for)\b/g;

function stems(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}+#.]+/gu) ?? [];
  const out = new Set<string>();
  for (const raw of words) {
    const word = raw.replace(/\.+$/, "");
    if (word.length < 2 || STOPWORDS.has(word) || GENERIC.has(word)) continue;
    out.add(/^\d/.test(word) ? word : word.slice(0, STEM_CHARS));
  }
  return out;
}

/** Roughly: do English function words make up a normal share of the posting? */
export function looksEnglish(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words === 0) return true;
  const markers = text.toLowerCase().match(ENGLISH_MARKERS)?.length ?? 0;
  return markers / words >= 0.04;
}

export function quoteSupportsText(jd: string, text: string, evidence: string): boolean {
  const quoted = stems(evidence);
  // "experience", "strong skills": nothing specific enough to stand as proof.
  if (quoted.size === 0) return false;
  // Across languages the requirement is a translation of its quote, so shared
  // words cannot be expected. The quote still has to say something specific.
  if (!looksEnglish(jd)) return true;
  const stated = stems(text);
  for (const stem of stated) if (quoted.has(stem)) return true;
  // A long, specific quote with no shared word is far more often a paraphrase
  // ("led teams" for "leadership") than an invention, and dropping a real
  // requirement costs as much as keeping a fake one. Short quotes get no benefit
  // of the doubt: that is where a model grabs a stray phrase.
  return quoted.size >= LONG_QUOTE_STEMS;
}

const LONG_QUOTE_STEMS = 4;

/**
 * Two drafts for one requirement: identical wording, or the same quote with one
 * text saying nothing the other does not ("Kubernetes" and "Experience running
 * Kubernetes clusters"). A compound quote split into Go and Postgres is not a
 * duplicate, since neither text contains the other.
 */
export function isDuplicate(
  a: Pick<DraftRequirement, "text" | "evidence">,
  b: Pick<DraftRequirement, "text" | "evidence">,
): boolean {
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  if (squash(a.text) === squash(b.text)) return true;
  if (squash(a.evidence) !== squash(b.evidence)) return false;

  const left = stems(a.text);
  const right = stems(b.text);
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  return small.size > 0 && [...small].every((stem) => large.has(stem));
}
