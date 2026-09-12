# AI Interview Prep Kit

Turns a job description, a company URL and a number of days into a prep kit you can actually work
through: a company brief, the requirements the posting really asks for, a question bank tied to
those requirements, flashcards, and a day-by-day plan. Everything is editable, and one section can
be regenerated without losing the edits you made elsewhere.

```
  paste a posting  ─►  research the company  ─►  generate per category  ─►  check coverage in code
                                                                                    │
                            practise ◄── edit / reorder / regenerate ◄── day-by-day plan
```

---

## Contents

- [Running it](#running-it)
- [The batch runner](#the-batch-runner)
- [Architecture](#architecture)
- [How generation works](#how-generation-works)
- [Not inventing things](#not-inventing-things)
- [Coverage](#coverage)
- [The schedule](#the-schedule)
- [Research and sources](#research-and-sources)
- [The builder: generated, edited, manual, pinned](#the-builder-generated-edited-manual-pinned)
- [Long-running generation](#long-running-generation)
- [Practice mode](#practice-mode)
- [Edge cases](#edge-cases)
- [Security](#security)
- [Stack, and why](#stack-and-why)
- [Tests](#tests)
- [Known limitations](#known-limitations)

---

## Running it

Requires Node 20 or newer and a MongoDB instance. The batch runner needs neither a database nor the
web app — only a model key.

```bash
git clone <this repo> && cd ai-interview-prep-kit
npm install
cp .env.example .env      # then fill in at least one model key
docker compose up -d      # local MongoDB on 27017, skip if you use Atlas
npm run dev               # API on :4000, web on :3000
```

Open http://localhost:3000, create an account, and paste a posting.

`.env.example` documents every variable. The only ones you must set are a model key and, for the web
app, `MONGODB_URI` and `JWT_SECRET`.

| Script | What it does |
|---|---|
| `npm run dev` | API and web together |
| `npm test` | Every test, across all three workspaces |
| `npm run typecheck` | `tsc --noEmit` everywhere |
| `npm run evaluate` | The batch runner, below |
| `npm run fixture:site` | Serves two fake company sites on :8099 for offline testing |

### Trying it without a real company

`npm run fixture:site` serves two sites the crawler can be pointed at:

- `http://localhost:8099/acme/` — a company whose hiring process is published two links deep at
  `/people/how-we-hire.html`, nowhere near a `/careers` path, with a `robots.txt` that disallows
  part of the site
- `http://localhost:8099/nohire/` — a company that publishes nothing about how it hires

---

## The batch runner

```bash
npm run evaluate -- --input cases.json --output kits.json
```

Input is a JSON array (or `{ "cases": [...] }`) of `{ id, jd, company_url, days }`. Output is the
Appendix B envelope: `{ version, generated_at, kits: [...] }`, one entry per input case, keyed by
the id you gave.

Three things worth knowing:

- **It never stops on a failure.** Each case is wrapped individually; a case that throws is recorded
  as `failed` with an error code and the run continues. The process exits 0 whether or not any case
  failed, because the output file is the result, not the exit status.
- **`failed` is reserved for a case that produced no kit at all.** A company site that could not be
  read, a posting with no quotable requirements, no hiring page, no public discussion — all of those
  still produce a kit, marked `ok`, with the gaps written into `kit.warnings`.
- **Relative paths resolve from where you ran the command.** npm runs workspace scripts with the
  workspace as the working directory, so the runner resolves paths against `INIT_CWD`. `--input
  cases.json` from the repo root means the repo root.

It needs no database and no network beyond the model and whatever sites the cases point at.

---

## Architecture

Three workspaces:

```
packages/shared   the kit contract (Zod), the edit operations, error codes
apps/api          Express: routes → services → models, plus the pipeline and the batch CLI
apps/web          Next.js App Router
```

```
Browser (Next.js)                            npm run evaluate
  /kits/new  /kits/[id]  /kits/[id]/practice        cli/evaluate.ts
        │   /api/* rewritten to API_URL                    │
        ▼                                                  │
Express                                                    │
  routes/ ── services/ ── models/ (Mongoose)               │
                 │                                         │
                 ▼                                         ▼
          jobs/runner.ts ─────────────►  pipeline/runPipeline(input, deps)
          (in-process, persists                 │
           step progress to Mongo)              ├── llm/client.ts  → Groq │ Gemini
                                                ├── retrieval/*    → company site, HN, Tavily
                                                ├── coverage.ts    (pure code)
                                                └── schedule.ts    (pure code)
                                                        │
                                                        ▼
                                              shared/kit.schema.ts validates
```

Two decisions hold this together.

**The pipeline is one function with injected dependencies.** `runPipeline(input, deps)` returns a
kit. It never touches Mongo, Express or `process.env`. The web app's job runner and the batch CLI
call it identically, so the thing the graders run and the thing the user clicks are the same code
path, and the whole pipeline is testable offline with a stub model.

**The browser and the server share one reducer.** Edits are operations, not documents; the same
`applyOps` runs in both places. More on that below.

---

## How generation works

Twelve steps. Each reports progress, and each decides what to do based on what the previous ones
actually found.

| # | Step | Model? | What it does | When it can't |
|---|---|---|---|---|
| 1 | parseInput | no | Trims, counts, validates the URL, flags a thin posting | Fails only on an empty posting |
| 2 | extractRequirements | yes | Posting → title, seniority, responsibilities, requirements with a verbatim quote for each | A thin posting yields a short list and a warning |
| 3 | crawlCompany | no | Homepage → up to 12 ranked pages, depth 2 | Unreachable → no pages, warning, continue |
| 4 | findHiringPage | no | Scores every crawled page for hiring language | Below threshold → null, warning |
| 5 | summariseHiring | yes | The winning page → their actual process | Skipped when step 4 found nothing |
| 6 | searchDiscussion | no | Hacker News, and Tavily if a key is set | Nothing found → warning |
| 7 | writeBrief | yes | Pages + discussion + posting → brief | No pages → brief says it is inferred from the posting alone |
| 8 | generateQuestions | yes ×4 | One call per category | A category with no requirements is skipped, not faked |
| 9 | coverageLoop | code + model | Check, fill gaps, check again | Leftovers are reported, not hidden |
| 10 | generateFlashcards | yes | Requirements + questions → cards | Failure costs the cards, not the kit |
| 11 | allocateSchedule | no | Requirements + questions + days → plan | — |
| 12 | assemble + validate | no | Assign ids, build the body, validate | One repair attempt, then fail |

Steps 3 to 6 are the reason the kit is about *this* company. What the hiring page says is fed into
the question prompts, so a company that runs a take-home and a system design round gets questions
shaped to those rounds. On the fixture site the generated system-design questions came back about
payout pipelines and reconciliation against settlement files, and a company-fit question referenced
their published two-week process. None of that is in the posting.

**Each question category is a separate model call.** Technical and behavioural never share one.
Asking for both at once produces questions that are vaguely about each and sharply about neither,
and it makes the per-category regeneration in the builder impossible.

---

## Not inventing things

The brief is explicit that inventing requirements is worse than reporting few, so this is enforced
in code rather than asked for in a prompt.

The model must return a **verbatim quote** from the posting for every requirement it reports. Then:

1. The quote is normalised and checked as a substring of the posting. **Not found, requirement
   dropped**, and a warning says how many were dropped.
2. Priority is re-derived from the posting's own wording. A cue word — *required*, *must*, *bonus*,
   *nice to have* — decides, and the model's own answer is overridden.
3. Duplicates are collapsed.

The cue has to sit in the **same line or bullet** as the quote. An early version searched a 200
character window, which in a normal bullet list spans two or three neighbouring bullets, so
"Experience with the payments domain is nice to have" quietly downgraded the *next* bullet. If the
bullet has no cue, the code looks back up to six lines for a section heading like `Nice to have:`.
Otherwise the model's answer stands.

This works on real output. In a live run the model proposed "Experience with Node.js" against a
52-word posting that never said it; it was dropped. In another, it marked payments-domain experience
as a must-have when the posting said "nice to have"; it was corrected to nice.

---

## Coverage

Measured in code. The model is never asked whether it covered everything, because it would say yes.

```
pass 1: check
pass 2: if gaps, generate questions for exactly those requirements, check again
pass 3: only if a must-have is still bare and pass 2 actually added something
stop:   no gaps, or a pass added nothing, or three passes
```

`coverage.passes` is the number of checks that ran. Before each check, requirement ids that no
requirement actually has are stripped from the questions — otherwise a hallucinated id would read as
coverage. Anything still uncovered goes into `coverage.uncovered_requirement_ids` **and** into
`warnings`, and the requirement is flagged in the UI. An uncovered must-have makes the kit
`partial`, which is still a usable kit.

---

## The schedule

Pure code, no model. The day count has to be exactly right and every question has to appear
somewhere, which is not a promise a model can keep.

```
weight(q)  = max(priority over its requirements) × difficulty     must=3, nice=1 → 1..9
minutes(q) = { 1: 15, 2: 25, 3: 40 }[difficulty]

1. Sort by weight descending, then by requirement order, then by id.
2. With 3+ days the last one is review: no new hard material the day before an interview.
3. target = ceil(total minutes / study days). Fill each day to target, last day takes the rest.
4. Days with nothing left cycle back through earlier days as review, so a 60-day plan does not
   drill the same two questions for fifty days.
5. The day's label names the two requirements its questions lean on most.
6. Assert: the day count matches, every question is allocated exactly once, every day is a whole
   number of minutes.
```

Front-loading falls out of steps 1 and 3: the hardest work on the must-haves sorts first and the
earliest day fills first.

---

## Research and sources

- **The company's own site.** Breadth-first from the homepage, depth 2, at most 12 pages, one
  request at a time with a 500 ms gap. Links are ranked before they are fetched — careers, hiring
  and handbook paths score highest, legal and account pages score negative, assets are excluded —
  because with a 12-page budget the visit order decides whether the hiring page is found at all. A
  fixed list of paths would not work; the fixture site deliberately hides its hiring page at
  `/people/how-we-hire.html` and the crawler finds it.
- **`robots.txt`** is fetched once per origin and respected. Disallowed URLs are skipped and recorded
  in `research.skipped` rather than silently dropped.
- **Hacker News**, via the Algolia API, needs no key. Hits are filtered to ones that actually mention
  the company.
- **Tavily**, only if `TAVILY_API_KEY` is set. Without it the kit says no public discussion was
  found rather than pretending otherwise.

`kit.source.pages_used` and `company_brief.sources` are written by the code from what was actually
fetched, never by the model, so the source list cannot be embellished.

---

## The builder: generated, edited, manual, pinned

This is the part most likely to lose someone's work, so it is built around operations rather than
documents.

The client sends *what the user did* — `move q7 to position 2 of behavioural`, `update q3.prompt` —
never the whole kit. `applyOps` lives in `packages/shared` and runs in both places: in the browser
for an instant optimistic update, and on the server as the authority. They cannot disagree about
what an edit means.

Every item carries an origin:

| origin | set when | survives a regeneration of its section? |
|---|---|---|
| `generated` | written by the pipeline | no, unless pinned |
| `edited` | you changed any field of it | yes |
| `manual` | you wrote it yourself | yes |

`pinned` is independent and always survives. Touching an item is the only thing that marks it
`edited`, which is what makes regeneration tractable.

**Regenerating one category** replaces only the generated, unpinned questions in that category. It
then re-runs the coverage check in code, and writes back with a targeted update on just the paths it
owns, so an edit you make elsewhere while it runs is preserved. If you had hand-edited the schedule
it is left alone and flagged stale rather than overwritten; otherwise it is re-planned around the new
questions. Dead question ids are pruned from the plan either way.

Verified end to end against a live model: edit one question, pin another, regenerate the whole
technical category. Both survive with their text intact, the untouched ones are replaced with new
ids (ids are never reused), every other category and the flashcards are untouched, coverage is
recomputed and the plan is re-laid with no dangling ids.

**Concurrent edits.** Every write is version-checked. If something else wrote first the update
matches nothing and returns `409` with the current kit; the client replays its operations onto the
newer version and retries. While a section is regenerating, edits to *that* section return
`SECTION_LOCKED` and edits everywhere else still save.

---

## Long-running generation

Generation takes roughly a minute and is external and failure-prone, so nothing waits on it.

- `POST /api/kits` returns **202** immediately with a kit id and a job id.
- The job runs in-process, one at a time, and **persists every step to Mongo as it goes**. The UI
  polls `GET /api/kits/:id/job` every two seconds and shows the twelve steps with live status and
  honest notes: *Read 3 pages*, *No hiring page found*, *Nothing public found*. Polling stops the
  moment the job settles.
- Progress is in the database, not in memory, so a refresh, a second tab or a reconnect all see the
  same thing.
- **Triggered twice for the same posting:** the same posting, company and day count for the same user
  hash to the same value. The second attempt returns 200 with the existing kit and a dialog offering
  to open it or generate a fresh one, rather than spending another ten model calls.
- **Fails halfway:** the kit is marked failed, the error code is shown, and a retry button queues a
  new job.
- **The process dies mid-run:** at boot, any job still marked running belonged to a process that no
  longer exists. It is marked failed with `INTERRUPTED` and the UI offers a retry, instead of a
  spinner that never resolves.

The model client is one entry point for every call: it limits concurrency, spaces requests, retries
transient failures with backoff, and **walks the provider list**. Each provider gets a few attempts
for transient errors and is abandoned at once for a permanent one, then the next provider is tried.
That behaviour earned its place — during development the primary model was retired mid-project and
returned 404, and the fallback carried the run.

---

## Practice mode

Flashcards, one at a time, answer hidden until you ask for it, then rate yourself shaky, getting
there or solid. Space reveals, 1/2/3 rate and advance; the whole loop works without a mouse.

The next session is ordered: **never seen first, then whatever you rated worst, then whatever has
waited longest.** Progress is shown per requirement rather than per card, weakest must-haves first,
because two days out the useful question is "which must-have have I not touched", not "how many
cards did I do".

Deliberately not spaced repetition. SM-2 style intervals assume months of study; on a one-to-sixty
day horizon most cards would never come due and the user would open practice to find nothing waiting.
Confidence ordering is predictable, explainable and correct for a deadline.

---

## Edge cases

| Case | What happens |
|---|---|
| Thin posting | Few requirements, and a warning saying how many words it was. The kit is short on purpose and says so. |
| Nothing quotable in the posting | Zero requirements rather than invented ones; the kit falls back to general ground for the role title and says so. |
| Company site unreachable | Crawl returns nothing, brief is built from the posting alone and states that, kit is `partial`. Still `ok` in a batch — a kit was produced. |
| No hiring page | `how_they_hire` says plainly that no public description was found. Recorded as a skipped step, not a failure. |
| Hiring page found but not actually about hiring | The summariser returns nothing and the kit reports no hiring page, rather than summarising a careers-values page as a process. |
| No public discussion | A warning naming the company, so nothing in the kit is second-hand. |
| `robots.txt` disallows a path | Skipped and recorded in `research.skipped`. |
| A must-have nothing covers | Listed in `coverage.uncovered_requirement_ids`, in `warnings`, and flagged on the requirement in the UI. Kit is `partial`. |
| Model returns malformed JSON | Repaired (fences, trailing commas, truncation), then re-asked once with the exact validation errors, then `LLM_INVALID_OUTPUT`. |
| Model invents a requirement id | Stripped before the coverage check so it cannot read as coverage; a question left with nothing to point at is dropped at assembly. |
| Model provider down or retired | Retries with backoff, then the other provider. A daily-quota 429 that says "retry in 0s" is ignored in favour of real backoff. |
| One question category fails | That category is empty and a warning says so. The other three, and the kit, are unaffected. |
| `days = 1` | Everything on one day, no review day. |
| `days` far exceeds the material | Surplus days become review days that cycle through earlier days. |
| Duplicate submission | Deduplicated by content hash; the existing kit is offered. |
| Company site on localhost | Supported. The SSRF guard is on in production and off in development, which is what lets the batch runner reach a local fixture site. |

---

## Security

Every fetched page and the pasted posting are treated as text written by someone else.

- **Prompt injection.** Untrusted text is always fenced in `<untrusted_document source="...">` tags,
  and the system prompt states that anything inside them is evidence, never instruction. Source lists
  are built by code from what was fetched, so a page cannot talk its way into the citations.
- **SSRF.** Every URL is checked before a socket opens and again after every redirect: http(s) only,
  no embedded credentials, DNS resolved, and private, loopback, link-local and cloud-metadata ranges
  rejected. In development the guard is relaxed so the fixture site works; in production it is on.
- **Fetch limits.** 10 s timeout, at most 3 redirects, HTML and plain text only, 2 MB cap read
  through a streaming reader so an endless body cannot exhaust memory.
- **Input.** Zod on every request body, and the assembled kit is validated before it is ever saved.
- **Auth.** bcrypt at cost 12, JWT in an httpOnly SameSite cookie, `Secure` in production. The user
  id comes from the token and never from a parameter or body; every query filters by it. Next
  rewrites `/api/*` to the API so the cookie stays first-party.
- `helmet`, a 1 MB body limit, and rate limits on sign-in and on creating kits.

---

## Stack, and why

Next.js, Express, MongoDB and TypeScript throughout, which is the stack the brief prefers, so none of
the reasoning budget goes on justifying a substitution.

| Choice | Reason |
|---|---|
| npm workspaces | The kit contract is one Zod schema in `packages/shared`, imported by the API, the CLI, the tests and the browser. One definition, no drift. |
| Express, not Next route handlers | Generation is a ninety-second in-process job. It needs a long-lived server, which a serverless function is not. |
| MongoDB | A kit is one nested document that is read and written whole. |
| Groq `openai/gpt-oss-120b` primary, Gemini `gemini-3.5-flash` fallback | A five-case batch is around fifty model calls. Google's free tier allows twenty generate-content requests per day on a flash model, so Gemini as primary could not finish the run the graders do. Groq's free tier carries it and answers in about a third of the time. Both are configured; `LLM_PRIMARY` swaps them. |
| Zod | The Appendix A shape, the referential rules between ids, the operation payloads and the env are all validated by the same library. |
| `tsx` at runtime | The shared package ships TypeScript source, so there is no build step between editing the contract and running the CLI. |
| No queue, no Redis, no websockets | One in-process job at a time with progress in Mongo and two-second polling. Two services instead of four, and the failure mode is easy to reason about. |
| Hand-rolled Tailwind components | Nine primitives is less code than configuring a component library, and every focus ring and dialog behaviour is deliberate. |

---

## Tests

```bash
npm test
```

170 tests, none of which touch the network or a real model.

| Area | What it pins down |
|---|---|
| Kit schema | Every referential rule: dangling ids, day count, integer minutes, difficulty range, company-fit questions allowed to stand alone |
| Edit operations | Every operation, origin transitions, ids never reused, deleting a question prunes the plan, a bad batch is rejected whole |
| Schedule | Exact day counts from 1 to 60, every question allocated once, whole-number minutes, hardest first, review days, empty deck |
| Coverage | Gap detection, must versus nice, invented ids stripped before counting |
| Evidence | Substring matching, cue overrides, cues not leaking across bullets, heading fallback |
| Model client | Backoff, `Retry-After` including the zero case, failover on both permanent and transient failures, JSON repair, one corrective re-ask |
| URL guard | Every private range, schemes, credentials, localhost allowed only when configured |
| Link ranking | Score order, tie-breaks, assets excluded, relative links resolved |
| Crawler | Against a real HTTP server on an ephemeral port: finds the buried hiring page, obeys robots, respects depth and page budgets, survives a dead host |
| Pipeline | Full run with a stub model: contract satisfied, unquotable requirement dropped, priority corrected, per-category calls, coverage loop, thin posting, repair path |
| Regeneration | Edited, manual and pinned survive; generated replaced; other sections untouched; coverage recomputed; hand-edited plan left alone |
| Batch runner | Appendix B envelope, one entry per case, keeps going after a failure |
| Practice | Ordering rules, and that it does not mutate its input |

---

## Known limitations

- **Discussion search leans on Hacker News.** Good for technology companies, thin for everyone else.
  Tavily widens it, but that needs a key. When nothing is found the kit says so rather than padding.
- **One job at a time per process.** Right for one user on a free tier, wrong for many. The seam is
  there: swapping the in-process queue for a real one means replacing one module.
- **A cold API takes a few seconds to answer.** Free hosting sleeps idle services; the first request
  after a quiet period is slow.
- **No JavaScript rendering.** The crawler reads HTML. A company site that renders entirely
  client-side will produce a thin brief, honestly labelled.
- **Free-tier model quotas are the real constraint.** The concurrency limit and the gap between
  requests are tuned for them, not for speed.
- **Today's day in the plan is counted from when the kit was created**, not from a date you choose.
- **The crawl budget is twelve pages.** A large site may hide its hiring page deeper than that; the
  link ranking is what makes twelve usually enough.
