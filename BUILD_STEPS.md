# LabReach — Phase C Build Steps (the logistical checklist)

Companion to `PHASE_C_SPEC.md` (the *what/why*). This is the *do-this-then-this*.
**Product:** a per-lab **research digest at scale** (not a SEND/MAYBE/SKIP screen). Ranker is an
optional sort; `writer.ts` is untouched (it's the later optional layer). Structured fields +
code ranker; RAG feeds relevance/content. **DB-first**, biology pilot.
Legend: **[OWNER]** = only Roman (infra/login/human data). **[AGENT]** = Kairo can build it.
**[GATE]** = must pass before the next thing.

---

## Track 0 — Owner unblocks (day 1, parallel; waits, not work)

- [ ] **0.1 [OWNER]** Provision **Postgres + pgvector** (Neon free tier / Vercel Postgres). *Done when:* a connection string exists.
- [ ] **0.2 [OWNER]** Put the connection string in Vercel env **and** local `.env`; while there, finish **T65** (wire `labreach-kv` to the project so its env vars reach production). *Done when:* DB + KV env vars exist in Vercel, not just locally.
- [ ] **0.3 [OWNER]** Assemble the **Year-2 corpus as data** → `evals/corpus/year2.json` (12 labs: name+URL, the Year-2 profile, each reply outcome — the 8 no-replies, the 2 replies). *Done when:* a 12-row file exists. Gates the ranker sanity check (Step 6).
- [ ] **0.4 [OWNER]** Approve the one-time **Firecrawl ingestion budget** after the agent's estimate (Step 4.0). *Done when:* "yes, spend up to $X."

---

## Step 1 — Extend extraction  [AGENT] (needed before ingestion)

The current `finish` schema (`lib/agent/tools.ts`) extracts only writer-facing evidence. The
ranker and the honest digest need three signals it does **not** capture:

- [ ] **1.1** Add to the `finish` schema: `data_modality` (wet/dry/mixed), `team_composition` (roles on the team page), `recruiting_signal` (quoted, incl. the explicit **"no undergrads"** flag). Each quote-backed or `null`.
- [ ] **1.2** Update research guidance (`lib/agent/prompts.ts`) so the loop fetches the **team** and **join-us/positions** pages, not just homepage + papers.
- [ ] **1.3** Consider raising the per-session tool limits (currently 5 webpage / 2 abstract / 2 paper in `tools.ts`) — ingestion pays once and wants depth.
- [ ] **Step 1 [GATE]** On a couple of labs, the new fields populate with real quotes. Commit.

---

## Step 2 — `researchLab()` refactor  [AGENT] (the one real code risk)

- [ ] **2.1** Extract a `researchLab(request)` from `runAgent()` (`lib/agent/index.ts`) that runs the Gemini tool-loop through `finish` and returns the extracted `AgentResult` **without** calling `writeEmail`.
- [ ] **2.2** Refactor `runAgent` to call `researchLab()` then its existing writer/evaluator, so the **live email path behaves identically**.
- [ ] **Step 2 [GATE]** Generate one email end-to-end via `/draft`; output is equivalent to pre-refactor. This is the correctness bar. Commit.

---

## Step 3 — DB layer  [AGENT]

- [ ] **3.1** Add `LabProfile` to `types/index.ts`: identity (PI name/title/email, division, URL) + the quote-backed fields from Step 1 (`findings[]`, `dataModality`, `teamComposition`, `recruitingSignal`, `lastRefreshed`).
- [ ] **3.2** Add `lib/db.ts` (mirror `lib/kv.ts`) + a `lab_profiles` migration: JSONB for the quote-backed fields, top-level columns for filters (`division`, `data_modality`, `recruiting`, `last_refreshed`), and a column for the **raw harvested text** (the cache that kills re-scraping).
- [ ] **3.3** Add DB env vars to `.env.example`.
- [ ] **Step 3 [GATE]** DB round-trips a write/read from the app. Commit.

---

## Step 4 — Enumerate + ingest  [AGENT] (+0.4 for the batch)  ← THE PRIORITY

- [ ] **4.0 [AGENT]** Estimate the ingestion budget (# bio labs × pages+papers × Firecrawl unit cost); hand it to **0.4**.
- [ ] **4.1** `mapToLabProfile(agentResult)` — evidence → `LabProfile`, preserving every quote+source (no quote → `null`).
- [ ] **4.2** Directory enumerator: UCSD biology/biomedical faculty directory → `{labName, labUrl, piName, piEmail}` list (directory expansion — the approved discovery method).
- [ ] **4.3** Offline, resumable, KV-cached batch script (`scripts/ingest.ts`): each lab → `researchLab()` → `mapToLabProfile()` → upsert to Postgres (store the raw text too). Reuse `lib/scraper.ts`, `lib/pubmed.ts` unchanged.
- [ ] **4.4 [GATE]** **Ingest the 12 corpus labs first**, then spot-check ~20: quotes real + sourced, modality/team/recruiting populated where the page supports them. Tune the `finish` prompt until you'd trust the profiles. **Do not batch until this looks right** — the step that overruns.
- [ ] **4.5 [OWNER→AGENT]** With budget approved, run the **full bio division**. *Done when:* every enumerated bio lab has a stored profile (minus logged failures).

---

## Step 5 — The research digest + serving  [AGENT]  ← THE PRODUCT

- [ ] **5.1** New `app/api/digest/route.ts` (UCSD DB path; the general pasted-URL `app/api/research` cold path stays). Model auth/rate-limit on `app/api/research/route.ts`.
- [ ] **5.2** For a submitted student profile: RAG-retrieve each lab's most relevant quote-backed findings, compose a readable **per-lab digest**, **bar labs that explicitly say "no undergrads"**, show everything else. No writing.
- [ ] **5.3** A digest-feed UX page: fast, scannable, quote-backed. This is the thing that has to feel good.
- [ ] **Step 5 [GATE]** Submit a profile → a clean, relevance-ordered, quote-backed digest per real UCSD bio lab, explicit-no labs barred. Commit.

---

## Step 6 — Optional ranker + its sanity check  [AGENT, needs 0.3]

- [ ] **6.1** Pure functions: `computeCredibilityTier(profile)`, connection typing, `scoreLab(profile, lab)`, `rankLabs(profile, labs[])` (Postgres pre-filter). `score = Σ(type_weight × strength) × modality_multiplier`; `recruiting == explicit-no → barred`.
- [ ] **6.2** Weights: hand-set priors from the findings → calibrate against the 53-corpus with the **0-for-8 ordering** as objective → logistic regression on the 53 as a regularized cross-check only (n=53: calibrate, don't freely learn).
- [ ] **6.3** Expose ranking as an **optional sort** on the digest feed — never a filter (only explicit-no bars a lab).
- [ ] **6.4 [GATE / sanity check]** Over the 12 corpus labs: the 8 admiration labs sink, the 2 repliers rise. This validates the *ranker*, and is **not** the product's success bar.

---

## Dependency order at a glance

```
Day 1:  0.1 0.2 0.3 0.4-estimate     ∥     Step 1 (extend extraction)
then:   Step 2 (researchLab, GATE: live path unchanged) → Step 3 (DB)
then:   Step 4.1-4.4 (enumerate, ingest 12 corpus + 20 spot, GATE) → [0.4] → 4.5 full batch
then:   Step 5 (digest + UX, GATE)  →  Step 6 (optional ranker + 0-for-8 sanity)
```

**Critical path:** `Step 1 → Step 2 → Step 4.4 → Step 5`. The two owner items that silently
stall it: **0.1/0.2** (no DB = nothing stores) and **0.3** (no corpus = no ranker sanity check).
Do them day 1.

**If it slips:** protect **Step 4** (the DB + ingestion) and **Step 5** (the digest). The
optional ranker (Step 6) can follow later without blocking the product.

**Out of scope this phase:** any change to `writer.ts` (the later optional layer); vector
retrieval beyond the Step-5 relevance step; divisions beyond biology; LLM-judge ranking.
</content>
