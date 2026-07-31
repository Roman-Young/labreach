# LabReach ingestion — cost model & operating rules

Written after the first full UCSD batch (340/370 labs) cost ~$22 of Gemini against a ~$7
estimate — a 3× miss. This documents *why*, so it never happens at scale.

## Per-call cost (measured)

Extraction uses **gemini-2.5-flash** with a ~130k-char bundle. Real usage (measured,
worst-case paper-rich lab): **~28k input tokens, ~4–5k output tokens.**

| | tokens | rate (per 1M) | $/lab |
|---|---|---|---|
| input | ~28k | $0.30 | ~$0.008 |
| output | ~5k | $2.50 | ~$0.013 |
| **per successful call** | | | **~$0.02** |

Thinking is **off** (`generationConfig.thinkingConfig.thinkingBudget = 0`; the v0.24.1 SDK
forwards `generationConfig` verbatim, so it applies). `extract2.ts` logs `[usage] in=… out=…
thoughts=…` per call — grep it from any run to confirm and to get real numbers. **`thoughts`
should read 0.**

## The real cost driver: attempt multiplicity

The $0.02/lab base rate was correct. The 3× miss came from assuming **1 call = 1 lab**. In
reality the batch made **~2–3 billed calls per lab**:

- **A client-side timeout still bills.** Gemini generates the full output before our
  `Promise.race` timeout fires; we discard the result but pay for it.
- **Every failed lab + every retry sweep re-bills.**
- **Diagnostic/dev runs bill** (canary, probes, cost tests…).

So the model is:

> **cost ≈ (labs) × (attempts/lab) × ($0.02)**, where **attempts/lab ≈ 1.1 in a calm Gemini
> window, but 2–3 during a load/outage window.**

Running a batch during a bad Gemini window is the single biggest way to overspend.

## Controls (in code / operating rules)

1. **Circuit breaker** (`scripts/ingest.ts` `run`): if ≥8 of the last 10 labs fail, the run
   aborts and leaves the rest `pending` — no calls, no spend. Resume with `--retry-failed`
   when Gemini is healthy. This kills the outage bleed.
2. **Run in a calm window.** Don't retry-storm into 503s — that's pure waste.
3. **Instrumentation.** `[usage]` lines give real per-call cost. Budget from measured
   numbers, not estimates.
4. **Frugal diagnostics.** Validate on 1–2 labs, reuse cached `raw_pages` via `reextract`
   (no Firecrawl / no re-gather), don't re-run 15-lab canaries casually.

## Embedding cost (T87)

`gemini-embedding-001`, 768-dim, `~$0.15 / 1M` input tokens. ~6,500 chunks × ~150 tokens ≈
**~$0.15–1.00 total.** Negligible. (`ingest.ts embed` logs an estimate per batch.)

## Scaling projection (T99 expansion)

For an N-lab batch, **calm window + circuit breaker**:

| N labs | ~attempts | est. Gemini |
|---|---|---|
| 370 (UCSD, done) | ~2.5 (no breaker, bad windows) | ~$22 actual |
| 370 (calm, breaker) | ~1.1 | **~$8** |
| 1,500 | ~1.1 | ~$33 |
| 3,000 | ~1.1 | ~$66 |

Without the breaker, a bad window can 2–3× these. **Always: measure one lab first, run in a
calm window, keep the breaker on, and top up to the projected number + ~30% headroom.**

## Pre-batch checklist

1. Confirm Gemini is calm: `run --limit 1`, read the `[usage]` line and that it succeeds fast.
2. Project cost = labs × 1.2 × per-call (from step 1).
3. Top up to projection + 30%.
4. Run with the circuit breaker (default) at concurrency 3.
5. One `--retry-failed` sweep in a calm window for the tail.
