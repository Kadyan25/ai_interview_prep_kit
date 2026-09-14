import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listenOn } from "../../src/cli/fixtureServer.js";
import { fetchPage, type FetchOptions } from "../../src/retrieval/fetchPage.js";
import { RobotsCache } from "../../src/retrieval/robots.js";

/**
 * Servers that misbehave on purpose. Each route reproduces something a real
 * site did, or could do, to a crawler.
 */

let server: http.Server;
let base: string;
const sockets = new Set<import("node:net").Socket>();

function handle(request: http.IncomingMessage, response: http.ServerResponse): void {
  const url = request.url ?? "/";
  if (url === "/drip") {
    // Headers at once, then a byte a second for ever.
    response.writeHead(200, { "Content-Type": "text/html" });
    response.flushHeaders();
    response.write("<p>");
    const timer = setInterval(() => response.write("a"), 1000);
    response.on("close", () => clearInterval(timer));
    return;
  }
  if (url === "/json-pretending") {
    response.writeHead(200, { "Content-Type": "application/json; profile=text/html" });
    response.end('{"a":1}');
    return;
  }
  response.writeHead(404).end();
}

const options = (overrides: Partial<FetchOptions> = {}): FetchOptions => ({
  timeoutMs: 800,
  guard: { allowPrivate: true },
  sleep: async () => undefined,
  ...overrides,
});

beforeAll(async () => {
  server = http.createServer(handle);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const port = await listenOn(server, 0);
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("fetchPage against hostile servers", () => {
  it("gives up on a body that drips in slower than the timeout", async () => {
    const started = Date.now();
    const result = await fetchPage(`${base}/drip`, options());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/did not finish/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("judges content type by the media type, not a substring", async () => {
    const result = await fetchPage(`${base}/json-pretending`, options());
    expect(result.ok).toBe(false);
  });
});

describe("RobotsCache against hostile servers", () => {
  it("treats a robots.txt server error as disallowing everything", async () => {
    const failing = (async (input: string | URL | Request) => {
      const target = String(input);
      if (target.endsWith("/robots.txt")) return new Response("down", { status: 503 });
      return new Response("<p>hi</p>", { status: 200, headers: { "Content-Type": "text/html" } });
    }) as typeof fetch;
    const robots = new RobotsCache(options({ fetchImpl: failing }));
    expect(await robots.isAllowed(`${base}/careers`)).toBe(false);
  });

  it("reads a disallow-all robots.txt even when it is not labelled text", async () => {
    const octet = (async () =>
      new Response("User-agent: *\nDisallow: /\n", {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      })) as typeof fetch;
    const robots = new RobotsCache(options({ fetchImpl: octet }));
    expect(await robots.isAllowed(`${base}/careers`)).toBe(false);
  });

  it("still allows the crawl when robots.txt is simply missing", async () => {
    const missing = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    const robots = new RobotsCache(options({ fetchImpl: missing }));
    expect(await robots.isAllowed(`${base}/careers`)).toBe(true);
  });
});
