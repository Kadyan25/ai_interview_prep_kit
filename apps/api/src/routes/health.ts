import { Router } from "express";
import { coreEnv } from "../config/env.js";
import { dbReady } from "../db.js";

export const healthRouter: Router = Router();

healthRouter.get("/", (_req, res) => {
  const env = coreEnv();
  // In the order they will actually be tried, so a deployment can be checked
  // against what LLM_PRIMARY was meant to do rather than which keys exist.
  const configured = [
    ...(env.GROQ_API_KEY ? ["groq"] : []),
    ...(env.GEMINI_API_KEY ? ["gemini"] : []),
  ];
  const llm = env.LLM_PRIMARY === "gemini" ? [...configured].reverse() : configured;
  res.json({ ok: true, db: dbReady(), llm });
});
