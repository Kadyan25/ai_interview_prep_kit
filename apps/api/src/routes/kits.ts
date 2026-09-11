import { Router } from "express";
import { currentUserId, requireAuth } from "../middleware/auth.js";
import { deleteKit, getKit, listKits } from "../services/kits.js";

export const kitsRouter: Router = Router();

kitsRouter.use(requireAuth);

kitsRouter.get("/", async (req, res) => {
  res.json({ kits: await listKits(currentUserId(req)) });
});

kitsRouter.get("/:id", async (req, res) => {
  res.json({ kit: await getKit(currentUserId(req), req.params.id) });
});

kitsRouter.delete("/:id", async (req, res) => {
  await deleteKit(currentUserId(req), req.params.id);
  res.json({ ok: true });
});
