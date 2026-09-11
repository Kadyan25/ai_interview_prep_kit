import { coreEnv, requireLlmKey } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { createLlmClient } from "./client.js";
import { createGeminiProvider } from "./providers/gemini.js";
import { createGroqProvider } from "./providers/groq.js";
import type { LlmClient, LlmProvider } from "./types.js";

/**
 * Gemini first, Groq as the fallback. If only one key is present that provider
 * is used alone and the failover path simply never triggers.
 */
export function createLlmFromEnv(): LlmClient {
  requireLlmKey();
  const env = coreEnv();
  const providers: LlmProvider[] = [];

  if (env.GEMINI_API_KEY) {
    providers.push(createGeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL));
  }
  if (env.GROQ_API_KEY) {
    providers.push(createGroqProvider(env.GROQ_API_KEY, env.GROQ_MODEL));
  }

  return createLlmClient(providers, {
    concurrency: env.LLM_CONCURRENCY,
    onRetry: ({ provider, attempt, waitMs, reason }) =>
      logger.warn({ provider, attempt, waitMs, reason }, "llm retry"),
  });
}
