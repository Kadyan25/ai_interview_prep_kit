import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { coreEnv, requireLlmKey } from "../config/env.js";
import { AppError, toAppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { createLlmFromEnv } from "../llm/factory.js";
import type { PipelineDeps } from "../pipeline/types.js";
import { createResearchDeps } from "../retrieval/index.js";
import { parseArgs } from "./args.js";
import { runBatch } from "./runBatch.js";

const caseSchema = z.object({
  id: z.string().min(1),
  jd: z.string(),
  company_url: z.string().default(""),
  days: z.number().int().min(1).max(60),
});

// Accept a bare array or an object with a cases key; both turn up in the wild.
const inputSchema = z.union([
  z.array(caseSchema),
  z.object({ cases: z.array(caseSchema) }).transform((v) => v.cases),
]);

const USAGE = `Usage: npm run evaluate -- --input <cases.json> --output <kits.json>

Reads a JSON file of cases and writes one kit per case. A case that fails is
reported as failed in the output; the run always continues and always exits 0.`;

function stderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * `npm run evaluate` runs this file with the workspace as the working directory,
 * so a relative path typed at the repo root would otherwise resolve to the wrong
 * place. npm records where the user actually stood in INIT_CWD.
 */
function resolveFromInvocation(target: string): string {
  if (path.isAbsolute(target)) return target;
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), target);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.input || !args.output) {
    stderr(USAGE);
    process.exit(args.help ? 0 : 2);
  }

  try {
    requireLlmKey();
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  const inputPath = resolveFromInvocation(args.input);
  const outputPath = resolveFromInvocation(args.output);

  let cases: z.infer<typeof caseSchema>[];
  try {
    const raw = await readFile(inputPath, "utf8");
    cases = inputSchema.parse(JSON.parse(raw));
  } catch (error) {
    stderr(`Could not read cases from ${inputPath}: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }

  const env = coreEnv();
  const llm = createLlmFromEnv();
  stderr(
    `Running ${cases.length} case${cases.length === 1 ? "" : "s"} with ${llm
      .providers()
      .join(" then ")} (model ${env.GEMINI_MODEL}).`,
  );

  const deps: PipelineDeps = {
    llm,
    logger: logger.child({ runner: "cli" }),
    research: createResearchDeps(),
  };

  const startedAll = Date.now();

  const payload = await runBatch(cases, deps, (event) => {
    stderr(
      `[${event.index + 1}/${event.total}] ${event.id} ${event.status} in ${formatDuration(
        event.durationMs,
      )} — ${event.detail}`,
    );
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const ok = payload.kits.filter((r) => r.status === "ok").length;
  stderr(
    `\nWrote ${outputPath}: ${ok} ok, ${payload.kits.length - ok} failed, total ${formatDuration(
      Date.now() - startedAll,
    )}.`,
  );
}

main().catch((error) => {
  const appError = error instanceof AppError ? error : toAppError(error);
  stderr(`The run could not start: ${appError.code}: ${appError.message}`);
  process.exit(1);
});
