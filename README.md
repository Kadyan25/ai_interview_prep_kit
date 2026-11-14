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

- [Running it](#running-it) (and [deploying](#deploying))
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
- `http://localhost:8099/jobsite/` — a careers page linking six job ads and one how-we-hire page,
  the same page linked under several spellings

### Deploying

Three free services: MongoDB Atlas (M0), Render for the API, Vercel for the web app. The API is a
long-lived Express process because generation runs in-process for a minute or more, which a
serverless function would cut off.

1. **Atlas.** Create an M0 cluster and a database user. Under Network Access allow `0.0.0.0/0`,
   because Render's free instances have no fixed outbound IP. Copy the connection string.
2. **Render.** New → Blueprint, pointing at this repo; `render.yaml` defines the service, its build
   and start commands, and a `/health` check. Set the secrets it leaves blank: `MONGODB_URI`,
   `JWT_SECRET` (32+ random characters), `GROQ_API_KEY`, `GEMINI_API_KEY`, `TAVILY_API_KEY`, and
   `WEB_ORIGIN` (the Vercel URL, once you have it).
3. **Vercel.** Import the repo; `vercel.json` sets the workspace build. Set `API_URL` to the Render
   URL. The browser only ever calls its own origin and Next rewrites `/api/*` to the API, so the
   session cookie stays first-party and no CORS setup is needed.

In production the SSRF guard blocks private and loopback addresses, and the session cookie is
`Secure`. A free Render instance sleeps when idle, so the first request after a quiet spell takes a
few seconds while it wakes; the UI says so rather than showing a generic error.

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
call it identically, so the thing the batch runner executes and the thing the user clicks are the
same code path, and the whole pipeline is testable offline with a stub model.

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

The core design principle: inventing requirements is worse than reporting few, so this is enforced
in code rather than asked for in a prompt.

The model must return a **verbatim quote** from the posting for every requirement it reports. Then:

1. The quote is normalised and checked as a substring of the **full** posting. **Not found,
   requirement dropped**, and a warning says how many were dropped. The match tolerates re-typed
   dashes and spacing (models turn an em dash into " - ") but every letter and digit must agree.
2. Priority is re-derived from the posting's own wording, and the model's own answer is overridden.
3. Duplicates are collapsed.

Priority cues are looked for in order of how directly they apply, and nothing further away is read:

| Order | Where | Example |
|---|---|---|
| 1 | The quote's own clause | "5+ years of Go is **required**; TypeScript is **a plus**" — each half gets its own |
| 2 | A short label before a dash | "**Required** — five years of Go in production" |
| 3 | The nearest section heading above | "**What you'll bring**", "**Nice to have**", "**Preferred qualifications**" — with or without a colon, up to 40 lines up |

Clauses split at dashes, semicolons and sentence ends, so "Deep expertise in Quote-to-Cash systems —
hands-on experience strongly *preferred*" stays a must: the "preferred" belongs to the second clause.
The heading walk stops at the first heading of any kind, so a line under "Benefits" never inherits
the "Requirements" heading further up. With no cue in range the model's answer stands.

Postings are sent to the model whole up to 16,000 characters. Beyond that, benefits and legal
sections go first and requirement sections are never cut. An earlier 6,000 character cap cut a real
GitLab posting mid-requirements and produced 2 requirements out of 8; it now produces all 8.

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
- **The budget goes on pages that say something new.** Individual job ads (a path below `/careers`
  or `/jobs` with no process words) rank below "about" pages and at most two are read, since they
  repeat the posting the user pasted. At most three pages come from any one section, such as
  `/customers` or `/blog`. One page is fetched once however it is linked: query strings, fragments,
  trailing slashes, `index.html`, locale prefixes such as `/es/` and redirects all collapse to one
  key. On hex.tech this took customer case studies from 8 of 12 pages to 3.
- **`robots.txt`** is fetched once per origin and respected. Disallowed URLs are skipped and recorded
  in `research.skipped` rather than silently dropped.
- **Hacker News**, via the Algolia API, needs no key.
- **Tavily**, if `TAVILY_API_KEY` is set. This is how candidate reports on sites such as Glassdoor
  reach the kit: their `robots.txt` disallows crawlers, so they are never scraped, only read through a
  search API's results. Each search costs a credit, so results are cached for a week (on disk
  locally, in memory when deployed) and `TAVILY_MAX_SEARCHES` caps paid calls per process.

Discussion results are only kept if they are about interviewing at *this* company: the name as a
whole word (case-sensitive for names of four letters or fewer, so "Hex" does not match hex colour
codes) or the company's domain, within 160 characters of a candidate phrase such as *interview
process*, *interviewed at*, *take-home* or *recruiter*. Monthly "Who is hiring" threads are
excluded. A bare "interview" is not enough — it matched press interviews with founders.

When the company publishes no hiring process but candidates describe one, `how_they_hire` uses
their reports and says so: *"Their site does not describe the process. Unverified candidate
reports: …"*. A company's own page is stated as fact; a forum post is not.

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

Questions are reordered by drag or keyboard within a category, and moved to another category from a
picker on each card. The picker disables categories a question cannot legally join: only
company-fit questions may stand without a requirement, so a question with none can move there and
nowhere else.

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

The rule behind all of them: **a kit that is honest about what it could not find beats a kit that
fills the gap.** In a batch, `failed` is used only when no kit could be produced at all — the one
such case is an empty posting. Everything below still produces an `ok` kit, with the gap written into
`kit.warnings` and shown in the UI.

### Eight edge cases handled explicitly

| Case | What happens |
|---|---|
| **Company URL invalid, 404, or timing out** | An address that is not a URL, or not http(s), is recorded as a warning (*"…is not a valid web address, so the company was not researched"*) and the crawl step is skipped with that reason. A 404 or timeout is a skipped page with its reason in `research.skipped`; if no page could be read the brief is built from the posting alone and says so. `source.company_url` keeps what was supplied. The kit is `partial`. |
| **No discoverable hiring or about page** | `how_they_hire` says plainly that no public description of the process was found, unless candidates describe one in public discussion, in which case it is labelled as unverified candidate reports. The step shows as skipped, not failed. A careers page that talks about values rather than a process is summarised as nothing, not dressed up as a process. |
| **Two-line stub posting** | A warning gives the word count and says the list is short by design. Only requirements with a verbatim quote survive, and questions are generated only for categories that have requirements to hang them on, so a thin posting produces a thin kit. A posting with nothing quotable has zero requirements, not made-up ones. |
| **Public discussion finds nothing** | A warning naming the company says nothing in the kit is second-hand. Irrelevant matches (hex editors for "Hex", hiring threads, press interviews) are filtered out rather than counted as discussion. |
| **Model returns invalid JSON or an incomplete kit** | Repaired first (code fences, trailing commas, truncated output). If it still fails the schema, the model is re-asked once with the exact validation errors. An invented requirement id is stripped before coverage is measured; a question left pointing at nothing is dropped at assembly. The assembled kit is validated against the Appendix A schema before it is saved or written. |
| **Provider rate-limits or briefly fails** | Every call goes through one client with a concurrency limit and spacing between requests. Transient errors get backoff that honours `Retry-After` (a daily-quota 429 saying "retry in 0s" is ignored in favour of real backoff); permanent ones (404, 401) move to the other provider at once. If one question category still fails, that category is empty with a warning and the rest of the kit is unaffected. |
| **Same description and company submitted twice** | Posting, company and day count hash to the same value for the same user. The second submission returns the existing kit, including one still generating, and offers to open it or generate a fresh one, so no second job starts unless asked. |
| **A 1-day or 60-day schedule** | Allocation is code, and it asserts the day count exactly. One day puts everything on that day, hardest must-haves first, with no review day. Sixty days front-load the material and turn the surplus into review days that cycle through earlier days, so the plan does not drill the same two questions for fifty days. Tested for every day count from 1 to 60. |

### Others that came up

| Case | What happens |
|---|---|
| A must-have nothing covers | Listed in `coverage.uncovered_requirement_ids`, in `warnings`, and flagged on the requirement in the UI. Kit is `partial`. |
| Posting longer than the model's context | Sent whole up to 16,000 characters; beyond that benefits and legal text go first, requirement sections never. |
| `robots.txt` disallows a path | Skipped and recorded in `research.skipped`. |
| Site renders client-side | Pages with almost no readable text are skipped with that reason; the brief is thin and labelled. |
| Session expires mid-use | The next API call that gets a 401 clears the cookie and returns to sign-in with a notice, then back to the page you were on. |
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

Next.js, Express, MongoDB and TypeScript throughout — a stack well suited to a long-running, stateful
pipeline with one shared contract between the browser, the API and the CLI.

| Choice | Reason |
|---|---|
| npm workspaces | The kit contract is one Zod schema in `packages/shared`, imported by the API, the CLI, the tests and the browser. One definition, no drift. |
| Express, not Next route handlers | Generation is a ninety-second in-process job. It needs a long-lived server, which a serverless function is not. |
| MongoDB | A kit is one nested document that is read and written whole. |
| Groq `openai/gpt-oss-120b` primary, Gemini `gemini-3.5-flash` fallback | A five-case batch is around fifty model calls. Google's free tier allows twenty generate-content requests per day on a flash model, so Gemini as primary could not finish a full batch run. Groq's free tier carries it and answers in about a third of the time. Both are configured; `LLM_PRIMARY` swaps them. |
| Zod | The Appendix A shape, the referential rules between ids, the operation payloads and the env are all validated by the same library. |
| `tsx` at runtime | The shared package ships TypeScript source, so there is no build step between editing the contract and running the CLI. |
| No queue, no Redis, no websockets | One in-process job at a time with progress in Mongo and two-second polling. Two services instead of four, and the failure mode is easy to reason about. |
| Hand-rolled Tailwind components | Nine primitives is less code than configuring a component library, and every focus ring and dialog behaviour is deliberate. |

---

## Tests

```bash
npm test
```

231 tests, none of which touch the network or a real model.

| Area | What it pins down |
|---|---|
| Kit schema | Every referential rule: dangling ids, day count, integer minutes, difficulty range, company-fit questions allowed to stand alone |
| Edit operations | Every operation, origin transitions, ids never reused, deleting a question prunes the plan, a bad batch is rejected whole |
| Schedule | Exact day counts from 1 to 60, every question allocated once, whole-number minutes, hardest first, review days, empty deck |
| Coverage | Gap detection, must versus nice, invented ids stripped before counting |
| Evidence | Substring matching, re-typed dashes, cue overrides, cues scoped to their clause, headings without colons, a heading 12 bullets up, sections that stop the walk |
| Long postings | Sent whole when they fit, benefits cut before requirements, requirement sections never cut, a hard ceiling |
| Discussion | Short names match case, whole words only, hiring threads and press interviews rejected, domain counts as a mention; Tavily searched once per company, cache survives restarts and expires, budget stops paid calls, failures not cached |
| Model client | Backoff, `Retry-After` including the zero case, failover on both permanent and transient failures, JSON repair, one corrective re-ask |
| URL guard | Every private range, schemes, credentials, localhost allowed only when configured |
| Link ranking | Score order, tie-breaks, assets excluded, job ads recognised, one key per page across spellings and translations, words in adjacent elements kept apart |
| Crawler | Against a real HTTP server on an ephemeral port: finds the buried hiring page, obeys robots, respects depth and page budgets, reads the process page before job ads and only two ads, fetches a page once however it is linked, survives a dead host |
| Pipeline | Full run with a stub model: contract satisfied, unquotable requirement dropped, priority corrected, per-category calls, coverage loop, thin posting, repair path, invalid company URL still builds a kit, a requirement after character 6,000 still reaches the model |
| Regeneration | Edited, manual and pinned survive; generated replaced; other sections untouched; coverage recomputed; hand-edited plan left alone |
| Batch runner | Appendix B envelope with both `kit` and `error` on every entry, one entry per case, keeps going after a failure |
| Practice | Ordering rules, and that it does not mutate its input |

---

## Known limitations

- **Discussion search without a Tavily key is Hacker News only.** Good for technology companies,
  thin for everyone else. When nothing is found the kit says so rather than padding. The relevance
  filter is deliberately strict, so it will sometimes drop a real report that is phrased unusually.
- **Candidate reports are not dated or weighed.** A three-year-old post counts as much as last
  month's, which is why they are labelled unverified.
- **Pages that differ only by query string are treated as one.** Right for tracking parameters,
  wrong for the rare site that serves distinct pages as `?id=`.
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
