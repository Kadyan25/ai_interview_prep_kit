import mongoose from "mongoose";
import type { ItemStateMap, JobType, KitBody, QuestionCategory, StepStatus } from "@prep/shared";
import { Kit, type KitDoc } from "../models/Kit.js";
import { GenerationJob } from "../models/GenerationJob.js";
import { AppError, toAppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { createLlmFromEnv } from "../llm/factory.js";
import { createResearchDeps } from "../retrieval/index.js";
import { countersFor } from "../pipeline/canonical.js";
import { runPipeline } from "../pipeline/runPipeline.js";
import type { LlmClient } from "../llm/types.js";
import type { ResearchDeps } from "../pipeline/types.js";
import { finishJob, markRunning, recordStep, sweepInterruptedJobs } from "../services/jobs.js";
import {
  regenerateBrief,
  regenerateCategory,
  regenerateSchedule,
  type RegenPlan,
} from "../services/regenerate.js";

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
  const record = await GenerationJob.findById(job.jobId);
  const kit = await Kit.findOne({ _id: job.kitId, userId: job.userId });

  if (!record) return;
  if (!kit) {
    await finishJob(job.jobId, "failed", {
      code: "NOT_FOUND",
      message: "The kit was deleted before generation started.",
    });
    return;
  }

  if (record.type !== "full") {
    await runRegeneration(job, kit, record.type, record.category);
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
 * Regeneration does its slow work from the kit as it was, then merges into the
 * kit as it is and writes only the paths it owns, version-checked. An edit the
 * user makes while it runs is merged, never overwritten.
 */
async function runRegeneration(
  job: QueuedJob,
  kit: KitDoc,
  type: JobType,
  category: string | null,
): Promise<void> {
  await markRunning(job.jobId);
  const started = Date.now();
  const onProgress = (step: string, status: StepStatus, note?: string) =>
    recordStep(job.jobId, step, status, note);

  try {
    const deps = {
      llm: llm(),
      research: research(),
      logger: logger.child({ kitId: kit._id.toString(), regen: type }),
    };

    let plan: RegenPlan;
    if (type === "regen_brief") {
      plan = await regenerateBrief(kit, deps, onProgress);
    } else if (type === "regen_category") {
      plan = await regenerateCategory(kit, (category ?? "technical") as QuestionCategory, deps, onProgress);
    } else {
      await onProgress("schedule", "running");
      plan = regenerateSchedule();
      await onProgress("schedule", "done", plan.note);
    }

    await commitRegeneration(kit._id, plan);
    await finishJob(job.jobId, "done");
    logger.info(
      { kitId: kit._id.toString(), type, ms: Date.now() - started, note: plan.note },
      "regeneration finished",
    );
  } catch (error) {
    const appError = toAppError(error);
    await finishJob(job.jobId, "failed", { code: appError.code, message: appError.message });
    logger.warn({ kitId: kit._id.toString(), type, code: appError.code }, "regeneration failed");
  }
}

// An edit landing between the read and the write only needs the merge re-run.
const COMMIT_ATTEMPTS = 5;

/**
 * Merges a finished regeneration into the kit as it is now, and writes only if
 * nothing else wrote in the meantime. The merge is cheap pure code, so on a
 * conflict it simply runs again against the newer kit.
 */
export async function commitRegeneration(kitId: mongoose.Types.ObjectId, plan: RegenPlan): Promise<void> {
  for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt += 1) {
    const current = await Kit.findById(kitId);
    if (!current) throw new AppError("NOT_FOUND", "The kit was deleted while it was being regenerated.");

    const { set } = plan.commit(current);
    const written = await Kit.updateOne(
      { _id: kitId, version: current.version },
      { $set: set, $inc: { version: 1 } },
    );
    if (written.matchedCount === 1) return;
  }
  throw new AppError("VERSION_CONFLICT", "The kit kept changing while it was being regenerated. Try again.");
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
