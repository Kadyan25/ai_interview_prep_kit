import pino from "pino";
import { coreEnv } from "../config/env.js";

const env = coreEnv();

/**
 * Pretty output while developing, JSON in production (Render ships it to logs).
 * The CLI writes its own progress to stderr, so it runs the logger at warn.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : {}),
});

export type Logger = pino.Logger;
