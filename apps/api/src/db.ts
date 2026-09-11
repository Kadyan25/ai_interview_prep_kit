import mongoose from "mongoose";
import { serverEnv } from "./config/env.js";
import { logger } from "./lib/logger.js";

export async function connectDb(): Promise<void> {
  const { MONGODB_URI } = serverEnv();
  mongoose.set("strictQuery", true);
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  logger.info({ db: mongoose.connection.name }, "mongo connected");
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export function dbReady(): boolean {
  return mongoose.connection.readyState === 1;
}
