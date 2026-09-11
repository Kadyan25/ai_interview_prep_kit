import { z } from "zod";
import { systemFor, untrusted } from "../prompts/system.js";
import type { FetchedPage, PipelineDeps } from "../types.js";

const schema = z.object({
  process: z.string().default(""),
  stages: z.array(z.string()).default([]),
});

const system = systemFor(
  `Summarise a company's published hiring process for a candidate.

Rules:
- Report only stages the page actually describes. No generic advice.
- Keep it under 120 words.
- If the page turns out not to describe an interview process, return an empty
  "process" string rather than inventing one.`,
);

export async function summariseHiring(
  page: FetchedPage,
  deps: PipelineDeps,
): Promise<string | null> {
  const result = await deps.llm.generateJson({
    task: "summariseHiring",
    system,
    user: `This page was found on the company's own site at ${page.url}.

${untrusted(`page:${page.url}`, `${page.title}\n\n${page.text}`, 5000)}

Reply with JSON of exactly this shape:
{
  "process": "the process in under 120 words, or \\"\\" if the page does not describe one",
  "stages": ["each named stage in order"]
}`,
    schema,
    maxOutputTokens: 800,
  });

  const process = result.process.trim();
  if (process.length === 0) return null;

  const stages = result.stages.map((s) => s.trim()).filter(Boolean);
  return stages.length > 0 ? `${process}\n\nStages: ${stages.join(" → ")}` : process;
}
