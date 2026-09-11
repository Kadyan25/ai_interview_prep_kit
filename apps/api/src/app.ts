import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { serverEnv } from "./config/env.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { kitsRouter } from "./routes/kits.js";
import { practiceRouter } from "./routes/practice.js";

export function createApp(): Express {
  const env = serverEnv();
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.WEB_ORIGIN.split(",").map((o) => o.trim()),
      credentials: true,
    }),
  );
  // A job description can be long; 1 MB is generous and still bounded.
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use("/health", healthRouter);
  app.use("/api/auth", authRouter);
  // Mounted ahead of the kits router so the nested paths are matched first.
  app.use("/api/kits/:id/practice", practiceRouter);
  app.use("/api/kits", kitsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
