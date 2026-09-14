import { describe, expect, it } from "vitest";
import { derivePriority, findEvidence } from "../../src/pipeline/steps/evidence.js";
import { classifyHeading } from "../../src/pipeline/steps/sections.js";

/**
 * Priority rules checked against the shapes real postings actually use, which the
 * earlier tests missed: headings without colons, long bullet lists, and bullets
 * with more than one clause. The GitLab case is taken from a live posting.
 */

describe("derivePriority on real posting shapes", () => {
  it("does not let a trailing clause downgrade the requirement in front of it", () => {
    const posting = `Staff Product Manager
What You’ll Bring
8+ years of product management experience, with at least 3 years in an internal platform PM role.
Deep domain expertise in Quote-to-Cash systems: Salesforce CPQ, Zuora Billing, and NetSuite ERP are the core stack—hands-on configuration or implementation experience strongly preferred.`;

    const result = derivePriority(
      posting,
      "Deep domain expertise in Quote-to-Cash systems",
      "nice",
    );
    expect(result.priority).toBe("must");
    expect(result.cue).toBe("what you'll bring");
  });

  it("still applies a cue that sits in the requirement's own clause", () => {
    const posting = "Skills\n5+ years of Node.js is required; TypeScript is a plus";
    expect(derivePriority(posting, "TypeScript is a plus", "must").priority).toBe("nice");
    expect(derivePriority(posting, "5+ years of Node.js is required", "nice").priority).toBe("must");
  });

  it("reads a heading that has no colon, as headings pasted from a web page do", () => {
    const posting = `Backend Engineer
Nice to have
Experience running Postgres in production
Terraform`;
    const result = derivePriority(posting, "Experience running Postgres in production", "must");
    expect(result.priority).toBe("nice");
  });

  it("reads 'Preferred qualifications' as optional despite containing 'qualifications'", () => {
    const posting = `Preferred qualifications
Experience with event-driven architectures`;
    expect(derivePriority(posting, "Experience with event-driven architectures", "must").priority).toBe(
      "nice",
    );
  });

  it("uses the nearest heading when a posting has both kinds", () => {
    const posting = `Requirements
Three years of Python in production
Nice to have
Experience with Apache Spark clusters`;
    expect(derivePriority(posting, "Three years of Python in production", "nice").priority).toBe("must");
    expect(derivePriority(posting, "Experience with Apache Spark clusters", "must").priority).toBe("nice");
  });

  it("reaches a heading more than six bullets up", () => {
    const bullets = Array.from({ length: 12 }, (_, i) => `Skill number ${i + 1} described at length`);
    const posting = ["What we're looking for", ...bullets].join("\n");
    const result = derivePriority(posting, "Skill number 12 described at length", "nice");
    expect(result.priority).toBe("must");
  });

  it("stops at a section that is not about requirements", () => {
    const posting = `Requirements
Five years of Java experience
Benefits
Generous learning budget every year`;
    const result = derivePriority(posting, "Generous learning budget every year", "nice");
    expect(result.priority).toBe("nice");
    expect(result.cue).toBeNull();
  });

  it("honours a short label in front of a dash", () => {
    const posting = "Role\nRequired — five years of Go in production";
    const result = derivePriority(posting, "five years of Go in production", "nice");
    expect(result.priority).toBe("must");
  });

  it("does not treat 'business requirements' in a sentence as a must", () => {
    const posting = `What you will do
Translate complex financial requirements into actionable system specifications`;
    const result = derivePriority(
      posting,
      "Translate complex financial requirements into actionable system specifications",
      "nice",
    );
    expect(result.priority).toBe("nice");
    expect(result.cue).toBeNull();
  });

  it("does not split a clause at an abbreviation", () => {
    const posting = "Skills\nStrong experience with frameworks, e.g. React or Vue";
    expect(derivePriority(posting, "experience with frameworks", "nice").priority).toBe("must");
  });
});

describe("findEvidence with re-typed punctuation", () => {
  const posting =
    "Sufficient technical fluency to engage with engineering on API design and integration trade-offs—without needing to write code.";

  it("accepts a quote whose em dash was re-typed as a spaced hyphen", () => {
    expect(
      findEvidence(posting, "integration trade-offs - without needing to write code"),
    ).toBeGreaterThanOrEqual(0);
  });

  it("accepts a quote using non-breaking hyphens where the posting has plain ones", () => {
    expect(findEvidence(posting, "integration trade‑offs—without needing")).toBeGreaterThanOrEqual(0);
  });

  it("still rejects a quote with different words", () => {
    expect(findEvidence(posting, "integration trade-offs without needing to write tests")).toBe(-1);
  });

  it("still rejects a quote that only matches once letters run together across words", () => {
    // Removing spaces must not let "api design" match "apide sign" style accidents
    // turn an invented phrase into a match; different letters never match.
    expect(findEvidence(posting, "engage with product on API design")).toBe(-1);
  });
});

describe("classifyHeading", () => {
  it("recognises the common requirement headings", () => {
    for (const heading of [
      "requirements",
      "qualifications",
      "what you'll bring",
      "what we're looking for",
      "about you",
      "minimum qualifications",
      "requirements:",
    ]) {
      expect(classifyHeading(heading), heading).toBe("must");
    }
  });

  it("recognises optional headings", () => {
    for (const heading of ["nice to have", "bonus points", "preferred qualifications", "nice-to-haves"]) {
      expect(classifyHeading(heading), heading).toBe("nice");
    }
  });

  it("recognises sections that are not requirements", () => {
    expect(classifyHeading("benefits")).toBe("boilerplate");
    expect(classifyHeading("what you'll do")).toBe("neutral");
  });

  it("leaves ordinary sentences alone", () => {
    expect(classifyHeading("experience with kubernetes is nice to have")).toBeNull();
    expect(classifyHeading("a".repeat(80))).toBeNull();
  });
});
