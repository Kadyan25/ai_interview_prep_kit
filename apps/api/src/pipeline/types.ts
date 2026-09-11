import type {
  DiscussionHit,
  Flashcard,
  KitBody,
  KitResearch,
  Question,
  Requirement,
  SkippedPage,
  StepStatus,
} from "@prep/shared";
import type { Logger } from "../lib/logger.js";
import type { LlmClient } from "../llm/types.js";

/** Ids are assigned once, at assembly. Everything before that is a draft. */
export type DraftQuestion = Omit<Question, "id">;
export type DraftFlashcard = Omit<Flashcard, "id">;
export type DraftRequirement = Omit<Requirement, "id"> & { evidence: string; cue?: string };

export type ProgressReporter = (
  step: string,
  status: StepStatus,
  note?: string,
) => void | Promise<void>;

/** A page that came back from the crawler. */
export type FetchedPage = {
  url: string;
  title: string;
  text: string;
};

export type CrawlResult = {
  pages: FetchedPage[];
  skipped: SkippedPage[];
  reachable: boolean;
};

/**
 * Retrieval is injected so the pipeline stays testable offline and so the batch
 * CLI and the API share one code path.
 */
export type ResearchDeps = {
  crawl(startUrl: string): Promise<CrawlResult>;
  searchDiscussion(companyName: string): Promise<DiscussionHit[]>;
};

export type PipelineDeps = {
  llm: LlmClient;
  logger: Logger;
  research?: ResearchDeps;
  onProgress?: ProgressReporter;
  now?: () => Date;
};

export type PipelineInput = {
  jd: string;
  companyUrl: string;
  days: number;
};

export type PipelineOutput = {
  body: KitBody;
  research: KitResearch;
  /** "partial" means usable but with honest gaps recorded in body.warnings. */
  status: "ready" | "partial";
};

/** Collects honest notes about thin input and missing research. */
export class Warnings {
  private readonly items: string[] = [];

  add(message: string): void {
    if (!this.items.includes(message)) this.items.push(message);
  }

  list(): string[] {
    return [...this.items];
  }

  get count(): number {
    return this.items.length;
  }
}

export type { KitBody, Requirement, Question, Flashcard };
