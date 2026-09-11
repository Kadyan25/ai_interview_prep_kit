import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The repo root holds the single .env. Both the server and the CLI read it.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
loadDotenv({ path: path.join(repoRoot, ".env"), quiet: true });
loadDotenv({ quiet: true });

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const intFromEnv = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : Number(v)))
    .pipe(z.number().int().positive());

/**
 * Vars the pipeline needs. The batch CLI validates only these — it never opens a
 * database and must run from a clean clone with nothing but LLM keys in .env.
 */
const coreSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    GEMINI_API_KEY: optionalString,
    GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
    GROQ_API_KEY: optionalString,
    GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
    TAVILY_API_KEY: optionalString,
    LLM_CONCURRENCY: intFromEnv(2),
    CRAWL_MAX_PAGES: intFromEnv(12),
    FETCH_TIMEOUT_MS: intFromEnv(10_000),
  ALLOW_PRIVATE_URLS: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

/** Extra vars only the HTTP server needs. */
const serverSchema = z.object({
  PORT: intFromEnv(4000),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required to run the API"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
});

export type CoreEnv = z.infer<typeof coreSchema>;
export type ServerEnv = CoreEnv & z.infer<typeof serverSchema>;

function fail(issues: z.ZodIssue[]): never {
  const lines = issues.map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`);
  // Startup failure: the process has no logger yet and must say why it died.
  process.stderr.write(`Invalid environment:\n${lines.join("\n")}\n`);
  process.exit(1);
}

let coreCache: CoreEnv | null = null;

export function coreEnv(): CoreEnv {
  if (coreCache) return coreCache;
  const parsed = coreSchema.safeParse(process.env);
  if (!parsed.success) fail(parsed.error.issues);
  coreCache = parsed.data;
  return coreCache;
}

let serverCache: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (serverCache) return serverCache;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) fail(parsed.error.issues);
  serverCache = { ...coreEnv(), ...parsed.data };
  return serverCache;
}

export const isProduction = (): boolean => coreEnv().NODE_ENV === "production";

export function hasLlmKey(): boolean {
  const env = coreEnv();
  return Boolean(env.GEMINI_API_KEY || env.GROQ_API_KEY);
}

/**
 * The API can serve sign-in and saved kits without a model key, so it only warns
 * at boot. Anything that is about to call a model demands one here, and the
 * batch CLI checks it before it reads a single case.
 */
export function requireLlmKey(): void {
  if (hasLlmKey()) return;
  throw new Error(
    "No model key configured. Set GEMINI_API_KEY or GROQ_API_KEY in .env before generating a kit.",
  );
}

/** Test helper: forget memoised values after mutating process.env. */
export function resetEnvCache(): void {
  coreCache = null;
  serverCache = null;
}
