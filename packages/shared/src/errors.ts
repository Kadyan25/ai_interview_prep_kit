/**
 * Error codes shared by the API, the batch CLI and the web client.
 * The CLI writes these verbatim into the Appendix B `error.code` field, so the
 * strings are part of the output contract — rename nothing here casually.
 */
export const ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  SECTION_LOCKED: 409,
  DUPLICATE_KIT: 409,
  RATE_LIMITED: 429,
  COMPANY_UNREACHABLE: 502,
  TIMEOUT: 504,
  LLM_UNAVAILABLE: 503,
  LLM_INVALID_OUTPUT: 502,
  KIT_INVALID: 500,
  INTERRUPTED: 500,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export function statusForCode(code: ErrorCode): number {
  return ERROR_STATUS[code] ?? 500;
}

export type ApiErrorBody = {
  error: { code: ErrorCode | string; message: string; details?: unknown };
};
