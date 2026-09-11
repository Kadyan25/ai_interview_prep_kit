import mongoose from "mongoose";
import type { ItemStateMap, KitBody } from "@prep/shared";
import { Kit } from "../models/Kit.js";
import { AppError, toAppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { createLlmFromEnv } from "../llm/factory.js";
import { createResearchDeps } from "../retrieval/index.js";
import { countersFor } from "../pipeline/canonical.js";
import { runPipeline } from "../pipeline/runPipeline.js";
import type { LlmClient } from "../llm/types.js";
import type { ResearchDeps } from "../pipeline/types.js";
import { finishJob, markRunning, recordStep, sweepInterruptedJobs } from "../services/jobs.js";

export type QueuedJob = {
  jobId: mongoose.Types.ObjectId;
  kitId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
};

/**
 * One job at a time, in this process. A queue service would be the right answer
 * at scale, but generation is a single ~90 second task per user and the free
 * tier gives us one small instance: an in-process queue keeps the deployment to
 * two services and the failure mode easy to reason about. Progress is persisted
 * every step, so a restart loses the run but never the record of it.
 */
const queue: QueuedJob[] = [];
let draining = false;

let llmClient: LlmClient | null = null;
let researchDeps: ResearchDeps | null = null;

function llm(): LlmClient {
  llmClient ??= createLlmFromEnv();
  return llmClient;
}

function research(): ResearchDeps {
  researchDeps ??= createResearchDeps();
  return researchDeps;
}

/** Every generated item starts life as "generated" and unpinned. */
export function initialItemState(body: KitBody): ItemStateMap {
  const state: ItemStateMap = {};
  const mark = (id: string) => {
    state[id] = { origin: "generated", pinned: false };
  };
  body.role.requirements.forEach((r) => mark(r.id));
  body.questions.forEach((q) => mark(q.id));
  body.flashcards.forEach((f) => mark(f.id));
  mark("company_brief");
  mark("schedule");
  return state;
}

export function enqueueJob(job: QueuedJob): void {
  queue.push(job);
  // setImmediate keeps the HTTP response on its way before work starts.
  setImmediate(() => {
    void drain();
  });
}

export function queueDepth(): number {
  return queue.length;
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const next = queue.shift()!;
      try {
        await runJob(next);
      } catch (error) {
        logger.error({ err: error, jobId: next.jobId.toString() }, "job runner crashed");
      }
    }
  } finally {
    draining = false;
  }
}

async function runJob(job: QueuedJob): Promise<void> {
  const kit = await Kit.findOne({ _id: job.kitId, userId: job.userId });
  if (!kit) {
    await finishJob(job.jobId, "failed", {
      code: "NOT_FOUND",
      message: "The kit was deleted before generation started.",
    });
    return;
  }

  const started = Date.now();
  await markRunning(job.jobId);
  logger.info({ kitId: kit._id.toString() }, "generation started");

  try {
    const result = await runPipeline(kit.input, {
      llm: llm(),
      research: research(),
      logger: logger.child({ kitId: kit._id.toString() }),
      onProgress: (step, status, note) => recordStep(job.jobId, step, status, note),
    });

    await Kit.updateOne(
      { _id: kit._id },
      {
        $set: {
          status: result.status,
          body: result.body,
          itemState: initialItemState(result.body),
          counters: countersFor(result.body),
          research: result.research,
        },
        $inc: { version: 1 },
      },
    );

    await finishJob(job.jobId, "done");
    logger.info(
      { kitId: kit._id.toString(), ms: Date.now() - started, status: result.status },
      "generation finished",
    );
  } catch (error) {
    const appError = toAppError(error);
    await Kit.updateOne({ _id: kit._id }, { $set: { status: "failed" } });
    await finishJob(job.jobId, "failed", { code: appError.code, message: appError.message });
    logger.warn(
      { kitId: kit._id.toString(), code: appError.code, message: appError.message },
      "generation failed",
    );
  }
}

/**
 * Called once at boot. Anything still marked running belonged to a process that
 * is gone.
 */
export async function recoverInterrupted(): Promise<void> {
  const jobs = await sweepInterruptedJobs();
  if (jobs === 0) return;
  await Kit.updateMany({ status: "generating" }, { $set: { status: "failed" } });
}

/** Guards the endpoints that need a model before they accept work. */
export function assertGeneratorReady(): void {
  try {
    llm();
  } catch (error) {
    throw new AppError(
      "LLM_UNAVAILABLE",
      error instanceof Error ? error.message : "No model provider is configured.",
    );
  }
}
