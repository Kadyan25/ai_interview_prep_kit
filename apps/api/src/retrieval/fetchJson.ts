import { USER_AGENT } from "./fetchPage.js";

/**
 * For the two fixed JSON APIs this app talks to (Hacker News search and Tavily).
 * `fetchPage` deliberately refuses anything that is not HTML and re-checks every
 * redirect against the SSRF guard, which is right for crawling a URL a user
 * supplied and wrong for a constant endpoint that returns JSON.
 */
export async function fetchJson<T>(
  url: string,
  options: { timeoutMs: number; method?: "GET" | "POST"; body?: unknown; fetchImpl?: typeof fetch },
): Promise<T | null> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await doFetch(url, {
      method: options.method ?? "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
