import { describe, expect, it } from "vitest";
import type { DraftRequirement } from "../../src/pipeline/types.js";
import { condenseJobDescription } from "../../src/pipeline/steps/condenseJd.js";
import { applyEvidenceRules, derivePriority } from "../../src/pipeline/steps/evidence.js";
import { extractionResponseSchema } from "../../src/pipeline/steps/extractRequirements.js";
import { classifyHeading } from "../../src/pipeline/steps/sections.js";

/** Findings from the adversarial QA pass (EC-06 to EC-08, EC-40 to EC-48). */

const draft = (text: string, evidence: string, priority: "must" | "nice" = "must"): DraftRequirement => ({
  text,
  evidence,
  priority,
  kind: "technical",
});

describe("priority cues that used to be misread", () => {
  it("reads a negated requirement as not a must", () => {
    const posting = "Skills\nNo degree required\nA computer science degree is not required";
    expect(derivePriority(posting, "No degree required", "must").priority).toBe("nice");
    expect(derivePriority(posting, "A computer science degree is not required", "must").priority).toBe("nice");
  });

  it("reads 'a strong plus' as nice", () => {
    const posting = "Kubernetes experience is a strong plus";
    expect(derivePriority(posting, "Kubernetes experience", "must").priority).toBe("nice");
  });

  it("lets an explicit cue outrank a soft word inside the quote", () => {
    const posting = "Familiarity with Terraform is required";
    const result = derivePriority(posting, "Familiarity with Terraform", "nice");
    expect(result.priority).toBe("must");
    expect(result.cue).toBe("required");
  });

  it("reads German, French and Spanish cues, accents included", () => {
    expect(derivePriority("Sehr gute Kenntnisse in Go sind zwingend erforderlich", "Sehr gute Kenntnisse in Go", "nice").priority).toBe("must");
    expect(derivePriority("Erfahrung mit Rust ist von Vorteil", "Erfahrung mit Rust", "must").priority).toBe("nice");
    expect(derivePriority("Une expérience en Kotlin est souhaitée", "Une expérience en Kotlin", "must").priority).toBe("nice");
    expect(derivePriority("Inglés avanzado imprescindible", "Inglés avanzado", "nice").priority).toBe("must");
  });

  it("recognises requirement headings in other languages and new English wordings", () => {
    for (const heading of ["dein profil", "anforderungen", "votre profil", "requisitos", "必須スキル", "what you bring to the team"]) {
      expect(classifyHeading(heading), heading).toBe("must");
    }
    expect(classifyHeading("歓迎スキル")).toBe("nice");
    expect(classifyHeading("was wir bieten")).toBe("boilerplate");
  });
});

describe("evidence that does not support its requirement", () => {
  const posting = `Senior Backend Engineer
Requirements
Five years of experience building APIs in Go
Experience running Kubernetes clusters in production
Go and PostgreSQL in production
You have hired, coached and grown groups of developers across offices
Benefits
Strong communication skills are valued in our culture`;

  it("drops a requirement whose quote is a generic word", () => {
    const outcome = applyEvidenceRules(posting, [draft("10+ years of COBOL on mainframes", "experience building")]);
    expect(outcome.kept).toHaveLength(0);
    expect(outcome.dropped[0]!.reason).toBe("quote unrelated");
  });

  it("drops a short quote about something else", () => {
    const outcome = applyEvidenceRules(posting, [draft("10+ years of COBOL", "building APIs in Go")]);
    expect(outcome.dropped[0]!.reason).toBe("quote unrelated");
  });

  it("keeps a paraphrase backed by a long specific quote", () => {
    const outcome = applyEvidenceRules(posting, [
      draft("People leadership", "You have hired, coached and grown groups of developers across offices"),
    ]);
    expect(outcome.kept).toHaveLength(1);
  });

  it("does not take a requirement from the benefits section", () => {
    const outcome = applyEvidenceRules(posting, [
      draft("Strong communication skills", "Strong communication skills are valued in our culture"),
    ]);
    expect(outcome.dropped[0]!.reason).toBe("benefits or legal text");
  });

  it("collapses the same requirement reported twice from one quote", () => {
    const quote = "Experience running Kubernetes clusters in production";
    const outcome = applyEvidenceRules(posting, [
      draft("Kubernetes", quote),
      draft("Experience running Kubernetes clusters", quote),
    ]);
    expect(outcome.kept).toHaveLength(1);
  });

  it("keeps two requirements split from one compound quote", () => {
    const quote = "Go and PostgreSQL in production";
    const outcome = applyEvidenceRules(posting, [draft("Go in production", quote), draft("PostgreSQL in production", quote)]);
    expect(outcome.kept).toHaveLength(2);
  });

  it("accepts an English requirement quoting a posting in another language", () => {
    const german = "Dein Profil\nMehrjährige Erfahrung mit verteilten Systemen und Kubernetes\nSehr gute Deutschkenntnisse sind zwingend erforderlich";
    const outcome = applyEvidenceRules(german, [
      draft("Fluent German", "Sehr gute Deutschkenntnisse sind zwingend erforderlich", "nice"),
    ]);
    expect(outcome.kept).toHaveLength(1);
    expect(outcome.kept[0]!.priority).toBe("must");
  });
});

describe("extraction reply shape", () => {
  it("rejects an empty object, so the model is asked again instead of returning no requirements", () => {
    expect(extractionResponseSchema.safeParse({}).success).toBe(false);
  });

  it("still accepts an honest empty list", () => {
    expect(extractionResponseSchema.safeParse({ title: "Engineer", requirements: [] }).success).toBe(true);
  });
});

describe("condensing postings that used to come out empty or cut", () => {
  const sentence = (i: number) => `We build logistics software for warehouses number ${i}. `;

  it("keeps a long posting pasted as a single line", () => {
    const jd = `${Array.from({ length: 400 }, (_, i) => sentence(i)).join("")}5+ years of Go in production is required.`;
    expect(jd.includes("\n")).toBe(false);
    expect(jd.length).toBeGreaterThan(18_000);

    const result = condenseJobDescription(jd);
    expect(result.text.length).toBeGreaterThan(1_000);
    expect(result.text).toContain("5+ years of Go in production is required.");
  });

  it("does not delete a one-line posting that mentions equal opportunity", () => {
    const jd = `${Array.from({ length: 400 }, (_, i) => sentence(i)).join("")}We are an equal opportunity employer. Kotlin is required.`;
    const result = condenseJobDescription(jd);
    expect(result.text).toContain("Kotlin is required.");
    expect(result.text).not.toContain("equal opportunity");
  });

  it("keeps requirements at the end under a heading it does not recognise", () => {
    const filler = Array.from({ length: 500 }, (_, i) => `Company history paragraph ${i} about our journey.`).join("\n");
    const jd = `Data Engineer\n${filler}\nThe toolbox\nDeep Scala experience\nAirflow in production`;
    expect(jd.length).toBeGreaterThan(16_000);

    const result = condenseJobDescription(jd);
    expect(result.text.length).toBeLessThanOrEqual(16_000);
    expect(result.text.startsWith("Data Engineer")).toBe(true);
    expect(result.text).toContain("Deep Scala experience");
    expect(result.text).toContain("[…]");
  });
});
