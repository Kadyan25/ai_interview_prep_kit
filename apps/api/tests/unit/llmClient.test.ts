import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLlmClient } from "../../src/llm/client.js";
import { LlmHttpError, type LlmProvider, type ProviderName } from "../../src/llm/types.js";
import { AppError } from "../../src/lib/errors.js";

const schema = z.object({ answer: z.string() });

/** A provider driven by a script of replies; each entry is a reply or an error. */
function scriptedProvider(name: ProviderName, script: Array<string | Error>) {
  const calls: string[] = [];
  const provider: LlmProvider = {
    name,
    async complete({ user }) {
      calls.push(user);
      const next = script.shift();
      if (next === undefined) throw new Error(`${name} called more times than scripted`);
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { provider, calls };
}

const rateLimited = (name: ProviderName) =>
  new LlmHttpError(name, "rate limited", 429);

const options = {
  minGapMs: 0,
  sleep: async () => undefined,
};

describe("llm client", () => {
  it("returns parsed JSON on the first try", async () => {
    const { provider } = scriptedProvider("gemini", ['{"answer":"yes"}']);
    const client = createLlmClient([provider], options);

    const result = await client.generateJson({
      task: "t",
      system: "s",
      user: "u",
      schema,
    });

    expect(result).toEqual({ answer: "yes" });
  });

  it("repairs a fenced reply with a trailing comma", async () => {
    const { provider } = scriptedProvider("gemini", [
      'Here you go:\n```json\n{"answer":"fixed",}\n```',
    ]);
    const client = createLlmClient([provider], options);

    await expect(
      client.generateJson({ task: "t", system: "s", user: "u", schema }),
    ).resolves.toEqual({ answer: "fixed" });
  });

  it("retries a 429 and succeeds", async () => {
    const waits: number[] = [];
    const { provider, calls } = scriptedProvider("gemini", [
      rateLimited("gemini"),
      '{"answer":"second"}',
    ]);
    const client = createLlmClient([provider], {
      minGapMs: 0,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    await expect(
      client.generateJson({ task: "t", system: "s", user: "u", schema }),
    ).resolves.toEqual({ answer: "second" });
    expect(calls).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(2000);
  });

  it("gives up after the attempt limit and reports the provider as unavailable", async () => {
    const { provider } = scriptedProvider("gemini", [
      rateLimited("gemini"),
      rateLimited("gemini"),
      rateLimited("gemini"),
    ]);
    const client = createLlmClient([provider], { ...options, maxAttempts: 3 });

    await expect(
      client.generateJson({ task: "t", system: "s", user: "u", schema }),
    ).rejects.toMatchObject({ code: "LLM_UNAVAILABLE" });
  });

  it("does not retry a non-retryable status", async () => {
    const { provider, calls } = scriptedProvider("gemini", [
      new LlmHttpError("gemini", "bad request", 400),
    ]);
    const client = createLlmClient([provider], options);

    await expect(
      client.generateJson({ task: "t", system: "s", user: "u", schema }),
    ).rejects.toBeInstanceOf(AppError);
    expect(calls).toHaveLength(1);
  });

  it("falls over to the second provider after three consecutive rate limits", async () => {
    const primary = scriptedProvider("gemini", [
      rateLimited("gemini"),
      rateLimited("gemini"),
      rateLimited("gemini"),
    ]);
    const secondary = scriptedProvider("groq", ['{"answer":"from groq"}']);

    const client = createLlmClient([primary.provider, secondary.provider], {
      ...options,
      maxAttempts: 5,
    });

    await expect(
      client.generateJson({ task: "t", system: "s", user: "u", schema }),
    ).resolves.toEqual({ answer: "from groq" });
    expect(primary.calls).toHaveLength(3);
    expect(secondary.calls).toHaveLength(1);
  });

  it("re-asks once with the validation problems attached", async () => {
    const { provider, calls } = scriptedProvider("gemini", [
      '{"wrong":"shape"}',
      '{"answer":"corrected"}',
    ]);
    const client = createLlmClient([provider], options);

    await expect(
      client.generateJson({ task: "t", system: "s", user: "u", schema }),
    ).resolves.toEqual({ answer: "corrected" });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("answer");
    expect(calls[1]).toContain("Fix these problems");
  });

  it("fails with LLM_INVALID_OUTPUT when the re-ask is also wrong", async () => {
    const { provider } = scriptedProvider("gemini", ["not json at all", "still not json"]);
    const client = createLlmClient([provider], options);

    await expect(
      client.generateJson({ task: "extractRequirements", system: "s", user: "u", schema }),
    ).rejects.toMatchObject({ code: "LLM_INVALID_OUTPUT" });
  });

  it("honours Retry-After instead of the exponential backoff", async () => {
    const waits: number[] = [];
    const { provider } = scriptedProvider("groq", [
      new LlmHttpError("groq", "slow down", 429, 7000),
      '{"answer":"ok"}',
    ]);
    const client = createLlmClient([provider], {
      minGapMs: 0,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    await client.generateJson({ task: "t", system: "s", user: "u", schema });
    expect(waits[0]).toBe(7000);
  });

  it("reports its configured providers in order", () => {
    const a = scriptedProvider("gemini", []);
    const b = scriptedProvider("groq", []);
    const client = createLlmClient([a.provider, b.provider], options);
    expect(client.providers()).toEqual(["gemini", "groq"]);
  });
});
