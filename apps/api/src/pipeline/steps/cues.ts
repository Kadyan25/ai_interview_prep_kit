import type { RequirementPriority } from "@prep/shared";

/**
 * The words in a posting that say how much a requirement matters.
 *
 * Explicit cues state priority outright ("required", "a plus"). Implicit cues
 * only suggest it ("strong", "familiarity with"). When both sit in the same
 * clause the explicit one decides, so "Familiarity with Terraform is required"
 * is a must, and "Kubernetes experience is a strong plus" is nice.
 *
 * English first, then the phrasings the German, French, Spanish and Japanese
 * postings in the test set actually use. Input is lowercased.
 */

export type Cue = { phrase: string; priority: RequirementPriority; explicit: boolean };

const EXPLICIT_NICE = [
  "nice to have", "nice-to-have", "good to have", "bonus", "a plus", "strong plus", "big plus",
  "huge plus", "definite plus", "plus", "preferred", "preferably", "optional", "desirable",
  // de, fr, es
  "wünschenswert", "von vorteil", "idealerweise", "ein plus", "souhaité", "souhaitée", "souhaitable",
  "apprécié", "appréciée", "un plus", "idéalement", "atout", "deseable", "valorable", "se valorará",
  // ja
  "歓迎", "尚可", "優遇",
];

const EXPLICIT_MUST = [
  "required", "must have", "must", "need to", "you need", "essential", "mandatory",
  // de, fr, es
  "erforderlich", "zwingend", "vorausgesetzt", "voraussetzung", "requis", "requise", "obligatoire",
  "exigé", "exigée", "indispensable", "imprescindible", "obligatorio", "requisito", "requerido",
  // ja
  "必須",
];

const IMPLICIT_NICE = ["ideally", "familiarity", "exposure to"];

const IMPLICIT_MUST = ["minimum", "at least", "proven", "strong", "solid", "expert", "deep experience"];

export const CUES: Cue[] = [
  ...EXPLICIT_NICE.map((phrase) => ({ phrase, priority: "nice" as const, explicit: true })),
  ...EXPLICIT_MUST.map((phrase) => ({ phrase, priority: "must" as const, explicit: true })),
  ...IMPLICIT_NICE.map((phrase) => ({ phrase, priority: "nice" as const, explicit: false })),
  ...IMPLICIT_MUST.map((phrase) => ({ phrase, priority: "must" as const, explicit: false })),
];

/**
 * "No degree required" and "a degree is not required" are the opposite of a
 * must. A negation shortly before a must cue turns it into a nice one.
 */
export const NEGATION_BEFORE =
  /\b(no|not|never|without|isn't|aren't|don't|doesn't|nicht|kein|keine|pas|sans|no es|sin)\b[^.;,]{0,30}$/;

const CJK = /[぀-ヿ㐀-鿿]/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A pattern for one cue. Latin-script cues need word boundaries that understand
 * accented letters (plain \b does not, so "souhaité" would never match);
 * Japanese has no spaces between words, so its cues match anywhere.
 */
export function cuePattern(phrase: string): RegExp {
  const cached = patterns.get(phrase);
  if (cached) return cached;
  const body = escapeRegExp(phrase);
  const pattern = CJK.test(phrase)
    ? new RegExp(body, "gu")
    : new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "gu");
  patterns.set(phrase, pattern);
  return pattern;
}

// Compiled once; matchAll copies the pattern, so sharing a global regex is safe.
const patterns = new Map<string, RegExp>();
