# Retrieval design decisions + evidence (2026-08-20)

Roman's calls, and what the eval evidence does/doesn't yet support.

## SETTLED — shipped

**Input shape: `{interests[], resume}`, not one prose blob.** `distillProfile` prepends interests
VERBATIM (no LLM) and LLM-condenses the resume; it deliberately drops stated aspirations from resume
prose ("I want to study X" is not experience). The first eval passed everything as `resume`, so it
measured a query the product never builds. Fixed. Mechanism-verified, not just a number: p01 Kersten
#20→#1, Hui #22→#6 with zero retrieval-code change. Mean Recall@20 68.3% → 73.9%.

**Eval match rule: intent must match (Roman).** A lab that merely uses the student's technique as a
TOOL for a different question is NOT a good match. Mali (CRISPR *screens* for functional genomics)
removed from p02's key — retrieval is correct to rank her low. Keyword overlap ≠ intent overlap.

## DECIDED, NOT YET BUILT — needs a bigger sample first

**Two-sided presentation (interests vs experience).** Roman: show labs matching EITHER, tagged so the
student sees WHY ("matches your interest" / "matches your skills"). This is additive presentation,
not a ranking gamble — safe to build independent of the decomposition question. Arm attribution
falls out of the fan-out for free (we already log which sub-query matched each lab).

**Mild recency boost.** Roman: a 2025-26 matching paper should outrank an equally-matching 2021 one
(better cold emails, favors labs active in the area now). Small change to lab aggregation:
`score = Σ rrf_i · decay^i · recency(year)`. UNVALIDATED — hold until the golden set is bigger.

## OPEN — evidence says DON'T ship yet

**Per-interest decomposition.** Fan out one sub-query per interest + one for experience, union by RRF.

- *Latency: a non-issue.* 1 embed 397ms · 4 serial 1020ms · **4 PARALLEL 274ms**. Capping interests
  at 3 makes it a bounded 4-way `Promise.all` ≈ the cost of one call. Roman's instinct was right.
- *But recall gain is inside the noise.* Recall@20 over 18 gold labs, 2 profiles:
  | scoring | p01 | p02 | total |
  |---|---|---|---|
  | blended (today) | 7/10 | 5/8 | **12/18** |
  | sum across arms | 7/10 | 4/8 | 11/18 |
  | max arm | 8/10 | 5/8 | **13/18** |
  | decay-weighted arms | 8/10 | 5/8 | **13/18** |
- *Sum-across-arms is actively wrong* — it rewards labs matching every interest a little and buries
  specialists (Komor, THE base-editing lab, fell out of top-20; Boddy who hit all 4 arms went #1).
  Same "breadth beats bullseye" failure `retrieve.ts` already solves at the chunk level with decay.
  If we ever decompose, score by BEST arm (max/decay), never sum.
- *No mode dominates.* max and decay recover DIFFERENT labs (max gets Komor+Weiskopf but loses Kaech
  and Kadonaga; decay keeps those but loses Komor). 13/18 vs 12/18 on two profiles is one lab of
  difference — not a result.
- **Verdict: do not ship a ranking change on n=2 profiles.** Label ~10-12 profiles, then re-run this
  shootout. Shipping on this evidence would be exactly the eyeballing the eval exists to replace.

**Klemke is missed by every mode** (blended, sum, max, decay) — a `paper`-hook match buried in a
thematically divergent lab. If paper-hook recall stays low across a bigger sample, that's the case
for chunk-level surfacing, not query decomposition.

## Method note

Bench scripts: `scripts/_bench_decomp.mjs` (latency + naive union), `_bench_decomp2.mjs` (scoring
shootout), `_diag_miss.mjs` (per-lab miss trace: distilled query → chunk rank → lab rank). Temp/
untracked; re-run or delete freely.
