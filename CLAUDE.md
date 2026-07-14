# Agent Instructions

LabReach is a **Next.js (App Router) + TypeScript** web app that helps undergraduates
cold-email research labs. It began as a Python "WAT framework" scaffold; that has been
replaced by the app described here, but the **core WAT principle still governs the
design**: probabilistic AI handles reasoning, deterministic code handles execution and
gating. That separation is what makes the output trustworthy.

## The architecture (probabilistic vs. deterministic)

**AI does the reasoning:**
- `lib/agent/digest.ts` — reads a lab page and extracts what they work on + join logistics (one Gemini call).
- `lib/agent/index.ts` — the research→write→evaluate→revise orchestrator (`runAgent`).
- `lib/agent/writer.ts` — composes the email (Claude).
- `lib/agent/evaluator.ts` — the LLM-judged quality axes (Gemini).

**Deterministic code does the gating — this is where reliability comes from:**
- `lib/agent/grounding.ts` — drops any evidence quote not found verbatim in a fetched page. Grounding is a string match, not a prompt instruction.
- `lib/agent/prohibitions.ts` / `structure-check.ts` — regex + structural checks, no model call.
- `lib/kv.ts`, `lib/scraper.ts` (cached), `lib/pubmed.ts`, `lib/rate-limit.ts`, `middleware.ts` — plumbing.

**Why it matters:** when AI handles every step directly, accuracy compounds downward. Offloading verification and gating to deterministic code is what keeps a fabricated quote or an out-of-level claim from reaching a real professor.

## The two user-facing flows

1. **Lab Digest** (`/digest` → `/api/digest` → `digestLab`) — paste lab URLs, get grounded facts + join logistics, sorted by interest overlap. Surfaces facts, never a reply prediction.
2. **The Writer** (`/` → `/draft` → `/api/research` → `runAgent`) — a personalized first draft the student edits and sends themselves. Never sends, never bulk-exports.

Admin/eval surfaces: `/admin`, `/admin/calibrate` (blind grading + evaluator-prompt tuning), and the `evals/` corpus harness.

## How to operate

1. **Reuse before building.** Check `lib/agent/` and `lib/` for an existing function before writing a new one. The pipeline is deliberately small and composable.
2. **Deterministic where it counts.** New correctness guarantees belong in code (a check, a gate), not in a prompt. Prompts steer; code enforces.
3. **Learn from failures.** Read the full error, fix, and **verify by running it** — a build, a typecheck, or an end-to-end call. If a fix uses **paid API calls or credits (Anthropic, Firecrawl), check before running again.** Gemini and PubMed have free tiers; Firecrawl bills per scrape (the `.tmp/` cache exists to avoid re-paying).
4. **Respect the evidence non-negotiables.** Never write finished/bulk emails; never let a quote through that isn't grounded; never claim above the student's stated experience level; never fabricate why a student personally cares; the digest/filter runs upstream of writing.
5. **Don't overwrite instruction docs without asking** — this file and anything under `workflows/`. Correct facts freely; don't discard intent.

## The self-improvement loop

Identify what broke → fix it in the right layer (code for guarantees, prompt for steering) → verify it runs → note any durable constraint (rate limits, caching, API quirks) → move on more robust.

## Layout

```
app/            # Next.js routes (pages + API)
lib/agent/      # the pipeline: reasoning (digest/writer/evaluator) + deterministic gates
lib/            # kv, scraper (cached), pubmed, rate-limit, admin-auth
evals/          # corpus harness (anonymized labels committed; raw bodies gitignored)
middleware.ts   # whole-app password gate (SITE_PASSWORD), no-op when unset
.tmp/           # disposable: local KV store + scrape cache. Regenerated as needed.
.env            # API keys (NEVER store secrets elsewhere)
```

Stay pragmatic. Gate with code, steer with prompts, verify before you claim it works.
