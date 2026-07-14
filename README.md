# LabReach

Tools that help an undergraduate cold-email research labs — built around what a corpus
of **53 real cold emails with known reply outcomes** actually shows, not around what
feels like it should work.

## The two tools

**1. Lab Digest** (`/digest`) — the front door. Paste your department's lab page URLs
(one per line). For each lab it reads the page and reports what they work on, their most
recent paper, and the *join logistics* students otherwise dig for — hours expected, which
course mechanism (BILD99/BISP199…), prerequisites, and how the page says to make contact.
Results are sorted toward your stated interests. It surfaces **facts, not a reply
prediction** (see "Why it doesn't rank by predicted replies" below).

**2. The Writer** (`/draft`) — pick a lab and it produces a personalized first draft: a
researcher pulls grounded evidence from the lab's pages and papers, a writer composes the
email, and an evaluator + revision loop tightens it. The draft is framed as a **starting
point you edit until it sounds like you**, then send yourself. LabReach never sends email
and never bulk-exports drafts.

## The evidence, and the falsification

The project owner sent 53 cold emails over two years and knows which got replies. Two
findings from that corpus shaped the whole design:

- **Prose quality did not predict replies.** The best-written emails in the corpus went
  0-for-8 — because they went to the *wrong labs* (a wet-lab student asking dry-lab
  computational PIs to teach him to compute), not because the writing was weak. So the
  Writer is deliberately a starting point, not a polished artifact, and the real leverage
  moved upstream into the Digest.
- **Similarity doesn't separate repliers from non-repliers.** In the corpus the same
  fields appear on both sides of the reply line (immunology replied *and* was ignored;
  mosquitoes too; dung beetles replied). So the Digest sorts by interest overlap but
  labels it honestly as *closeness to your interests* — never "most likely to reply."

The `evals/` directory turns the corpus into a runnable check of the first finding — and it
holds up. Scored with LabReach's own evaluator, **no quality axis separates the emails that
got replies from the ones that didn't** (smallest p = 0.24, n = 17 vs 36), and the judge's
holistic *"would a PI respond to this?"* verdict is **0 for 17** on emails that PIs actually
did respond to — including the one that became a real job.

That's the project's premise falsified by its own data, using its own judge as the
instrument. It is exactly why the leverage moved upstream into the Digest and why the writer's
output is presented as a draft to edit rather than a graded artifact. Full numbers and caveats:
**[evals/RESULTS.md](evals/RESULTS.md)**.

## Setup

```bash
npm install
cp .env.example .env      # fill in the keys below
npm run dev               # http://localhost:3000
```

Required keys (`.env`):

- `GOOGLE_AI_API_KEY` — Gemini (research, evaluator, digest). Free tier works.
- `FIRECRAWL_API_KEY` — scraping lab pages. Free tier: 1,000 credits/mo; the digest costs
  1 credit per lab and caches scrapes to `.tmp/` so re-runs are free.
- `ANTHROPIC_API_KEY` — Claude (the writer). Paid.
- `ADMIN_PASSWORD` — gates `/admin` and the eval endpoints.

Storage and the whole-app gate are optional locally; see `.env.example`.

## Deploying (behind a password, on your keys)

The app runs off the local-JSON store by default. To deploy it as a private URL friends
can use with no setup:

1. Provision **Upstash Redis** from the Vercel Marketplace (free tier) — it sets
   `KV_REST_API_URL` / `KV_REST_API_TOKEN`, which `lib/kv.ts` uses automatically.
2. Set **`SITE_PASSWORD`** — `middleware.ts` then requires it (HTTP Basic Auth) on every
   route, so only people you share it with can use the app and spend your API credits.
3. Set the three API keys + `ADMIN_PASSWORD` in the Vercel project and deploy.

## Architecture

Next.js (App Router) + TypeScript. The pipeline separates probabilistic reasoning from
deterministic checks:

- `lib/agent/` — `digest.ts` (the digest), `index.ts` (the research→write→evaluate→revise
  orchestrator), `writer.ts`, `evaluator.ts`, and the code-level gates: `grounding.ts`
  (drops any evidence quote not found verbatim in a fetched page), `prohibitions.ts`,
  `structure-check.ts`.
- `app/` — `/digest`, `/draft`, and admin/calibration surfaces.
- `evals/` — the corpus harness.

## What this reply-rate work can and can't show

A planned experiment logs which composition each email used and whether it got a reply.
Be honest about the power: with a handful of friends over a semester that's ~15–20 emails
per arm, which can detect a *catastrophe* (one approach converting near zero) but **not**
a modest difference (e.g. 32% vs 20% would need ~200 per arm). The corpus eval in `evals/`
is the sturdier claim; the live reply data is a directional signal, not a verdict.
