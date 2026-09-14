import { describe, expect, it } from "vitest";
import { JD_PROMPT_CHARS, condenseJobDescription } from "../../src/pipeline/steps/condenseJd.js";

/** At least `chars` characters of distinct, recognisable lines. */
function filler(label: string, chars: number): string {
  const lines: string[] = [];
  let length = 0;
  for (let i = 0; length < chars; i += 1) {
    const line = `${label} sentence ${i} padding the section out.`;
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n");
}

describe("condenseJobDescription", () => {
  it("leaves a posting that fits completely untouched", () => {
    const jd = "Backend Engineer\nRequirements\nFive years of Go";
    expect(condenseJobDescription(jd)).toEqual({ text: jd, condensed: false, removedChars: 0 });
  });

  it("sends a typical long posting whole, which the old 6,000 character cut did not", () => {
    // The live GitLab posting was 9,645 characters with its requirements after 5,600.
    const jd = `${filler("About us", 5_600)}\nWhat You’ll Bring\nThe requirement that used to be cut off`;
    expect(jd.length).toBeLessThan(JD_PROMPT_CHARS);
    const result = condenseJobDescription(jd);
    expect(result.condensed).toBe(false);
    expect(result.text).toContain("The requirement that used to be cut off");
  });

  it("removes benefits and legal text before anything else", () => {
    const jd = [
      "Senior Engineer",
      filler("About the role", 2_000),
      "Requirements",
      "Five years of distributed systems work",
      "Benefits",
      filler("Benefit", 9_000),
      "Equal opportunity employer statement",
      filler("Legal", 6_000),
    ].join("\n");

    const result = condenseJobDescription(jd);
    expect(result.condensed).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(JD_PROMPT_CHARS);
    expect(result.text).toContain("Five years of distributed systems work");
    expect(result.text).toContain("About the role sentence 0");
    expect(result.text).not.toContain("Benefit sentence");
  });

  it("keeps every requirement section whole when ordinary text has to go", () => {
    const jd = [
      filler("Company history", 20_000),
      "Requirements",
      "Must know Rust",
      "Nice to have",
      "Some exposure to WebAssembly",
    ].join("\n");

    const result = condenseJobDescription(jd, 4_000);
    expect(result.text.length).toBeLessThanOrEqual(4_000);
    expect(result.text).toContain("Must know Rust");
    expect(result.text).toContain("Some exposure to WebAssembly");
    // Ordinary text is kept from the top, not the bottom.
    expect(result.text).toContain("Company history sentence 0");
  });

  it("never returns more than the ceiling, even when the requirements alone exceed it", () => {
    const jd = ["Requirements", filler("Requirement", 30_000)].join("\n");
    const result = condenseJobDescription(jd, 5_000);
    expect(result.text.length).toBeLessThanOrEqual(5_000);
    expect(result.text.startsWith("Requirements")).toBe(true);
  });

  it("reports how much it removed", () => {
    const jd = ["Role", "Benefits", filler("Perk", 20_000)].join("\n");
    const result = condenseJobDescription(jd);
    expect(result.removedChars).toBe(jd.length - result.text.length);
    expect(result.removedChars).toBeGreaterThan(0);
  });
});
