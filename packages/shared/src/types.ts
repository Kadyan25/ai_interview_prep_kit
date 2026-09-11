import type { KitBody } from "./kit.schema.js";
import type { ErrorCode } from "./errors.js";

/** What the user supplies for one kit. */
export type KitInput = {
  jd: string;
  companyUrl: string;
  days: number;
};

export type KitStatus = "generating" | "ready" | "partial" | "failed";

/**
 * Builder state. Kept beside the body, keyed by item id ("q3", "f1", "r2") or by
 * section name ("company_brief", "schedule"). `origin` decides what a section
 * regeneration is allowed to overwrite.
 */
export type ItemOrigin = "generated" | "edited" | "manual";

export type ItemState = {
  origin: ItemOrigin;
  pinned: boolean;
};

export type ItemStateMap = Record<string, ItemState>;

/** Next id number per prefix. Ids are never reused inside one kit. */
export type KitCounters = { r: number; q: number; f: number };

export type DiscussionHit = { url: string; title: string; snippet: string };

export type SkippedPage = { url: string; reason: string };

/** Research findings kept beside the body; they feed regeneration prompts. */
export type KitResearch = {
  hiringPageUrl: string | null;
  hiringProcess: string | null;
  discussion: DiscussionHit[];
  skipped: SkippedPage[];
};

export type JobType = "full" | "regen_brief" | "regen_category" | "regen_schedule";
export type JobStatus = "queued" | "running" | "done" | "failed";
export type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";

export type JobStep = {
  name: string;
  status: StepStatus;
  note?: string;
  startedAt?: string;
  endedAt?: string;
};

/** A kit as the web client sees it. */
export type KitDocument = {
  id: string;
  status: KitStatus;
  input: KitInput;
  body: KitBody | null;
  itemState: ItemStateMap;
  counters: KitCounters;
  version: number;
  research: KitResearch;
  createdAt: string;
  updatedAt: string;
};

export type KitSummary = {
  id: string;
  status: KitStatus;
  company: string;
  role: string;
  days: number;
  questionCount: number;
  warningCount: number;
  createdAt: string;
  updatedAt: string;
};

/* ---------------------------------------------------------------------------
 * Batch runner contract (assessment Appendix B)
 * ------------------------------------------------------------------------- */

export type EvaluateCase = {
  id: string;
  jd: string;
  company_url: string;
  days: number;
};

export type EvaluateResult = {
  id: string;
  status: "ok" | "failed";
  kit?: KitBody;
  error?: { code: ErrorCode | string; message: string };
};

export type EvaluateOutput = {
  version: "1.0";
  generated_at: string;
  kits: EvaluateResult[];
};
