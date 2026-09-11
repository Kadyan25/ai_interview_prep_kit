import { AppError } from "../../lib/errors.js";
import type { PipelineInput, Warnings } from "../types.js";

export const THIN_JD_CHARS = 400;
export const THIN_JD_WORDS = 60;
export const MAX_JD_CHARS = 50_000;

export type ParsedInput = {
  jd: string;
  jdChars: number;
  wordCount: number;
  isThin: boolean;
  /** null when no usable company URL was supplied. */
  companyUrl: string | null;
  /** Best guess before research; the model may replace it with the real name. */
  companyLabel: string;
  days: number;
};

function guessCompanyFromHost(hostname: string): string {
  const bare = hostname.replace(/^www\./, "");
  const label = bare.split(".")[0] ?? bare;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function parseInput(input: PipelineInput, warnings: Warnings): ParsedInput {
  const jd = input.jd?.trim() ?? "";
  if (jd.length === 0) {
    throw new AppError("INVALID_INPUT", "The job description is empty.");
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

  const rawUrl = input.companyUrl?.trim() ?? "";
  let companyUrl: string | null = null;
  let companyLabel = "the company";

  if (rawUrl.length === 0) {
    warnings.add("No company URL was supplied, so the brief is based on the job description alone.");
  } else {
    const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let parsed: URL;
    try {
      parsed = new URL(withScheme);
    } catch {
      throw new AppError("INVALID_INPUT", `"${rawUrl}" is not a usable company URL.`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new AppError("INVALID_INPUT", `"${rawUrl}" is not an http or https URL.`);
    }
    companyUrl = parsed.toString();
    companyLabel = guessCompanyFromHost(parsed.hostname);
  }

  return { jd, jdChars: jd.length, wordCount, isThin, companyUrl, companyLabel, days };
}
