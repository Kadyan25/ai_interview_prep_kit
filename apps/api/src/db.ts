import mongoose from "mongoose";
import { serverEnv } from "./config/env.js";
import { logger } from "./lib/logger.js";

/**
 * Atlas hands out connection strings with no database in them, and a driver
 * given one silently uses "test". Naming it here means a copied-and-pasted
 * string still puts the kits where the README says they are.
 */
export const DEFAULT_DB_NAME = "prepkit";

export function dbNameFrom(uri: string): string {
  try {
    const path = new URL(uri).pathname.replace(/^\//, "");
    return path.length > 0 ? decodeURIComponent(path) : DEFAULT_DB_NAME;
  } catch {
    return DEFAULT_DB_NAME;
  }
}

const CONNECT_ATTEMPTS = 4;
const RETRY_DELAY_MS = 3_000;

/**
 * Retried, because a free-tier database is not always awake when its service is.
 * Atlas pauses idle clusters and takes a moment to accept connections after a
 * network rule changes; giving up on the first refusal turns that into an outage
 * that only a redeploy clears.
 */
export async function connectDb(): Promise<void> {
  const { MONGODB_URI } = serverEnv();
  mongoose.set("strictQuery", true);

  for (let attempt = 1; ; attempt += 1) {
    try {
      await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 10_000,
        dbName: dbNameFrom(MONGODB_URI),
      });
      logger.info({ db: mongoose.connection.name, attempt }, "mongo connected");
      return;
    } catch (error) {
      if (attempt >= CONNECT_ATTEMPTS) throw error;
      logger.warn(
        { attempt, of: CONNECT_ATTEMPTS, err: error instanceof Error ? error.message : String(error) },
        "mongo not reachable, retrying",
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export function dbReady(): boolean {
  return mongoose.connection.readyState === 1;
}
