import { z } from "zod";
import type { Requirement } from "@prep/shared";
import { assignRequirementIds } from "../canonical.js";
import {
  extractRequirementsSystem,
  extractRequirementsUser,
} from "../prompts/extractRequirements.js";
import type { DraftRequirement, PipelineDeps, Warnings } from "../types.js";
import { applyEvidenceRules } from "./evidence.js";
import type { ParsedInput } from "./parseInput.js";

const responseSchema = z.object({
  company: z.string().default(""),
  title: z.string().default(""),
  seniority: z.string().default("unspecified"),
  location: z.string().default(""),
  responsibilities: z.array(z.string()).default([]),
  requirements: z
    .array(
      z.object({
        text: z.string(),
        kind: z.enum(["technical", "behavioural", "domain"]),
        priority: z.enum(["must", "nice"]),
        evidence: z.string(),
        cue: z.string().optional(),
      }),
    )
    .default([]),
});

export type ExtractedRole = {
  company: string;
  title: string;
  seniority: string;
  location: string;
  responsibilities: string[];
  requirements: Requirement[];
};

export async function extractRequirements(
  parsed: ParsedInput,
  deps: PipelineDeps,
  warnings: Warnings,
): Promise<ExtractedRole> {
  const raw = await deps.llm.generateJson({
    task: "extractRequirements",
    system: extractRequirementsSystem,
    user: extractRequirementsUser(parsed.jd),
    schema: responseSchema,
    maxOutputTokens: 4096,
  });

  const drafts: DraftRequirement[] = raw.requirements.map((r) => ({
    text: r.text,
    kind: r.kind,
    priority: r.priority,
    evidence: r.evidence,
    ...(r.cue ? { cue: r.cue } : {}),
  }));

  const { kept, dropped, reprioritised } = applyEvidenceRules(parsed.jd, drafts);

  if (dropped.length > 0) {
    deps.logger.info(
      { dropped: dropped.map((d) => d.text) },
      "requirements dropped: evidence not found in the job description",
    );
    warnings.add(
      `${dropped.length} suggested requirement${dropped.length === 1 ? "" : "s"} could not be traced back to the posting and ${dropped.length === 1 ? "was" : "were"} dropped.`,
    );
  }

  if (reprioritised.length > 0) {
    deps.logger.debug({ reprioritised }, "priority corrected from job description wording");
  }

  if (kept.length === 0) {
    warnings.add(
      "No requirement could be quoted from the job description, so this kit covers general interview ground only.",
    );
  }

  return {
    company: raw.company.trim(),
    title: raw.title.trim() || "Unspecified role",
    seniority: raw.seniority.trim() || "unspecified",
    location: raw.location.trim(),
    responsibilities: raw.responsibilities.map((r) => r.trim()).filter(Boolean).slice(0, 12),
    requirements: assignRequirementIds(kept),
  };
}
