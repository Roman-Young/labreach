# LabReach — Phase C: UCSD Warm Corpus + Fit-Ranking Screen

**Status:** design, approved 2026-07-25.
**End goal:** Option C (DB-backed screen + subordinated writer).
**Next 2 weeks:** build **Option B well** — the DB + the SEND/MAYBE/SKIP screen, standalone, *no writer wiring yet*.
**Audience:** Claude Code / any agent working in this repo.
**Author's note:** Written *against the actual code on `main` as of 2026-07-25*, not the aspirational orientation doc. "Existing" = in the repo today. "New" = not yet. Read the named files before building, and if reality has moved, follow the code and say so in the commit message.

---

## 0. Why this exists — the reconciliation

The orientation doc (`../my-context/reference/labreach.md`) describes a product that **never writes the email**, whose spine is a **fit ranker** emitting SEND / MAYBE / SKIP. The code on `main` is the opposite: a per-lab pipeline that **researches → writes a finished draft → evaluates and rewrites it** (`lib/agent/index.ts`, `runAgent()`), plus a GEPA harness that optimizes the *writing* prompt. There is no fit ranker, no SEND/MAYBE/SKIP, and no credibility-tier gate in the code today.

**The plan reconciles these in two moves:**

- **End goal — Option C:** a **DB-backed fit-ranking screen** decides SEND / MAYBE / SKIP per lab; only for **SEND** labs does the **existing writer** run, producing a **draft the student must be able to defend**, gated by the credibility tier and surfaced with the predicted PI follow-up question.
- **Next 2 weeks — Option B, done well:** build only the **screen** — DB + fit ranker + the critical test. The existing writer is left **untouched and unwired** during this sprint. This gives a standalone, honest product (a SEND/MAYBE/SKIP recommender over real UCSD labs) and, crucially, forces the 0-for-8 critical test to pass *before* any writing logic is layered back on.

**Why this order.** The screen is the part the design says actually determines outcomes, and it's the part that can be *proven wrong cheaply* (the 0-for-8 test). Building it standalone means we find out if the core thesis holds before spending effort re-integrating the writer. The DB is the priority within the sprint, and it is fork-independent — it's the least wasted effort no matter how the downstream evolves.

---

## 1. Target architecture (Option C) — with the 2-week cut marked

```
[0] STUDENT PROFILE                  existing StudentProfile (types/index.ts)
      -> NEW: compute CREDIBILITY TIER (0-3) in code            [2-WK]
      |
[1] CANDIDATE LABS
      UCSD path:  pull from the warm DB                          [2-WK]  <-- the evolution
      general path: pasted lab URL (EXISTING cold path)
      |
[2] HARVEST + EXTRACT -> LabProfile (quote-backed)
      UCSD path:  pre-computed, read from DB (NEW ingestion job) [2-WK]
      general path: live, existing loop (tools.ts/scraper.ts/pubmed.ts)
      |
[3] FIT RANKING  <<< THE SPINE >>>                               [2-WK]
      domain overlap, MODALITY FIT, complementarity, level, recruiting
      -> SEND / MAYBE / SKIP + one-line reason
      |
      ===== 2-WEEK SPRINT ENDS HERE (Option B). Product = the screen. =====
      |
[4] FOR SEND LABS ONLY  (Option C, AFTER the sprint)
      EXISTING writer (writer.ts) fires -> NEW tier gate (code)
      -> NEW predicted PI follow-up question -> EXISTING evaluator loop
      |
[5] OUTCOME LOGGING   extend eval-log with the verdict + reply outcome
```

The fit ranker consumes a `LabProfile` and does not care whether it came from the DB or a live scrape — which is what makes stages [1]–[3] independent of the later writer decision.

---

## 2. Scope discipline (read before enumerating anything)

- **Pilot ONE division: biology / biomedical.** First users are UCSD Bio Cloud students; this bounds the one-time ingestion cost so we measure it before spending credits on physics/chem/med. Scale only after the bio pilot proves out.
- **Verify on ~20 labs before the batch.** Extraction-quality tuning is always the slow part. Get 20 labs producing clean, quote-backed `LabProfile`s you'd trust, then run the division.
- **Do not touch `writer.ts` this sprint.** It stays exactly as is. Re-integrating it is Option C, post-sprint.

---

## 3. The 2-week sprint (Option B + DB)

Four phases. The DB lands first (the priority); the critical test runs as early as possible because it can invalidate the model.

### C.0 — Reconcile & lock the schema  (~1-2 evenings)
- Re-verify §0 against the code at build time.
- Define the `LabProfile` schema — extend `types/index.ts`. Every field carries a verbatim quote + source URL, or is `null` (design principle #2). Minimum fields: PI name/title/email; department/division; research summary (quoted); **data modalities generated** (the wet/dry signal); recent findings (quoted, from papers); team-page composition (for complementarity inference); **recruiting signal** (quoted); lab URL; `last_refreshed`.
- DB tech: **Postgres + pgvector** (one store for structured now, embeddings later — no separate vector DB). Neon or Vercel Postgres.

### C.1 — DB + ingestion pipeline  ← PRIORITY  (~4-6 evenings + one batch run)
- **[Owner infra]** Provision Postgres (+pgvector), connect it to the Vercel project — same class of step as the open **T65** KV gate (env vars must reach production, not just local `.env`).
- Enumerate biology/biomedical labs from UCSD faculty directories (directory expansion — the design's blessed alternative to citation-ranked discovery).
- Reuse the **existing** extraction stack (`lib/agent/tools.ts`, `lib/scraper.ts`, `lib/pubmed.ts`) to harvest each lab into a stored `LabProfile`, as an **offline batch job** (never on the request path).
- Verify on ~20 labs, then batch the division.
- **[Owner]** Approve the one-time Firecrawl budget first — agent gives an estimate (labs × pages × cost) before the batch runs.
- Keep **Upstash KV** as a hot cache in front of the DB.

### C.2 — Fit ranker (the standalone screen = Option B)  (~3-5 evenings)
- Compute **credibility tier (0-3)** from `StudentProfile` in code.
- Structured filter + ranker over `LabProfile`s → **SEND / MAYBE / SKIP + one-line reason**.
- **Modality fit** is first-class: wet-student → dry-lab forces SKIP absent a complementarity claim (the lever that would have killed the 0-for-8).
- Surface this as a simple screen UI/endpoint. No writing. The SKIP list is the point.

### C.3 — The critical test (build alongside C.2; it gates C.4)  (~2-3 evenings + a prerequisite)
- **PREREQUISITE — the corpus does not exist as data yet.** As of 2026-07-25 the 53-email
  corpus lives only as prose in Roman's context files; there is **no `evals/corpus/`
  directory in this repo**, and the orientation doc's reference to that path is aspirational.
  Before this test can run, the **12 Year-2 labs** must be assembled as machine-readable
  data — each lab's identity/URL, the Year-2 student profile, and the known reply outcome
  (replied / no-reply, and the 8-vs-2 split). This is **human work only Roman can do**
  (from his sent mail) and it **gates C.3** entirely.
- With that data: feed the ranker the 12 labs + the Year-2 profile, **blind** to outcomes.
- It must mark the **eight** method-admiration labs SKIP/MAYBE and the **two** that replied SEND. If it can't reproduce the 0-for-8 split from profiles alone, the model of "good target" is wrong. **This is the sprint's success bar.**

**Definition of done for the 2 weeks:** UCSD bio labs ingested into the DB; a fit ranker that returns SEND/MAYBE/SKIP + reason over them; the Year-2 corpus assembled as data and the 0-for-8 critical test passing over it. No writer changes.

---

## 4. After the sprint — Option C (not this sprint)

- **C.4 — Subordinate the writer:** `writeEmail()` fires only for SEND labs; add the **tier gate (code filter)** capping claimable connection types; attach the **predicted PI follow-up question**; the existing evaluator loop still gates draft quality.
- **C.5 — Serving / refresh / scale:** wire the request path to the DB; monthly **refresh cron**; scale ingestion to the other divisions.
- **Vectors, deferred:** add pgvector chunked retrieval only if briefs prove thin, scoped to **within-lab passage selection**, never to lab-level recall. At ~2,000 labs structured retrieval handles recall.

---

## 5. Realistic timeline & risk

The sprint (C.0–C.3) is roughly **10-14 protected deep-work evenings** — i.e. it *fills* the two weeks with nothing to spare. Honest risks: (1) extraction-quality tuning always overruns; (2) it competes with PEPMatch, the Salk/Seurat work, and PHIL 27; (3) the **Claude Max renewal is mid-August** and must not get crowded out. If the two weeks slip, the DB (C.1) is the part to protect — it's the priority and the fork-independent asset.

---

## 6. Tools / infrastructure

| Need | Choice | Notes |
|---|---|---|
| Database | Postgres + **pgvector** (Neon / Vercel Postgres) | One store for structured + (later) vectors |
| Scraping | Firecrawl (existing `lib/scraper.ts`) | Offline ingestion only now, not per request |
| Publications | PubMed / OpenAlex / NCBI efetch (existing `lib/pubmed.ts`) | Free; the extra data depth |
| Hot cache | Upstash KV (existing `lib/kv.ts`) | Keep in front of the DB; resolves the T65 prod-wiring gate |
| Embeddings (post-sprint) | Voyage or OpenAI `text-embedding-3` | Deferred until earned |
| Extraction / rank | Existing Gemini stack | — |
| Batch + refresh | Script + Vercel Cron | One-time run + monthly refresh |

---

## 7. Ground truth & non-negotiables — unchanged

- The 53-email corpus stays the only real scoreboard — **once assembled as data** (see C.3; today it's prose only, not in `evals/corpus/` or anywhere machine-readable). The n≈40 question: **do SEND labs reply more than SKIP labs the student emailed anyway?** The DB makes retrieval cheap; it never becomes the judge — the **fit ranker** decides.
- Nothing enters a `LabProfile` without a verbatim quote + URL (else `null`).
- Never send. No bulk draft export. The SKIP list is a feature, not a failure.
</content>
