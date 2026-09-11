import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { OpsError } from "@prep/shared";
import { AppError, isAppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "No such endpoint." } });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let appError: AppError;

  if (isAppError(err)) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = new AppError(
      "INVALID_INPUT",
      "Some fields need fixing.",
      err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  } else if (err instanceof OpsError) {
    // A rejected edit batch is the user's input being wrong, not a server fault.
    appError = new AppError("INVALID_INPUT", err.message, err.details);
  } else if (err instanceof SyntaxError && "body" in err) {
    appError = new AppError("INVALID_INPUT", "Request body is not valid JSON.");
  } else {
    appError = new AppError("INTERNAL", "Something went wrong on our side.");
    logger.error({ err, path: req.path }, "unhandled error");
  }

  if (appError.status >= 500 && !isAppError(err)) {
    // already logged above
  } else if (appError.status >= 500) {
    logger.error({ err, path: req.path }, appError.code);
  } else {
    logger.debug({ code: appError.code, path: req.path }, appError.message);
  }

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
    },
  });
}
