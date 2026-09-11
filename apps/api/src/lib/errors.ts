import { statusForCode, type ErrorCode } from "@prep/shared";

/** Every expected failure in the app is one of these. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = statusForCode(code);
    this.details = details;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new AppError("INTERNAL", message);
}
