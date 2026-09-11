import Groq from "groq-sdk";
import { LlmHttpError, type CompletionRequest, type LlmProvider } from "../types.js";

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as { status?: unknown };
  return typeof e.status === "number" ? e.status : undefined;
}

function retryAfterMsOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const headers = (error as { headers?: Record<string, string> }).headers;
  const value = headers?.["retry-after"];
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : undefined;
}

export function createGroqProvider(apiKey: string, model: string): LlmProvider {
  const client = new Groq({ apiKey });

  return {
    name: "groq",
    async complete({ system, user, maxOutputTokens }: CompletionRequest): Promise<string> {
      try {
        const response = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          temperature: 0.4,
          ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
        });
        const text = response.choices[0]?.message?.content;
        if (!text) {
          throw new LlmHttpError("groq", "Groq returned an empty response.", 502);
        }
        return text;
      } catch (error) {
        if (error instanceof LlmHttpError) throw error;
        throw new LlmHttpError(
          "groq",
          error instanceof Error ? error.message : String(error),
          statusOf(error),
          retryAfterMsOf(error),
        );
      }
    },
  };
}
