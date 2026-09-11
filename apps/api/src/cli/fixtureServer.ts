import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SITES_ROOT = path.resolve(here, "../../tests/fixtures/sites");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/**
 * Serves the fixture company sites over real HTTP. The crawler is then exercised
 * exactly as it runs in production — redirects, content types, robots.txt and
 * relative links included — with no network access.
 */
export function createFixtureServer(root = SITES_ROOT): http.Server {
  return http.createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      let relative = decodeURIComponent(requestUrl.pathname);

      // Directory requests serve index.html, matching a normal static host.
      if (relative.endsWith("/")) relative += "index.html";

      const target = path.resolve(root, `.${relative}`);
      if (!target.startsWith(root)) {
        response.writeHead(403).end("forbidden");
        return;
      }

      try {
        const info = await stat(target);
        if (info.isDirectory()) {
          response.writeHead(301, { Location: `${requestUrl.pathname}/` }).end();
          return;
        }
        const body = await readFile(target);
        const type = TYPES[path.extname(target)] ?? "application/octet-stream";
        response.writeHead(200, { "Content-Type": type, "Content-Length": body.byteLength });
        response.end(body);
      } catch {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
      }
    })();
  });
}

export function listenOn(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    });
  });
}
