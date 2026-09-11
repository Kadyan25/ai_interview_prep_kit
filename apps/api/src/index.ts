import { createApp } from "./app.js";
import { hasLlmKey, serverEnv } from "./config/env.js";
import { connectDb, disconnectDb } from "./db.js";
import { logger } from "./lib/logger.js";

async function main(): Promise<void> {
  const env = serverEnv();
  if (!hasLlmKey()) {
    logger.warn(
      "No GEMINI_API_KEY or GROQ_API_KEY set. Sign-in and saved kits work; generating a new kit will fail until one is added to .env.",
    );
  }
  await connectDb();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "api listening");
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(() => {
      void disconnectDb().finally(() => process.exit(0));
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "failed to start");
  process.exit(1);
});
