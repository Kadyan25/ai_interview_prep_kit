import pLimit from "p-limit";
import type { TypeOf, ZodTypeAny } from "zod";
import { AppError } from "../lib/errors.js";
import { parseJsonLoose } from "./jsonRepair.js";
import {
  LlmHttpError,
  type GenerateJsonRequest,
  type LlmClient,
  type LlmProvider,
  type ProviderName,
} from "./types.js";

export type LlmClientOptions = {
  concurrency?: number;
  /** Minimum spacing between call starts. Free tiers count requests per minute. */
  minGapMs?: number;
  maxAttempts?: number;
  /** Consecutive rate-limit hits on the primary before falling back. */
  failoverThreshold?: number;
  failoverWindowMs?: number;
  failoverCooldownMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onRetry?: (info: { provider: ProviderName; attempt: number; waitMs: number; reason: string }) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One entry point for every model call in the app: limits concurrency, spaces
 * requests, retries transient failures, falls back to the second provider when
 * the first is rate-limited, and guarantees the caller a schema-valid object.
 */
export function createLlmClient(
  providers: LlmProvider[],
  options: LlmClientOptions = {},
): LlmClient {
  if (providers.length === 0) {
    throw new AppError("LLM_UNAVAILABLE", "No model provider is configured.");
  }

  const {
    concurrency = 2,
    minGapMs = 1500,
    maxAttempts = 5,
    failoverThreshold = 3,
    failoverWindowMs = 60_000,
    failoverCooldownMs = 120_000,
    sleep = defaultSleep,
    now = Date.now,
    onRetry,
  } = options;

  const limit = pLimit(concurrency);
  const primary = providers[0]!;
  const fallback = providers[1];

  let gate: Promise<void> = Promise.resolve();
  let lastStart = 0;

  // Failover bookkeeping for the primary provider.
  let consecutiveRateLimits = 0;
  let firstRateLimitAt = 0;
  let primaryPausedUntil = 0;

  async function spaceOut(): Promise<void> {
    const previous = gate;
    let release!: () => void;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const wait = lastStart + minGapMs - now();
    if (wait > 0) await sleep(wait);
    lastStart = now();
    release();
  }

  function pickProvider(): LlmProvider {
    if (fallback && primaryPausedUntil > now()) return fallback;
    return primary;
  }

  function noteRateLimit(provider: LlmProvider): void {
    if (provider.name !== primary.name || !fallback) return;
    const timestamp = now();
    if (consecutiveRateLimits === 0 || timestamp - firstRateLimitAt > failoverWindowMs) {
      consecutiveRateLimits = 1;
      firstRateLimitAt = timestamp;
    } else {
      consecutiveRateLimits += 1;
    }
    if (consecutiveRateLimits >= failoverThreshold) {
      primaryPausedUntil = timestamp + failoverCooldownMs;
      consecutiveRateLimits = 0;
    }
  }

  function noteSuccess(provider: LlmProvider): void {
    if (provider.name === primary.name) consecutiveRateLimits = 0;
  }

  function backoffMs(attempt: number, error: LlmHttpError): number {
    if (error.retryAfterMs !== undefined) return Math.min(error.retryAfterMs, 30_000);
    const jitter = Math.floor(Math.random() * 500);
    return Math.min(2000 * 2 ** attempt + jitter, 30_000);
  }

  async function callOnce(system: string, user: string, maxOutputTokens?: number): Promise<string> {
    let lastError: LlmHttpError | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const provider = pickProvider();
      await spaceOut();
      try {
        const text = await provider.complete({ system, user, maxOutputTokens });
        noteSuccess(provider);
        return text;
      } catch (error) {
        const httpError =
          error instanceof LlmHttpError
            ? error
            : new LlmHttpError(provider.name, error instanceof Error ? error.message : String(error));
        lastError = httpError;

        if (httpError.isRateLimit) noteRateLimit(provider);
        if (!httpError.isRetryable || attempt === maxAttempts - 1) break;

        const waitMs = backoffMs(attempt, httpError);
        onRetry?.({
          provider: provider.name,
          attempt: attempt + 1,
          waitMs,
          reason: httpError.message,
        });
        await sleep(waitMs);
      }
    }

    throw new AppError(
      "LLM_UNAVAILABLE",
      `The model could not be reached: ${lastError?.message ?? "unknown error"}`,
    );
  }

  async function generateJson<S extends ZodTypeAny>(
    request: GenerateJsonRequest<S>,
  ): Promise<TypeOf<S>> {
    return limit(async () => {
      const { system, user, schema, maxOutputTokens, task } = request;

      const first = await callOnce(system, user, maxOutputTokens);
      const firstResult = coerce(first, schema);
      if (firstResult.ok) return firstResult.value;

      // One corrective re-ask with the exact validation failures attached.
      const retryUser = [
        user,
        "",
        "Your previous reply could not be used. Fix these problems and reply with JSON only:",
        firstResult.problems.map((p) => `- ${p}`).join("\n"),
      ].join("\n");

      const second = await callOnce(system, retryUser, maxOutputTokens);
      const secondResult = coerce(second, schema);
      if (secondResult.ok) return secondResult.value;

      throw new AppError(
        "LLM_INVALID_OUTPUT",
        `The model's ${task} output did not match the expected shape: ${secondResult.problems
          .slice(0, 3)
          .join("; ")}`,
      );
    });
  }

  return {
    generateJson,
    providers: () => providers.map((p) => p.name),
  };
}

type Coerced<T> = { ok: true; value: T } | { ok: false; problems: string[] };

function coerce<S extends ZodTypeAny>(raw: string, schema: S): Coerced<TypeOf<S>> {
  const parsed = parseJsonLoose(raw);
  if (parsed === undefined) {
    return { ok: false, problems: ["the reply was not valid JSON"] };
  }
  const result = schema.safeParse(parsed);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    problems: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}
