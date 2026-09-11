export const FULL_JD = `Senior Backend Engineer — Ledger
Acme Payments · Remote (EU)

About the role
You will own the payout ledger that moves money for thousands of online
marketplaces. The ledger is the system of record for every transfer we make, so
correctness matters more here than anywhere else in the company. You will work
with two other backend engineers and report to the head of platform.

What you will do
- Own the payout service end to end, including its on-call rotation
- Design the next version of our double-entry ledger
- Reduce reconciliation time from hours to minutes

What we are looking for
- 5+ years building production services in Node.js and TypeScript is required
- Strong experience designing and scaling distributed systems
- You must be comfortable owning a service end to end, including on-call
- Experience with the payments domain is nice to have
- Mentoring junior engineers is part of the job

Benefits
Remote-first, four weeks of paid leave, a learning budget.`;

export const THIN_JD = `Backend engineer needed. Node.js. Remote. Apply now.`;

/**
 * The requirement fixture quotes the posting verbatim, which is what the
 * evidence rule demands of the real model.
 */
export const EXTRACTED_REQUIREMENTS = {
  company: "Acme Payments",
  title: "Senior Backend Engineer",
  seniority: "senior",
  location: "Remote (EU)",
  responsibilities: [
    "Own the payout service end to end",
    "Design the next version of the double-entry ledger",
  ],
  requirements: [
    {
      text: "Five years of production Node.js and TypeScript",
      kind: "technical",
      priority: "must",
      evidence: "5+ years building production services in Node.js and TypeScript is required",
      cue: "required",
    },
    {
      text: "Designing and scaling distributed systems",
      kind: "technical",
      priority: "must",
      evidence: "Strong experience designing and scaling distributed systems",
      cue: "strong",
    },
    {
      text: "Payments domain knowledge",
      kind: "domain",
      priority: "must",
      evidence: "Experience with the payments domain is nice to have",
      cue: "",
    },
    {
      text: "Mentors junior engineers",
      kind: "behavioural",
      priority: "must",
      evidence: "Mentoring junior engineers is part of the job",
      cue: "",
    },
    {
      text: "Kafka and Flink stream processing",
      kind: "technical",
      priority: "must",
      evidence: "deep experience with Kafka and Flink in production",
      cue: "required",
    },
  ],
};
