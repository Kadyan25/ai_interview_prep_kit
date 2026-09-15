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

export async function connectDb(): Promise<void> {
  const { MONGODB_URI } = serverEnv();
  mongoose.set("strictQuery", true);
  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    dbName: dbNameFrom(MONGODB_URI),
  });
  logger.info({ db: mongoose.connection.name }, "mongo connected");
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export function dbReady(): boolean {
  return mongoose.connection.readyState === 1;
}
