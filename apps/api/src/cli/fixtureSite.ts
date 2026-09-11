import { createFixtureServer, listenOn } from "./fixtureServer.js";

const PORT = Number(process.env.FIXTURE_PORT ?? 8099);

const server = createFixtureServer();

listenOn(server, PORT)
  .then((port) => {
    process.stderr.write(
      [
        `Fixture sites on http://localhost:${port}`,
        `  http://localhost:${port}/acme/      company with a buried hiring page`,
        `  http://localhost:${port}/nohire/    company that publishes nothing about hiring`,
        "",
        "Point a kit at one of those URLs to exercise the crawler without touching the internet.",
        "",
      ].join("\n"),
    );
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `Could not start the fixture server: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
