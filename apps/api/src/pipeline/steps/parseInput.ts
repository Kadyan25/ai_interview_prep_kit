import net from "node:net";
import { AppError } from "../../lib/errors.js";
import { sanitiseJd } from "./sanitiseJd.js";
import type { PipelineInput, Warnings } from "../types.js";

export const THIN_JD_CHARS = 400;
export const THIN_JD_WORDS = 60;
// A sanity ceiling, not a posting limit: anything longer is condensed before the
// model sees it, so a long real posting is never refused. Past this it is not a
// job description.
export const MAX_JD_CHARS = 200_000;

export type ParsedInput = {
  jd: string;
  jdChars: number;
  wordCount: number;
  isThin: boolean;
  /** null when no usable company URL was supplied. */
  companyUrl: string | null;
  /** Exactly what was supplied, recorded in the kit even when it was unusable. */
  rawCompanyUrl: string;
  /** Why a supplied URL could not be used, or null when it was fine or absent. */
  companyUrlProblem: string | null;
  /** Best guess before research; the model may replace it with the real name. */
  companyLabel: string;
  days: number;
};

function withScheme(raw: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** Plain-language reason a URL cannot be crawled, or null when it can. */
function urlProblem(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(withScheme(raw));
  } catch {
    return "is not a valid web address";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "is not an http or https address";
  }
  if (!parsed.hostname || /\s/.test(raw)) {
    return "is not a valid web address";
  }
  return null;
}

/**
 * A host only names a company when it is a real domain. "127.0.0.1" and
 * "localhost" gave kits a company called "127" and sent "Localhost" to a paid
 * search, so those fall back to the neutral label.
 */
function guessCompanyFromHost(hostname: string): string | null {
  if (net.isIP(hostname) !== 0 || !hostname.includes(".")) return null;
  const bare = hostname.replace(/^www\./, "");
  const label = bare.split(".")[0] ?? bare;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function parseInput(input: PipelineInput, warnings: Warnings): ParsedInput {
  const supplied = input.jd?.trim() ?? "";
  // Done before anything else reads the posting, so no later step — including the
  // verbatim-evidence check — can be steered by text aimed at the model.
  const sanitised = sanitiseJd(supplied);
  const jd = sanitised.text.trim();
  if (jd.length === 0) {
    throw new AppError("INVALID_INPUT", "The job description is empty.");
  }
  if (sanitised.removed.length > 0) {
    warnings.add(
      `${sanitised.removed.length} line${sanitised.removed.length === 1 ? "" : "s"} in the posting tried to give instructions rather than describe the job, so ${sanitised.removed.length === 1 ? "it was" : "they were"} ignored.`,
    );
  }
  if (jd.length > MAX_JD_CHARS) {
    throw new AppError(
      "INVALID_INPUT",
      `The job description is ${jd.length} characters; the limit is ${MAX_JD_CHARS}.`,
    );
  }

  const days = input.days;
  if (!Number.isInteger(days) || days < 1 || days > 60) {
    throw new AppError("INVALID_INPUT", "Days until the interview must be a whole number from 1 to 60.");
  }

  const wordCount = jd.split(/\s+/).filter(Boolean).length;
  const isThin = jd.length < THIN_JD_CHARS || wordCount < THIN_JD_WORDS;
  if (isThin) {
    warnings.add(
      `The job description is only ${wordCount} words, so the requirements list is short by design rather than padded with guesses.`,
    );
  }

  const rawCompanyUrl = input.companyUrl?.trim() ?? "";
  let companyUrl: string | null = null;
  let companyUrlProblem: string | null = null;
  let companyLabel = "the company";

  if (rawCompanyUrl.length === 0) {
    warnings.add("No company URL was supplied, so the brief is based on the job description alone.");
  } else {
    // A bad URL costs the research, not the kit. The brief reserves "failed" for a
    // case that produces no kit at all, and the posting alone still produces one.
    companyUrlProblem = urlProblem(rawCompanyUrl);
    if (companyUrlProblem) {
      warnings.add(
        `The company URL "${rawCompanyUrl}" ${companyUrlProblem}, so the company was not researched and the brief is based on the job description alone.`,
      );
    } else {
      const parsed = new URL(withScheme(rawCompanyUrl));
      companyUrl = parsed.toString();
      companyLabel = guessCompanyFromHost(parsed.hostname) ?? companyLabel;
    }
  }

  return {
    jd,
    jdChars: jd.length,
    wordCount,
    isThin,
    companyUrl,
    rawCompanyUrl,
    companyUrlProblem,
    companyLabel,
    days,
  };
}
