import type { KitBody } from "../../src/kit.schema.js";

/** A minimal kit that satisfies every rule. Tests mutate clones of it. */
export function validKit(): KitBody {
  return {
    source: {
      company: "Acme",
      company_url: "https://acme.test",
      role: "Backend Engineer",
      location: "Remote",
      jd_chars: 1240,
      researched_at: "2026-09-11T09:00:00.000Z",
      pages_used: ["https://acme.test/", "https://acme.test/people/how-we-hire.html"],
    },
    company_brief: {
      summary: "Acme builds billing infrastructure for marketplaces.",
      what_they_do: "A payments ledger and payout API used by online marketplaces.",
      sources: ["https://acme.test/"],
      how_they_hire: "Screen, take-home, systems round, team fit.",
    },
    role: {
      title: "Backend Engineer",
      seniority: "mid",
      responsibilities: ["Own payout services", "Improve ledger throughput"],
      requirements: [
        { id: "r1", text: "Strong TypeScript and Node.js", kind: "technical", priority: "must" },
        { id: "r2", text: "Experience with payments domain", kind: "domain", priority: "nice" },
        { id: "r3", text: "Mentors other engineers", kind: "behavioural", priority: "must" },
      ],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "Walk through how you would profile a slow Node.js endpoint.",
        answer_outline: "Reproduce, measure with clinic/0x, find the hot path, fix, re-measure.",
        difficulty: 2,
      },
      {
        id: "q2",
        requirement_ids: ["r3"],
        category: "behavioural",
        prompt: "Tell me about a time you unblocked a struggling teammate.",
        answer_outline: "Situation, what you noticed, the help you gave, the outcome.",
        difficulty: 1,
      },
      {
        id: "q3",
        requirement_ids: [],
        category: "company-fit",
        prompt: "Why Acme's payout problem specifically?",
        answer_outline: "Tie their ledger work to your own experience with money movement.",
        difficulty: 1,
      },
    ],
    flashcards: [
      { id: "f1", front: "Event loop phases", back: "timers, pending, poll, check, close", requirement_ids: ["r1"] },
      { id: "f2", front: "Idempotency key", back: "Client-supplied key that makes a retry safe.", requirement_ids: ["r2"] },
    ],
    schedule: {
      days_available: 3,
      days: [
        { day: 1, focus: "Technical: Strong TypeScript and Node.js", question_ids: ["q1"], minutes: 25 },
        { day: 2, focus: "Behavioural: Mentors other engineers", question_ids: ["q2", "q3"], minutes: 30 },
        { day: 3, focus: "Review: Strong TypeScript and Node.js", question_ids: ["q1"], minutes: 15 },
      ],
    },
    coverage: { uncovered_requirement_ids: ["r2"], passes: 2 },
    warnings: ["Nice-to-have requirement r2 has no dedicated question."],
  };
}
