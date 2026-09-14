import { coreEnv, requireLlmKey } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { createLlmClient } from "./client.js";
import { createGeminiProvider } from "./providers/gemini.js";
import { createGroqProvider } from "./providers/groq.js";
import type { LlmClient, LlmProvider } from "./types.js";

/**
 * Two providers, tried in order, with the first one set by LLM_PRIMARY.
 *
 * Groq leads by default for a practical reason: a five-case batch costs roughly
 * fifty model calls, and Google's free tier allows twenty generate-content
 * requests per day on a flash model. Groq's free tier carries the batch and
 * answers in about a third of the time. Gemini stays as the fallback, so the run
 * survives either provider being unavailable. If only one key is configured that
 * provider is used alone and the failover path never triggers.
 */
export function createLlmFromEnv(): LlmClient {
  requireLlmKey();
  const env = coreEnv();

  const gemini = env.GEMINI_API_KEY
    ? createGeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL, env.LLM_TIMEOUT_MS)
    : null;
  const groq = env.GROQ_API_KEY
    ? createGroqProvider(env.GROQ_API_KEY, env.GROQ_MODEL, env.LLM_TIMEOUT_MS)
    : null;

  const ordered = env.LLM_PRIMARY === "gemini" ? [gemini, groq] : [groq, gemini];
  const providers = ordered.filter((p): p is LlmProvider => p !== null);

  logger.debug({ providers: providers.map((p) => p.name) }, "llm providers");

  return createLlmClient(providers, {
    concurrency: env.LLM_CONCURRENCY,
    onRetry: ({ provider, attempt, waitMs, reason }) =>
      logger.warn({ provider, attempt, waitMs, reason }, "llm retry"),
  });
}
