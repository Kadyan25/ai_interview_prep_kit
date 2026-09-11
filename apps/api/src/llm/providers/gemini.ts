import { GoogleGenAI } from "@google/genai";
import { LlmHttpError, type CompletionRequest, type LlmProvider } from "../types.js";

/** Reads a numeric HTTP status off whatever shape the SDK threw. */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof e.status === "number") return e.status;
  if (typeof e.code === "number") return e.code;
  const message = typeof e.message === "string" ? e.message : "";
  const match = message.match(/\b(4\d\d|5\d\d)\b/);
  return match ? Number(match[1]) : undefined;
}

function retryAfterMsOf(error: unknown): number | undefined {
  const message =
    typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
  // Gemini puts the hint in the error body: "retryDelay":"27s"
  const match = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return match ? Math.ceil(Number(match[1]) * 1000) : undefined;
}

export function createGeminiProvider(apiKey: string, model: string): LlmProvider {
  const client = new GoogleGenAI({ apiKey });

  return {
    name: "gemini",
    async complete({ system, user, maxOutputTokens }: CompletionRequest): Promise<string> {
      try {
        const response = await client.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: user }] }],
          config: {
            systemInstruction: system,
            responseMimeType: "application/json",
            temperature: 0.4,
            ...(maxOutputTokens ? { maxOutputTokens } : {}),
          },
        });
        const text = response.text;
        if (!text) {
          throw new LlmHttpError("gemini", "Gemini returned an empty response.", 502);
        }
        return text;
      } catch (error) {
        if (error instanceof LlmHttpError) throw error;
        throw new LlmHttpError(
          "gemini",
          error instanceof Error ? error.message : String(error),
          statusOf(error),
          retryAfterMsOf(error),
        );
      }
    },
  };
}
