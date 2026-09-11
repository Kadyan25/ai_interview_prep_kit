import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { AppError } from "../lib/errors.js";
import { serverEnv } from "../config/env.js";

const BCRYPT_COST = 12;
const TOKEN_TTL = "7d";
export const TOKEN_COOKIE = "prep_token";
export const TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionUser = { id: string; email: string };

function signToken(user: SessionUser): string {
  return jwt.sign({ sub: user.id, email: user.email }, serverEnv().JWT_SECRET, {
    expiresIn: TOKEN_TTL,
    algorithm: "HS256",
  });
}

export function verifyToken(token: string): SessionUser {
  try {
    const payload = jwt.verify(token, serverEnv().JWT_SECRET, { algorithms: ["HS256"] });
    if (typeof payload === "string" || !payload.sub) {
      throw new Error("malformed token payload");
    }
    return { id: String(payload.sub), email: String((payload as { email?: string }).email ?? "") };
  } catch {
    throw new AppError("UNAUTHORIZED", "Your session has expired. Sign in again.");
  }
}

export async function register(
  email: string,
  password: string,
): Promise<{ user: SessionUser; token: string }> {
  const normalised = email.trim().toLowerCase();
  const existing = await User.findOne({ email: normalised }).lean();
  if (existing) {
    throw new AppError("INVALID_INPUT", "An account with that email already exists.");
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const created = await User.create({ email: normalised, passwordHash });
  const user: SessionUser = { id: created._id.toString(), email: normalised };
  return { user, token: signToken(user) };
}

export async function login(
  email: string,
  password: string,
): Promise<{ user: SessionUser; token: string }> {
  const normalised = email.trim().toLowerCase();
  const found = await User.findOne({ email: normalised });
  // Same message either way so the endpoint does not confirm which emails exist.
  const invalid = new AppError("UNAUTHORIZED", "Email or password is incorrect.");
  if (!found) {
    await bcrypt.compare(password, "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
    throw invalid;
  }
  const ok = await bcrypt.compare(password, found.passwordHash);
  if (!ok) throw invalid;
  const user: SessionUser = { id: found._id.toString(), email: found.email };
  return { user, token: signToken(user) };
}

export async function findUser(id: string): Promise<SessionUser> {
  const found = await User.findById(id).lean();
  if (!found) throw new AppError("UNAUTHORIZED", "Your session is no longer valid.");
  return { id: found._id.toString(), email: found.email };
}
