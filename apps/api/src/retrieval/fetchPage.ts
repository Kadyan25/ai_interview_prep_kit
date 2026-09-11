import { guardUrl, type GuardOptions } from "./urlGuard.js";

export const USER_AGENT = "PrepKitBot/1.0 (+assessment)";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const RETRYABLE_ATTEMPTS = 3;
const ALLOWED_TYPES = ["text/html", "text/plain", "application/xhtml+xml"];

export type FetchOk = {
  ok: true;
  url: string;
  status: number;
  contentType: string;
  html: string;
};

export type FetchFail = { ok: false; url: string; reason: string };
export type FetchResult = FetchOk | FetchFail;

export type FetchOptions = {
  timeoutMs: number;
  guard: GuardOptions;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Reads at most MAX_BYTES so a huge or endless body cannot exhaust memory. */
async function readCapped(response: Response): Promise<string | null> {
  const body = response.body;
  if (!body) return await response.text();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/**
 * Fetches one page and never throws. Every failure comes back as a reason the
 * pipeline can record and continue past — an unreachable company site is a
 * normal outcome, not an error.
 */
export async function fetchPage(rawUrl: string, options: FetchOptions): Promise<FetchResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  let currentUrl = rawUrl;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    // Re-checked on every hop: a public URL can redirect to a private one.
    const guarded = await guardUrl(currentUrl, options.guard);
    if (!guarded.ok) return { ok: false, url: currentUrl, reason: guarded.reason };

    let lastReason = "request failed";
    let response: Response | null = null;

    for (let attempt = 0; attempt < RETRYABLE_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        response = await doFetch(guarded.url.toString(), {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
            "Accept-Language": "en",
          },
        });
      } catch (error) {
        lastReason =
          error instanceof Error && error.name === "AbortError"
            ? `timed out after ${options.timeoutMs}ms`
            : `network error: ${error instanceof Error ? error.message : String(error)}`;
        response = null;
      } finally {
        clearTimeout(timer);
      }

      if (response && response.status >= 500) {
        lastReason = `server returned ${response.status}`;
        response = null;
      }

      if (response) break;
      if (attempt < RETRYABLE_ATTEMPTS - 1) await sleep(500 * 2 ** attempt);
    }

    if (!response) return { ok: false, url: currentUrl, reason: lastReason };

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, url: currentUrl, reason: "redirect without a location" };
      currentUrl = new URL(location, guarded.url).toString();
      continue;
    }

    if (response.status >= 400) {
      return { ok: false, url: currentUrl, reason: `server returned ${response.status}` };
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!ALLOWED_TYPES.some((type) => contentType.includes(type))) {
      return {
        ok: false,
        url: currentUrl,
        reason: `unsupported content type ${contentType || "unknown"}`,
      };
    }

    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_BYTES) {
      return { ok: false, url: currentUrl, reason: "page is larger than 2MB" };
    }

    const html = await readCapped(response).catch(() => null);
    if (html === null) return { ok: false, url: currentUrl, reason: "page is larger than 2MB" };

    return {
      ok: true,
      url: guarded.url.toString(),
      status: response.status,
      contentType,
      html,
    };
  }

  return { ok: false, url: currentUrl, reason: "too many redirects" };
}
