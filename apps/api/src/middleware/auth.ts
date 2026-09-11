import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.js";
import { TOKEN_COOKIE, verifyToken, type SessionUser } from "../services/auth.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

/**
 * The cookie is the only source of identity. No route may take a user id from a
 * param or a body.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[TOKEN_COOKIE];
  if (!token || typeof token !== "string") {
    next(new AppError("UNAUTHORIZED", "Sign in to continue."));
    return;
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch (e) {
    next(e);
  }
}

export function currentUserId(req: Request): string {
  if (!req.user) throw new AppError("UNAUTHORIZED", "Sign in to continue.");
  return req.user.id;
}

/** Express types a route param as possibly absent; a missing one is a 404. */
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError("NOT_FOUND", "That resource does not exist.");
  }
  return value;
}
