# LabReach — Phase C Build Steps (the logistical checklist)

Companion to `PHASE_C_SPEC.md` (the *what/why*). This is the *do-this-then-this*.
Scope: the 2-week **Option B** sprint (DB + SEND/MAYBE/SKIP screen; `writer.ts` untouched).
Legend: **[OWNER]** = only Roman can do it (infra/login/human data). **[AGENT]** = Kairo can build it. **[GATE]** = must pass before the next thing starts.

---

## Track 0 — Unblock in parallel (do these FIRST; they are waits, not work)

These have no code dependencies and gate the coding tracks, so start them on day 1.

- [ ] **0.1 [OWNER]** Provision a **Postgres + pgvector** instance (Neon free tier or Vercel Postgres). *Done when:* you have a connection string.
- [ ] **0.2 [OWNER]** Put the DB connection string in the Vercel project's env **and** local `.env`, and while there, finish the **T65** step — connect `labreach-kv` to the project so `KV_REST_API_URL`/`KV_REST_API_TOKEN` reach production. *Done when:* both DB and KV env vars exist in Vercel, not just locally.
- [ ] **0.3 [OWNER]** Assemble the **Year-2 corpus as data** (task **T79**). From your sent mail, list the 12 Year-2 labs: lab name + URL, the Year-2 student profile you used, and each reply outcome (the 8 no-replies, the 2 replies). Drop it as `evals/corpus/year2.json`. *Done when:* a 12-row file exists. **This gates C.3 entirely.**
- [ ] **0.4 [OWNER]** Approve the one-time **Firecrawl ingestion budget** — after **[AGENT]** produces the estimate (step C.1.0). *Done when:* you've said "yes, spend up to $X."

---

## Phase C.0 — Schema & scaffolding  [AGENT]

- [ ] **C.0.1** Define the `LabProfile` type in `types/index.ts`. Fields, each with a `{quote, source}` or `null`: `piName`, `piTitle`, `piEmail`, `department`, `division`, `researchSummary`, `dataModalities` (the wet/dry signal), `recentFindings[]` (from papers), `teamComposition` (for complementarity inference), `recruitingSignal`, `labUrl`, `lastRefreshed`.
- [ ] **C.0.2** Create `lib/db.ts` — a thin Postgres client (mirror the shape of `lib/kv.ts`). Add a migration creating a `lab_profiles` table (JSONB for the quote-backed fields + top-level columns for what you filter on: `division`, `data_modality`, `recruiting`, `last_refreshed`).
- [ ] **C.0.3** Add the new env vars to `.env.example`.
- [ ] **C.0 [GATE]** DB reachable from the app (a trivial write/read round-trips). Commit.

---

## Phase C.1 — Ingestion pipeline  ← THE PRIORITY  [AGENT] (+0.4 for the batch)

- [ ] **C.1.0 [AGENT]** Estimate the ingestion budget: (# bio labs) × (pages+papers per lab) × Firecrawl unit cost. Hand the number to **0.4**.
- [ ] **C.1.1** **Extract `researchLab()` from `runAgent()`** (`lib/agent/index.ts`). It runs the existing Gemini tool-loop through `finish` and returns the `AgentResult` **evidence + PI info** — and **stops before `writeEmail`**. Refactor `runAgent` to call `researchLab()` then its existing writer/evaluator, so the **live path behaves identically**. *Done when:* one live email still generates unchanged.
- [ ] **C.1.2** Write `mapToLabProfile(agentResult)` — turn the extracted evidence into a `LabProfile`, preserving every quote+source. No quote → `null`.
- [ ] **C.1.3** Write the **directory enumerator**: given the UCSD biology/biomedical faculty-directory URL(s), scrape them into a list of `{labName, labUrl, piName, piEmail}`. This is directory expansion — the design's approved alternative to citation-ranked discovery.
- [ ] **C.1.4** Write the **batch script** (`optimization/ingest/` or `scripts/ingest.ts`, offline — never on the request path): for each enumerated lab → `researchLab()` → `mapToLabProfile()` → upsert into Postgres. Make it **resumable** (skip labs already stored) and **KV-cached** so a re-run doesn't re-scrape. Consider raising the per-lab tool limits (currently 5 webpage / 2 abstract / 2 paper) since ingestion pays once and wants depth.
- [ ] **C.1.5 [GATE]** Run on **~20 labs only**. Spot-check: are the quotes real, specific, correctly sourced? Tune the extraction prompt (`lib/agent/tools.ts` `finish` description) until you'd trust the profiles. **Do not batch until this looks right** — this is the step that overruns.
- [ ] **C.1.6 [OWNER→AGENT]** With budget approved (0.4), run the **full bio division**. *Done when:* every enumerated bio lab has a stored `LabProfile`; row count matches the enumeration minus logged failures.

---

## Phase C.2 — Fit ranker = the Option B screen  [AGENT]

- [ ] **C.2.1** `computeCredibilityTier(profile): 0|1|2|3` — in code, from `StudentProfile`. Pure function, unit-tested.
- [ ] **C.2.2** `computeModalityFit(profile, labProfile)` — wet/dry match; a mismatch with no complementarity signal returns a SKIP-forcing result.
- [ ] **C.2.3** `scoreLab(profile, labProfile)` — combine domain overlap, modality fit, complementarity, level, recruiting signal → `{verdict: SEND|MAYBE|SKIP, reason}` (one-line reason, quote-referenced where possible).
- [ ] **C.2.4** `rankLabs(profile, labProfiles[])` → sorted verdicts. Pull `labProfiles` from Postgres with the structured pre-filter (division, etc.), not a full-table scan.
- [ ] **C.2.5** Expose it: `/api/screen` (POST profile → ranked verdicts) + a minimal results page. **No writing.** The SKIP list is the visible product.
- [ ] **C.2 [GATE]** End-to-end: submit a profile, get SEND/MAYBE/SKIP + reasons over real UCSD bio labs. Commit.

---

## Phase C.3 — The 0-for-8 critical test  [AGENT, needs 0.3]  [GATE for Option C]

- [ ] **C.3.1** Load `evals/corpus/year2.json` (from **0.3**).
- [ ] **C.3.2** Run `rankLabs()` on the 12 Year-2 labs + Year-2 profile, **blind** to the outcomes.
- [ ] **C.3.3** Compare: did it mark the **8** admiration labs SKIP/MAYBE and the **2** repliers SEND? Write it up as a repeatable eval (so you can re-run after tuning).
- [ ] **C.3.4** Tune the scoring weights/thresholds until the split reproduces — or conclude the model is wrong and stop, which is the test doing its job.
- [ ] **C.3 [GATE]** The split reproduces. **This is the sprint's definition of success**, and the green light for Option C (the writer re-integration, T77) later.

---

## The dependency order at a glance

```
Day 1:  0.1 0.2 0.3 0.4-estimate   +   C.0.1 C.0.2 C.0.3    (owner waits ∥ agent scaffolds)
then:   C.1.1 → C.1.2 → C.1.3 → C.1.4 → C.1.5(GATE, ~20 labs) → [0.4 approve] → C.1.6(full batch)
then:   C.2.1 C.2.2 → C.2.3 → C.2.4 → C.2.5(GATE)
then:   C.3 (needs 0.3 done)  →  GATE: 0-for-8 reproduces  →  sprint done
```

**Critical path** (the thing that determines the finish date): `C.1.1 → C.1.5 → C.1.6 → C.2 → C.3`. The two owner items that can silently stall it are **0.1/0.2** (no DB = nothing stores) and **0.3** (no corpus = C.3 can't run). Do those on day 1.

**If the sprint slips:** protect **C.1** (the DB) — it's the priority and survives any later design change. C.2/C.3 can follow into a third week without waste.
</content>
