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

/** A job as the web client sees it; `label` is the human name for the step. */
export type JobDocument = {
  id: string;
  kitId: string;
  type: JobType;
  category: string | null;
  status: JobStatus;
  steps: (JobStep & { label: string })[];
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
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
 * Practice mode
 * ------------------------------------------------------------------------- */

export type Confidence = 1 | 2 | 3;

export type PracticeCard = {
  id: string;
  front: string;
  back: string;
  requirement_ids: string[];
  seenCount: number;
  confidence: Confidence | null;
  lastSeenAt: string | null;
  requirements: { id: string; text: string; priority: "must" | "nice" }[];
};

export type PracticeStats = {
  total: number;
  seen: number;
  byConfidence: Record<"1" | "2" | "3", number>;
  byRequirement: {
    id: string;
    text: string;
    priority: "must" | "nice";
    cards: number;
    seen: number;
    shaky: number;
  }[];
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

/**
 * Appendix B shows both `kit` and `error` on every entry, with the unused one set
 * to null. Both are always present so a strict shape check never trips on a
 * missing key.
 */
export type EvaluateResult =
  | { id: string; status: "ok"; kit: KitBody; error: null }
  | { id: string; status: "failed"; kit: null; error: { code: ErrorCode | string; message: string } };

export type EvaluateOutput = {
  version: "1.0";
  generated_at: string;
  kits: EvaluateResult[];
};
