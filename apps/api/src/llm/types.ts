import type { TypeOf, ZodTypeAny } from "zod";

export type ProviderName = "gemini" | "groq";

export type CompletionRequest = {
  system: string;
  user: string;
  maxOutputTokens?: number;
};

export interface LlmProvider {
  readonly name: ProviderName;
  complete(request: CompletionRequest): Promise<string>;
}

/** Transport failure with enough detail for the retry policy to act on. */
export class LlmHttpError extends Error {
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;
  readonly provider: ProviderName;

  constructor(
    provider: ProviderName,
    message: string,
    status?: number,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LlmHttpError";
    this.provider = provider;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }

  get isRateLimit(): boolean {
    return this.status === 429;
  }

  get isRetryable(): boolean {
    if (this.status === undefined) return true; // network-level failure
    return this.status === 429 || this.status >= 500;
  }
}

export type GenerateJsonRequest<S extends ZodTypeAny> = {
  /** Short label used in logs and progress notes, e.g. "extractRequirements". */
  task: string;
  system: string;
  user: string;
  schema: S;
  maxOutputTokens?: number;
};

export interface LlmClient {
  generateJson<S extends ZodTypeAny>(request: GenerateJsonRequest<S>): Promise<TypeOf<S>>;
  /** Providers configured, in priority order. Used by /health and the README. */
  providers(): ProviderName[];
}
