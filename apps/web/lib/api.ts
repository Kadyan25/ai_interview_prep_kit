import type { JobDocument, KitDocument, KitInput, KitSummary, Op } from "@prep/shared";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Every browser request goes to our own origin; next.config rewrites /api/* to
 * the API service, which keeps the session cookie first-party.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: "include",
      headers:
        init.body !== undefined
          ? { "Content-Type": "application/json", ...(init.headers ?? {}) }
          : init.headers,
      ...init,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Could not reach the server. Check your connection.");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text ? safeJson(text) : null;

  if (!response.ok) {
    const body = payload as { error?: { code?: string; message?: string; details?: unknown } };
    throw new ApiError(
      response.status,
      body?.error?.code ?? "INTERNAL",
      body?.error?.message ?? "Something went wrong.",
      body?.error?.details,
    );
  }

  return payload as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export type SessionUser = { id: string; email: string };

export const api = {
  register: (email: string, password: string) =>
    apiFetch<{ user: SessionUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    apiFetch<{ user: SessionUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => apiFetch<{ ok: true }>("/auth/logout", { method: "POST" }),
  me: () => apiFetch<{ user: SessionUser }>("/auth/me"),
  listKits: () => apiFetch<{ kits: KitSummary[] }>("/kits"),
  getKit: (id: string) => apiFetch<{ kit: KitDocument }>(`/kits/${id}`),
  deleteKit: (id: string) => apiFetch<{ ok: true }>(`/kits/${id}`, { method: "DELETE" }),

  createKit: (input: KitInput & { force?: boolean }) =>
    apiFetch<CreateKitResponse>("/kits", { method: "POST", body: JSON.stringify(input) }),
  createKitBatch: (kits: KitInput[]) =>
    apiFetch<{ kits: CreateKitResponse[] }>("/kits/batch", {
      method: "POST",
      body: JSON.stringify({ kits }),
    }),
  getJob: (id: string) => apiFetch<{ job: JobDocument }>(`/kits/${id}/job`),
  retryKit: (id: string) => apiFetch<{ jobId: string }>(`/kits/${id}/retry`, { method: "POST" }),

  patchKit: (id: string, version: number, ops: Op[]) =>
    apiFetch<{ kit: KitDocument }>(`/kits/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ version, ops }),
    }),
  regenerate: (id: string, section: "brief" | "category" | "schedule", category?: string) =>
    apiFetch<{ jobId: string }>(`/kits/${id}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ section, ...(category ? { category } : {}) }),
    }),
};

export type CreateKitResponse = {
  kit: KitDocument;
  jobId: string | null;
  existing: boolean;
};
