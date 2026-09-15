import { describe, expect, it } from "vitest";
import type { Requirement } from "@prep/shared";
import { countFor, questionBudget, routeRequirements } from "../../src/pipeline/steps/generateQuestions.js";

/**
 * From the live Vercel run: a "Sr Manager, Partner Programs" kit came back with
 * six system-design questions and 30 questions across three days, which is seven
 * hours a day.
 */

const requirement = (id: string, kind: Requirement["kind"], text = `Requirement ${id}`): Requirement => ({
  id,
  text,
  kind,
  priority: "must",
});

const context = (overrides: Partial<Parameters<typeof routeRequirements>[0]> = {}) => ({
  roleTitle: "Sr Manager, Partner Programs",
  seniority: "senior",
  company: "Vercel",
  requirements: [
    requirement("r1", "domain", "Proven experience building and scaling partner programs"),
    requirement("r2", "domain", "Understanding of the developer and AI ecosystem"),
    requirement("r3", "technical", "Experience with PRM systems and marketplaces"),
    requirement("r4", "behavioural", "Cross-functional leadership without direct authority"),
    requirement("r5", "behavioural", "Clear, confident communicator"),
  ],
  hiringProcess: null,
  companySummary: null,
  ...overrides,
});

describe("routeRequirements", () => {
  it("asks no system-design questions for a non-technical senior role", () => {
    expect(routeRequirements(context())["system-design"]).toEqual([]);
  });

  it("still asks them for an engineering role", () => {
    const routed = routeRequirements(
      context({
        roleTitle: "Staff Backend Engineer",
        requirements: [requirement("r1", "technical", "Designing distributed systems at scale")],
      }),
    );
    expect(routed["system-design"].length).toBeGreaterThan(0);
  });

  it("asks them when the company's own process has a design round", () => {
    const routed = routeRequirements(
      context({ hiringProcess: "A recruiter screen, then a system design interview, then a loop." }),
    );
    expect(routed["system-design"].length).toBeGreaterThan(0);
  });

  it("asks them for an unfamiliar title whose work is plainly systems work", () => {
    const routed = routeRequirements(
      context({
        roleTitle: "Solutions Consultant",
        requirements: [
          requirement("r1", "technical", "Kubernetes in production"),
          requirement("r2", "technical", "API design for high throughput services"),
          requirement("r3", "behavioural"),
        ],
      }),
    );
    expect(routed["system-design"].length).toBeGreaterThan(0);
  });

  it("asks none for a product designer, whose craft words include 'design systems'", () => {
    // Live from the deployed app: a Discord product design role got 7 of them,
    // because the model types Figma and design systems as technical requirements.
    const routed = routeRequirements(
      context({
        roleTitle: "Senior Product Designer, Consumer Revenue",
        requirements: [
          requirement("r1", "technical", "Expert in Figma and prototyping"),
          requirement("r2", "technical", "Built and maintained design systems at scale"),
          requirement("r3", "technical", "Designing consumer subscription flows"),
          requirement("r4", "domain", "Consumer monetisation experience"),
          requirement("r5", "behavioural", "Partners closely with engineering"),
        ],
      }),
    );
    expect(routed["system-design"]).toEqual([]);
  });

  it("asks none for other non-engineering roles, however senior", () => {
    for (const roleTitle of [
      "Senior UX Researcher",
      "Director of Marketing",
      "Enterprise Account Executive",
      "Nurse Practitioner",
      "Technical Recruiter",
      "Platform Product Manager",
    ]) {
      const routed = routeRequirements(
        context({
          roleTitle,
          requirements: [
            requirement("r1", "technical", "Design and run experiments"),
            requirement("r2", "technical", "Own the systems that track performance"),
            requirement("r3", "technical", "Build dashboards"),
          ],
        }),
      );
      expect(routed["system-design"], roleTitle).toEqual([]);
    }
  });
});

describe("how much material a plan holds", () => {
  it("scales with the days available", () => {
    expect(questionBudget(1)).toBeLessThan(questionBudget(7));
    expect(questionBudget(60)).toBeLessThanOrEqual(40);
    expect(questionBudget(1)).toBeGreaterThanOrEqual(8);
  });

  it("asks for fewer questions on a three-day plan than a two-week one", () => {
    const short = countFor("technical", 8, 3);
    const long = countFor("technical", 8, 14);
    expect(short).toBeLessThan(long);
    expect(short).toBeGreaterThanOrEqual(2);
  });

  it("never asks for more than the requirements justify", () => {
    expect(countFor("technical", 1, 30)).toBeLessThanOrEqual(questionBudget(30));
    expect(countFor("technical", 1, 30)).toBeLessThanOrEqual(3);
  });

  it("leaves the count alone when no day count is given", () => {
    expect(countFor("technical", 6, undefined)).toBe(12);
    expect(countFor("company-fit", 0, undefined)).toBe(4);
    expect(countFor("company-fit", 0, 1)).toBe(3);
  });
});
