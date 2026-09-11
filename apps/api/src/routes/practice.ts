import { Router } from "express";
import { z } from "zod";
import { currentUserId, pathParam, requireAuth } from "../middleware/auth.js";
import { getSession, getStats, recordAnswer } from "../services/practice.js";

const answerSchema = z.object({
  cardId: z.string().min(1),
  confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

// Mounted with mergeParams so :id comes from the kits router above it.
export const practiceRouter: Router = Router({ mergeParams: true });

practiceRouter.use(requireAuth);

practiceRouter.get("/session", async (req, res) => {
  const cards = await getSession(currentUserId(req), pathParam(req, "id"));
  res.json({ cards });
});

practiceRouter.post("/answers", async (req, res) => {
  const { cardId, confidence } = answerSchema.parse(req.body);
  await recordAnswer(currentUserId(req), pathParam(req, "id"), cardId, confidence);
  res.json({ ok: true });
});

practiceRouter.get("/stats", async (req, res) => {
  const stats = await getStats(currentUserId(req), pathParam(req, "id"));
  res.json({ stats });
});
