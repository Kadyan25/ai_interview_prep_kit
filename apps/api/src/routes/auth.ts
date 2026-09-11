import { Router, type CookieOptions } from "express";
import { z } from "zod";
import { isProduction } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { loginLimiter } from "../middleware/rateLimit.js";
import {
  TOKEN_COOKIE,
  TOKEN_MAX_AGE_MS,
  findUser,
  login,
  register,
} from "../services/auth.js";

const credentials = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    maxAge: TOKEN_MAX_AGE_MS,
    path: "/",
  };
}

export const authRouter: Router = Router();

authRouter.post("/register", async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const { user, token } = await register(email, password);
  res.cookie(TOKEN_COOKIE, token, cookieOptions());
  res.status(201).json({ user });
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const { user, token } = await login(email, password);
  res.cookie(TOKEN_COOKIE, token, cookieOptions());
  res.json({ user });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(TOKEN_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await findUser(req.user!.id);
  res.json({ user });
});
