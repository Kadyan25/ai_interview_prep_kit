import type { LlmClient } from "../../src/llm/types.js";

export type StubHandler = (user: string) => unknown | Promise<unknown>;

/**
 * A model stand-in. Tests map a task name to the JSON that task should return,
 * so the pipeline can be exercised end to end with no network and no API key.
 */
export function stubLlm(handlers: Record<string, StubHandler | unknown>): {
  llm: LlmClient;
  calls: { task: string; user: string }[];
} {
  const calls: { task: string; user: string }[] = [];

  const llm: LlmClient = {
    providers: () => ["gemini"],
    async generateJson({ task, user, schema }) {
      calls.push({ task, user });
      const handler = handlers[task];
      if (handler === undefined) {
        throw new Error(`stub llm has no handler for task "${task}"`);
      }
      // Awaited, so a handler can return a promise and stand in for a slow or
      // never-answering provider.
      const payload = typeof handler === "function" ? await (handler as StubHandler)(user) : handler;
      if (payload instanceof Error) throw payload;
      return schema.parse(payload);
    },
  };

  return { llm, calls };
}

/** Silent logger with the shape the pipeline expects. */
export const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => silentLogger,
} as unknown as import("../../src/lib/logger.js").Logger;
