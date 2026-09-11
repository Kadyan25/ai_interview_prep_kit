import rateLimit from "express-rate-limit";

const message = {
  error: { code: "RATE_LIMITED", message: "Too many requests. Wait a minute and try again." },
};

export const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message,
});

export const createKitLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message,
});
