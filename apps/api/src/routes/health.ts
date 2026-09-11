import { Router } from "express";
import { coreEnv } from "../config/env.js";
import { dbReady } from "../db.js";

export const healthRouter: Router = Router();

healthRouter.get("/", (_req, res) => {
  const env = coreEnv();
  const llm: string[] = [];
  if (env.GEMINI_API_KEY) llm.push("gemini");
  if (env.GROQ_API_KEY) llm.push("groq");
  res.json({ ok: true, db: dbReady(), llm });
});
