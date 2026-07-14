# LabReach — Build Plan v2: Gemini-only, research-first, batch-and-review

**Audience:** a fresh Claude Code session, working in this repo.
**Status:** approved direction. Read this end-to-end before writing code.

---

## 0. What this project is now (read this first)

LabReach helps an undergraduate cold-email research labs. It is **two tools**:

1. **Lab Digest** — paste lab URLs, get back what each lab actually works on (from *recent* work), the join logistics on their page, sorted by relatedness. **Surfaces facts, never predicts replies.**
2. **The Writer** — produces a *reasonable draft* per lab that the student fine-tunes and sends themselves.

The product is a **research-throughput machine**, not a quality machine. That distinction is the whole design, and it is backed by measurement, not opinion.

### The evidence that drives every decision below

The owner sent **53 real cold emails** with known reply outcomes. We ran the app's own evaluator over all 53 (`evals/RESULTS.md`, reproducible via `npm run eval:judge`). Findings:

- **`wouldSend` — the judge's "would a PI respond to this?" verdict — is 0 for 17 on emails that PIs actually did respond to**, including the one that became a real job.
- **No quality axis separates repliers from non-repliers.** Smallest Fisher p = 0.236 (n = 17 vs 36).
- **Corpus B scored far better than Corpus A** by the judge (opener 100% vs 68%, swap test 83% vs 49%) and got **the same reply rate** (33% vs 32%). A year of improved craft bought ~1 percentage point.
- It took **~41 emails to land one position**. A student can only hand-research ~5. **That gap is the product.**

**Therefore:** craft is a solved-enough problem. Throughput and lab selection are the levers. Optimize for "20 individually-researched emails in an afternoon," not "one perfect email."

---

## 1. Decisions already made (do not relitigate)

| Decision | Why |
|---|---|
| **Gemini Flash for everything.** Drop Anthropic entirely. | Craft is worth ~1pp. Claude is the only paid key; removing it makes the app free-tier runnable with a single API key. |
| **Drop `writingSample`.** Replace with structured experience: courses, experiments/techniques, personal projects. | The `voice` axis was 100%/100% in the eval — completely uninformative. And the one thing that beat baseline was a *real, earned connection*, which structured experience feeds directly. |
| **Drop `wouldSend` from `overallPass`.** | It is 0-for-17 on real successes. Gating on it burns revision passes chasing a verdict with zero demonstrated validity. |
| **Recency gate on evidence.** Only cite findings from recent papers (≤ ~4 years). | Referencing decade-old work signals you didn't look at what they do now. |
| **Batch research + one-at-a-time review queue.** | Volume is the mechanism. But every email must pass through a human. |
| **No GPTHuman / no paid humanizer.** | 300-word free tier ≈ one email; it's a detector-evasion product; and prose texture doesn't move replies. The humanizer *rules* are free and already in-repo. |
| **The digest never predicts replies.** Sort by relatedness, label it honestly. | Corpus A: same domains on both sides of the reply line. Similarity has zero support as a predictor. |

### Non-negotiables (from data, not preference)

1. **Grounding is a code-level string match.** No quote reaches the writer unless it appears verbatim in a fetched page. (Already enforced — `lib/agent/grounding.ts`. Do not weaken it.)
2. **Never fabricate why a student personally cares.** The tool may generate *scientific* significance/curiosity from a finding. It must never invent personal history ("ever since my grandmother…").
3. **Never bulk-export or auto-send.** Volume is fine; *cloning* is not. Every email is individually researched and individually reviewed by the human.
4. **Never claim above the student's actual experience level.**

---

## 2. Current state of the code (ground truth — verify, don't assume)

```
lib/agent/
  digest.ts          NEW. digestLab() — 1 Firecrawl scrape + 1 Gemini extraction + grounding + PubMed. Already Flash.
  index.ts           runAgent() — Gemini research tool-loop -> writer -> evaluator -> critique/revise (max 3 drafts).
  writer.ts          Claude Sonnet. <- THIS IS THE PORT TARGET.
  evaluator.ts       Gemini Flash, 9 LLM axes + 2 code checks. Prompt is KV-overridable (evaluator:prompt).
  grounding.ts       NEW. verifyGrounding() + groundedValueOrNull(). Drops unverifiable quotes.
  prohibitions.ts    26 regexes. TUNED AGAINST CLAUDE'S TICS — must be re-derived for Flash.
  structure-check.ts 4 paragraphs, 200-280 words. Informational only (not in overallPass).
  critique.ts        Turns a failed verdict into revision instructions.
  tools.ts           Gemini function decls + executeTool (now accumulates a SourceCorpus for grounding).
lib/
  scraper.ts         Firecrawl + disk cache (.tmp/scrape-cache, 30d TTL, SCRAPE_CACHE=0 to bust).
  pubmed.ts          NCBI E-utilities. FREE, no key. searchPubMed sorts by date.
  kv.ts              @vercel/kv when KV_REST_API_* set, else local JSON file.
  retry.ts           Retries 503/529/429/rate-limit with exponential backoff.
app/
  page.tsx           Intake form. digest/ draft/ admin/ admin/calibrate/ train/
  api/digest/        SSE, concurrency 2 (Firecrawl free-tier browser limit).
  api/research/      SSE, runs runAgent.
  api/evaluate-adhoc/  Admin-gated scoring endpoint (the eval harness uses it).
middleware.ts        SITE_PASSWORD Basic Auth gate. No-op when unset.
evals/               Corpus harness: anonymize -> ingest -> judge. RESULTS.md holds the finding.
```

**Budget facts (verified):** Firecrawl free = **1,000 credits/mo, 10 scrapes/min, 2 concurrent browsers**. 1 scrape = 1 credit. Digest = **1 credit/lab**. A full draft (`runAgent`) = **~3–7 credits**. PubMed is free and uncapped.

---

## 3. Models, latency, and cost — get this right

### The latency problem is the FREE TIER, not the model

Measured, not guessed. Running the 53-email eval at concurrency 3, **each evaluator call took ~80 seconds** — but that was almost entirely **429 rate-limit backoff** in `retry.ts`, not inference. The free tier caps around **15 RPM regardless of which Gemini model you pick.**

**Therefore: paying is what fixes latency. Changing models does not.** These are two separate decisions:
- **Latency** → move to a paid Gemini tier. The 429 storms vanish; a Flash draft returns in seconds.
- **Model** → a quality/cost dial, chosen independently.

### Model split (the recommended config)

Use the good model **only where prose quality matters.** Research is structured extraction and evaluation is classification — 2.5 Flash is fine at both and 5× cheaper.

```
GEMINI_WRITER_MODEL=gemini-3.5-flash     # prose — worth the spend
GEMINI_RESEARCH_MODEL=gemini-2.5-flash   # extraction — cheap
GEMINI_EVAL_MODEL=gemini-2.5-flash       # classification — cheap
```

Make all three **env-configurable with free-tier-friendly defaults** (2.5 Flash everywhere), so a friend who clones the repo runs free, while the owner's deploy sets the writer to 3.5 Flash.

**Side benefit:** with the writer on 3.5 and the judge on 2.5, the evaluator is no longer grading its own model family's output — which removes the self-leniency risk noted in WS1.

### Verified pricing (July 2026)

| Model | input /M | output /M | Notes |
|---|---|---|---|
| Gemini 2.5 Flash | $0.30 | $2.50 | cheapest; fine for extraction + judging |
| **Gemini 3.5 Flash** | **$1.50** | **$9.00** | GA; beats last-gen Pro; ~20% faster output; **has a free tier** |
| Claude Sonnet 4.6 | $3.00 | $15.00 | standard — **being removed** |
| Claude Sonnet 4.6 | $2.00 | $10.00 | *introductory, through Aug 31 2026* |

Against Sonnet's standard price, 3.5 Flash is ~2× cheaper; during Sonnet's intro pricing it's only ~10–30% cheaper. **Price is not the reason to port — one provider and one key is.**

**Cost per fully-researched email on the split config: ~$0.05.**
→ a 20-lab batch is **under $1**. 5 friends × 40 emails ≈ **~$10/month.**

### What 3.5 Flash actually buys you (be honest about this)

The eval says prose quality is worth **~1 percentage point** on replies. So **3.5 Flash will not get you more replies.** What it buys is a **better starting draft → less editing per email in the review queue.** Since human review (~2–5 min × 20 drafts) is now the *only* remaining bottleneck, that is a real and sufficient reason to spend on it. It buys back the student's time, not the reply rate. Do not claim otherwise in the README.

### Batch design implications (these still hold, paid or not)

- The batch step **must be a durable, resumable queue**, not a fire-and-forget `Promise.all`. Progress must survive a page refresh.
- Show honest per-lab status ("Drafting 7 of 20…"), not a spinner.
- Cap concurrency low (2–3); Firecrawl's free tier only allows 2 concurrent browsers anyway, and `retry.ts` absorbs 429s.
- **Reduce calls per email.** The biggest win: the digest already scraped and extracted the lab. **The writer should reuse the digest's grounded evidence instead of re-running the whole `runAgent` research loop.** This is the single most important efficiency change in this plan — it roughly halves both cost and latency.

---

## 4. Workstreams

### WS1 — Port the writer to Gemini Flash (removes the paid dependency)

**Goal:** delete `@anthropic-ai/sdk` and `ANTHROPIC_API_KEY` from the project.

- `lib/agent/writer.ts`: replace the Anthropic streaming block (~lines 218–237) with Gemini. Keep the JSON-out contract (`{subject, body, specificHook, bridgeSentence}`) — use `responseMimeType: 'application/json'` + a `responseSchema`, exactly like `digest.ts` and `evaluator.ts` already do. Temperature ~0.7 (the writer wants variety; digest/evaluator use 0.2).
- **Read the model from env**, per §3: `GEMINI_WRITER_MODEL` (default `gemini-2.5-flash` so a clone runs free; the owner's deploy sets `gemini-3.5-flash`). Do the same for `GEMINI_RESEARCH_MODEL` and `GEMINI_EVAL_MODEL`.
- Remove `@anthropic-ai/sdk` from `package.json`; remove `ANTHROPIC_API_KEY` from `.env.example` and the README setup table.
- **Re-derive `prohibitions.ts` against Flash.** The current 26 regexes catch *Claude's* tics. Generate ~10 real drafts with the chosen Flash model, read them, and replace the list with Flash's actual tells. Gemini's common ones: "delve", "underscore", "pivotal", "testament to", "moreover", "furthermore", "it's worth noting", "landscape", "realm", "crucial". Keep the corpus-derived, genre-specific ones (assertion phrases, "strong interest", etc.).
- **Remove the hard-coded gold-standard reference email** currently embedded in the writer prompt (`writer.ts` ~lines 202–211). One fixed exemplar is the real cross-student fingerprint risk (WS6) and it anchors every draft to one voice.

### WS2 — Profile: drop the writing sample, add structured experience

`types/index.ts` — `StudentProfile`:

```ts
// REMOVE: writingSample
// ADD (replacing the free-text relevantExperience blob with structured buckets):
courses: string            // "BILD 1, BICD 100, Organic Chemistry"
experiments: string        // hands-on techniques / lab work: "PCR, cell culture, one semester in X lab"
projects: string           // personal/side projects: "built a variant-calling script in Python"
// KEEP: name, school, year, major, experienceLevel, interests, whyResearch,
//       hoursPerWeek, startDate, duration
```

- `app/page.tsx`: remove the writing-sample field and its ≥20-word validation gate. Add the three experience inputs. Label them per `experienceLevel` (a `none` student has courses + projects but no experiments — that's fine and expected; do not treat it as a deficit).
- **Delete the `voice` axis** from `evaluator.ts`, `types/EvaluatorVerdict`, `HumanLabel`, and the calibrate UI. It read `writingSample`, and the eval showed it passed 100% of both groups — it measures nothing. Removing it is strictly a simplification.
- These three buckets are what the writer uses to find a **real, earned connection** — the only signal in the corpus that beat baseline. Feed them into the bridge, and into the digest's relatedness scoring.

### WS3 — Recency gate on evidence

The student must never cite decade-old work.

- `lib/pubmed.ts`: `searchPubMed` already sorts by date and returns `year`. Add a `minYear` filter.
- `lib/agent/tools.ts`: in the `finish` schema, require a `year` on each publication/finding where one is knowable. In `executeTool`, prefer recent PMIDs.
- New check (mirror `verifyGrounding`'s shape — drop, don't guess): reject candidate findings whose source paper is older than `currentYear - 4`. Feed rejections back through the existing one-shot re-extraction path in `index.ts`.
- **Accept the limitation:** lab-website prose often has no reliable date. Recency is enforceable on *papers*, best-effort on website text. Say so; don't fake it.
- The digest already computes `mostRecentPaperYear` — surface it, and flag labs with nothing recent as "no recent work to hook onto."

### WS4 — Demote the evaluator from predictor to floor

Driven directly by `evals/RESULTS.md`.

- **Remove `wouldSend` from `overallPass`** (`evaluator.ts` ~line 236). It's 0-for-17 on real successes. Keep it as an informational field if you like; it must not gate or trigger revisions.
- Keep as the **floor** (these are correctness/ethics guards, not conversion tactics):
  - `noFabrication` — a fabricated specific is disqualifying.
  - `bridge.isNonTransferable` (the **swap test**) — this is the actual anti-clone check. *"Could this sentence be sent by a different student to a different lab?"* Keep it front and center.
  - `prohibitions` — AI tells (re-derived for Flash in WS1).
  - `hook.isFinding`, `opener` — cheap structural guarantees.
- Reduce `MAX_EVALUATOR_PASSES` from 3 to **2** (initial + one revision). Every extra pass is Gemini calls against a rate-limited free tier, spent chasing a standard that doesn't predict replies.
- Reframe in the UI and README: the evaluator enforces *a floor* (grounded, specific, not a form email). It does **not** predict a reply, and we have the data to say so.

### WS5 — Batch research + review queue (the core new workflow)

This is the feature the evidence actually asks for.

**Flow:**
1. Profile once.
2. Paste lab URLs → **Digest** screens them (1 credit/lab), sorted by relatedness, with recent findings + join logistics.
3. Student **selects ~15–20** labs worth writing to.
4. **Batch drafting** runs in the background, resumable, 2–3 wide, honest progress.
5. **Review queue**: one lab at a time — lab summary, the highlighted *unique recent finding*, and the draft. Student edits, adds their own genuine "why this interests me," copies, sends from their own mail client. Next.
6. No batch export. No auto-send. Every email passes a human.

**Key efficiency requirement:** batch drafting must **reuse the digest's already-extracted, already-grounded evidence** rather than re-running the full `runAgent` research tool-loop per lab. That is the difference between ~160 Gemini calls and ~60, and on a rate-limited free tier it's the difference between usable and not.

- Persist batch state (KV) keyed by a batch id: `{labUrl, status: queued|drafting|ready|failed, draft?, evidence}`.
- SSE progress like `/api/digest` already does.
- New route `app/api/batch/route.ts`; new page `app/review/page.tsx`.

### WS6 — The draft structure (and why it isn't a clone)

**Fixed skeleton with must-hits is correct.** Your own Corpus A sent 41 emails sharing a near-verbatim skeleton and got 32% replies. PIs do not blacklist you for having an intro and an ask.

Required structure:
> **P1** — name, year, school, major/interest (1 sentence)
> **P2** — the specific *recent* finding, in plain language, + what's genuinely interesting about it (3–5 sentences, varied rhythm)
> **P3** — background named by *type* not tool names + curiosity framing + humility line if experience is limited
> **P4** — the ask: availability (hours/week, start, duration) + a clean request for a short call
> Sign-off + attach resume/transcript

**The anti-clone rule, stated precisely:** uniqueness does **not** come from varying the skeleton. It comes from the **grounded middle (P2) being generated per-lab from that lab's recent papers** — different input, different content, every time. The guard is the **swap test** (`bridge.isNonTransferable`), which already exists. Keep it.

Two kinds of sameness — only one is a problem:
- *Structural* sameness (same skeleton, same logistics phrasing): **fine**, empirically proven by Corpus A.
- *Content* sameness (the finding/curiosity is swappable between labs): **this is the form-email tell.** Grounding + the swap test prevent it.

**Cross-student fingerprint (scale-only concern):** if many students share one house style, a PI could notice. Mitigations: the student's own inserted sentence differs, their experience differs, and **do not hard-code a single gold-standard reference email into the prompt** (`writer.ts` currently embeds one — vary or remove it when porting to Flash).

### WS7 — Lift the science-cold-email rules from the humanizer

`workflows/skills/the-humanizer.md` is **model-agnostic markdown** — nothing Claude-specific. Most of it (LinkedIn, Slack, blog) is irrelevant. Lift **only** the *Science Student Cold Email* section (lines ~251–314), which was distilled from 7 real LabReach training arcs:

- **Jargon at the wrong level** — would a curious 19-year-old say this out loud?
- **Assertion phrases** — "directly connects to", "equipped me with", "could immediately contribute" → replace with curiosity framing ("I'm curious whether… could translate").
- **Resume dumping** — no tool names, library names, or benchmark numbers. Name the *type* of work; the resume is attached.
- **Explaining the PI's research back to them** — they know what they found.
- **Self-focus imbalance** — P3 must not be longer than P2.
- **Missing humility line** — required when experience is limited.
- **Connection via shared vocabulary only** — "we both do computational work" is not a connection.

Most of these already exist in `writer.ts`'s "NEVER DO THESE" and in `prohibitions.ts`. Reconcile the two so there is **one** source of truth, and re-tune the regexes for Flash.

**Honest caveat to record:** all 53 corpus emails were **human-written**. The corpus therefore says *nothing* about whether AI-sounding text is penalized. The humanizer's value is real but **unmeasured** — treat it as a sensible precaution, not a proven lever, and do not claim otherwise in the README.

---

## 5. Costs and keys after this plan

| Service | Role | Cost |
|---|---|---|
| **Google AI (Gemini Flash)** | research, digest, writer, evaluator | Free tier works (rate-limited, ~15 RPM). **Paid tier is what fixes latency** — ~$0.05/email on the split config in §3, so a 20-lab batch is under $1. |
| **Firecrawl** | scraping | Free: 1,000 credits/mo. Digest 1/lab, draft ~4/lab. Hobby = 3,000/mo for ~$16 if 5 friends × 40 emails. |
| **PubMed (NCBI)** | papers, recency | **Free, no key.** |
| ~~Anthropic~~ | ~~writer~~ | **Deleted by WS1.** |

**One API key to run the whole app.** That is the point of this plan. A friend cloning the repo runs entirely free on the defaults; the owner's deploy sets `GEMINI_WRITER_MODEL=gemini-3.5-flash` and a paid tier for speed.

---

## 6. Verification (do all of these)

- **Writer port:** generate 5 drafts on Flash end-to-end. Confirm valid JSON, grounded evidence only, and that `structure-check` still passes. Read them — then re-derive `prohibitions.ts` from what you actually see.
- **Grounding:** unchanged and must stay green. `verifyGrounding` drops a fabricated quote; a real one survives.
- **Recency:** feed a lab whose only recent paper is 2025 and one whose newest is 2014. The second must be flagged, and no 2014 finding may reach a draft.
- **Batch:** queue 10 labs. Kill the browser mid-run; reopen. **Progress must survive.** Confirm total Firecrawl spend ≈ 10 (digest, cached) + ~4/lab drafted.
- **Anti-clone:** draft to 5 different labs with the same profile. Diff the P2 paragraphs — they must share **no** substantive sentence. Run each through the swap test.
- **Regression:** the corpus eval must still run — `npm run eval:ingest && npm run eval:judge`. Note that removing `voice`/`wouldSend` changes the axis list; update `evals/eval-judge.mjs` and `RESULTS.md` accordingly.
- **No secrets, no names:** `evals/corpus/raw/` and the planning docs stay gitignored. The repo is public.

---

## 7. Explicitly NOT doing

- **GPTHuman or any paid humanizer.** 300-word free tier ≈ one email; it's a detector-evasion product; and the eval says prose texture doesn't move replies. The humanizer *rules* are free and in-repo.
- **Reply prediction / fit scoring.** The corpus kills it — same domains on both sides of the reply line.
- **Auto-directory scraping.** Every department's faculty page is custom and JS-rendered. Revisit *after* paste-a-list is solid; volume makes it attractive, but it's the brittlest thing in the idea.
- **GEPA.** Gated on ~50 calibrated labels; there are 12, and the judge it would optimize toward is the one we just demoted.
- **Bulk draft export.** Volume yes; cloning never.
