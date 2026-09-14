import type { EvaluateCase } from "@prep/shared";

/** A case as read from the input file, plus why it cannot run, if it cannot. */
export type BatchCase = EvaluateCase & { problem?: string };

export class CasesFileError extends Error {}

/**
 * Accepts a bare array or `{ cases: [...] }`. Only the file's overall shape can
 * reject the run; a malformed case becomes a failed entry for that case alone,
 * because the brief's output needs one entry per input case whatever is wrong
 * with it.
 */
export function readCases(parsed: unknown): BatchCase[] {
  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.cases)
      ? parsed.cases
      : null;
  if (!list) {
    throw new CasesFileError("expected a JSON array of cases, or an object with a \"cases\" array");
  }
  return list.map((value, index) => normaliseCase(value, index));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normaliseCase(value: unknown, index: number): BatchCase {
  const fallbackId = `case-${index + 1}`;
  if (!isRecord(value)) {
    return { id: fallbackId, jd: "", company_url: "", days: Number.NaN, problem: "the case is not a JSON object" };
  }

  const problems: string[] = [];
  const id = idOf(value.id);
  if (!id) problems.push("id is missing");
  if (typeof value.jd !== "string") problems.push("jd must be a string");

  return {
    id: id ?? fallbackId,
    jd: typeof value.jd === "string" ? value.jd : "",
    // A missing or null URL means "no company site", which still builds a kit.
    company_url: typeof value.company_url === "string" ? value.company_url : "",
    days: daysOf(value.days),
    ...(problems.length > 0 ? { problem: problems.join("; ") } : {}),
  };
}

function idOf(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim().length > 0) return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

/** "7" is read as 7; anything else that is not a number is left for the pipeline to reject. */
function daysOf(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && /^\s*\d+\s*$/.test(raw)) return Number(raw);
  return Number.NaN;
}
