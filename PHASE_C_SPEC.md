# LabReach — Phase C Spec: UCSD Research Accelerator

**Status:** design, approved 2026-07-25. **Supersedes** the earlier SEND/MAYBE/SKIP framing
of this file (that framing is retired — see §1).
**Audience:** Claude Code / any agent working in this repo.
**Companion:** `BUILD_STEPS.md` (the ordered implementation checklist). This file is the
*what & why*; that file is the *do-this-then-this*.
**Author's note:** Written against the actual code on `main` as of 2026-07-25. "Existing" =
in the repo today; "new" = not yet. Read the named files before building, and if reality has
moved, follow the code and say so in the commit message.

---

## 1. What this is — the product thesis

**LabReach is a research accelerator, not a target selector.** The bottleneck in cold-emailing
labs is the 30–60 minutes of research *per lab* (read the faculty page, research page,
publications, team page, recent papers, then figure out what actually connects). LabReach
removes that tax at scale: it pre-researches UCSD labs once, caches everything, and on request
hands the student a **substantiated, quote-backed, relevance-ranked research digest per lab** —
readable in ~30 seconds — so they can email **as many labs as they want**, each with something
real to say.

Concretely:
- **The core product is the per-lab research digest.** For every lab a student is considering:
  the lab's actual findings/discoveries (verbatim quotes + sources), filtered and ordered by
  relevance to *this* student's interests/experience, presented in a clean UX.
- **Volume is a feature, not a risk to suppress.** The tool helps a student send *many*
  emails cheaply, because the DB drives per-email research cost toward zero.
- **The only hard bar is an explicit "no undergrads."** A lab that says it doesn't take
  undergraduates is excluded even if it's a great fit. Nothing else is hidden.
- **The ranker is an optional prioritization layer,** not a gate. For a student with limited
  time who only wants to send a few, it orders labs "start here first." It never removes a lab
  from view (except the explicit-no bar above).
- **The writer is a later, optional, downstream add-on.** The existing `writer.ts` becomes
  exactly this — it is **not touched** in this phase.

---

## 2. Why this framing (the reasoning, so it isn't relitigated)

This repositioning updates — not ignores — the corpus evidence (the 53-email dataset, the
0-for-8 modality finding). Two arguments carry it:

1. **The DB deletes the cost the anti-volume argument was built on.** "Send 20 well-targeted,
   get 8 beats send 100 scattershot, get 10" assumed each email costs ~45 min of research.
   That's *why* per-send conversion beat raw volume. Once research cost is ~0, the calculus
   shifts: a lower reply *rate* over far more sends can win on absolute replies, and one yes
   changes a trajectory. We're changing the variable the evidence was conditioned on, not
   denying it.
2. **A research-only tool dodges the real volume risk.** The dangerous failure mode — PIs
   blacklisting mass-emailers, "cold email is dead in sales" — attaches to tools that
   *generate and blast finished emails* (Apollo/Instantly/Lavender). LabReach does mass
   *research*; the **student still writes and sends each email themselves.** That is the
   design line that separates "a great research assistant" from "a spam cannon." Keeping the
   writer optional and downstream is what protects it.

**The one thing that does NOT change:** modality mismatch still gets zero replies (the
0-for-8 were the best-written, most-connected emails in the corpus, to dry labs from a wet
student — all failed). So modality and connection *type* stay inside the **ranker's math**
(§5). The ranker's whole job is "if you're short on time, start here," and if it ordered by
raw similarity it would send time-constrained students to the 0-for-8 *first*. The ranker is
optional; its correctness is not.

**Systemic guardrail to remember:** if adoption gets large, hundreds of students mass-emailing
the same ~2,000 labs could flood PIs and degrade the channel. The mitigation is baked into the
design — real per-lab research + student-authored emails, never generated blasts.

---

## 3. Architecture

```
INGESTION (offline, once per lab, refreshed monthly)
  enumerate UCSD labs (directory expansion)
    -> harvest: lab pages (home/research/TEAM/join-us) + papers (PubMed/efetch)
    -> store RAW TEXT (the cache)                                  [kills re-scraping]
    -> LLM extract -> structured LabProfile (quote-backed)         [what the ranker needs]
    -> (optional) embed papers/chunks                              [what RAG retrieves over]
  ================= everything above is stored in Postgres =================

ON REQUEST (fast, no scraping)
  student profile (private, per-user, NOT in shared DB)
    -> RAG: retrieve the lab's findings most RELEVANT to this student   (similarity OK here)
    -> compose the RESEARCH DIGEST per lab  <<< THE PRODUCT >>>
    -> bar labs that explicitly say "no undergrads"
    -> (optional) RANKER sorts the digests by reply-likelihood         (structured fields)
    -> (later, optional) WRITER drafts from the digest                 (existing writer.ts)
```

RAG feeds **relevance and content**; the structured fields feed the **ranker**. They are two
inputs, because the signals that predict replies (modality, complementarity-from-absence,
recruiting) are exactly the ones similarity search cannot see.

---

## 4. What lives in the database (concrete, per lab)

Stored once, refreshed monthly:

1. **Identity:** PI name, title, email; department/division; lab URL.
2. **Raw cache (the expensive stuff):** scraped markdown of the lab's pages (home, research,
   **team**, **join-us/positions**) + fetched paper abstracts / full text. This is what makes
   per-request serving free — we never re-scrape per student.
3. **Structured `LabProfile` (extracted from the cache, quote-backed or `null`):**
   - `findings[]` — verbatim quotes of actual discoveries/claims, each with source.
   - `dataModality` — wet / dry / mixed (the top predictive signal after domain; invisible to
     similarity).
   - `teamComposition` — roles seen on the team page (basis for complementarity inference).
   - `recruitingSignal` — quoted; includes the **explicit "no undergrads"** flag (the one hard
     bar).
   - `lastRefreshed`.
4. **(Optional, deferred) embeddings** of papers/chunks for RAG relevance retrieval.

The **student profile is never in this shared DB** — it's PII, held per-user, private.

---

## 5. The ranker (optional prioritization layer)

**Role:** a time-allocation advisor. It never hides a lab (only the explicit-no bar does). It
orders the digests so "start at the top" means "highest reply-likelihood," not "most similar."

**Scoring shape (structured fields + code — no LLM in the verdict):**
```
score(student, lab) = Σ_connections ( type_weight × strength ) × modality_multiplier
hard rule: recruiting == "explicit no undergrads"  -> barred (excluded, not scored)
```
- **Connection types, in descending weight:** complementarity > method/data/tool > system >
  problem > trajectory. This ordering — not raw connection *count* — is what separated the
  corpus replies from the non-replies. (The 0-for-8 had the *most* connections; they were the
  wrong type.)
- **`modality_multiplier`** heavily discounts a wet-student→dry-lab mismatch with no
  complementarity claim. It sinks such labs in the ranking; it does **not** remove them.

**How the weights are set — honestly, given n=53:**
1. **Hand-set priors from the findings** (modality dominant, complementarity highest, raw
   similarity weak). Read off two years of outcomes, not guessed.
2. **Calibrate against the corpus with the 0-for-8 as the objective:** tune weights until the
   12 held-out Year-2 labs order correctly (the 8 admiration labs sink, the 2 repliers rise).
3. **Logistic regression on the 53 as a cross-check only** — heavy regularization, ≤3–4
   features. At n=53 you *calibrate* weights, you don't freely *learn* them (unconstrained
   fitting to 53 correlated points produces confident garbage — the same small-sample trap
   that makes citation-ranked discovery fail). If it independently up-weights modality, that's
   confirmation; if it disagrees wildly, the sample is too thin to trust.

**The 0-for-8 test is demoted:** it is no longer the product's success bar (the product
succeeds by delivering fast, trustworthy research). It is the **sanity check on the ranker's
ordering** — does the optional "start here" list put repliers above admiration-traps?

---

## 6. Structured fields + code ranker vs an LLM judge — decided

**Decision: structured fields + code ranker.** Rationale, across the axes we weighed:
- **Cost:** structured extraction is paid *once per lab*, then serving is ~free. An
  LLM-judge-per-query would re-introduce a recurring per-lab-per-user bill — the exact
  per-call cost the DB exists to kill.
- **Testability:** a code ranker reproduces the 0-for-8 ordering deterministically and is
  unit-testable; a stochastic LLM judge is hard to calibrate and drifts.
- **Failure mode:** an LLM judging off RAG-retrieved (similarity-selected) text is prone to
  being seduced by topically-similar papers — the 0-for-8 risk.

**But don't over-structure.** Schematize only the few signals that are (a) decision-critical
and (b) invisible to similarity — **modality, recruiting, team composition.** Everything soft
(domain relevance, the digest content, later the writing) stays with LLM + RAG, where
flexibility helps and rigidity would hurt.

---

## 7. Code changes this phase

1. **Extend extraction** (`lib/agent/tools.ts`, the `finish` tool schema): add
   `data_modality`, `team_composition`, `recruiting_signal` (each quote-backed or null).
   Update research guidance (`lib/agent/prompts.ts`) to fetch the **team** and
   **join-us/positions** pages, not just homepage + papers. Consider raising the per-session
   tool limits (currently 5 webpage / 2 abstract / 2 paper) since ingestion pays once and
   wants depth.
2. **`researchLab()` refactor** (`lib/agent/index.ts`): extract the research loop (through
   `finish`) into a function that returns the extracted result **without** calling
   `writeEmail`. `runAgent` then calls `researchLab()` + its existing writer/evaluator, so the
   **live email path behaves identically** (this is the correctness bar for the refactor).
3. **DB layer** (`lib/db.ts`, new — mirror `lib/kv.ts`): Postgres client + `lab_profiles`
   migration (JSONB for quote-backed fields, top-level columns for filter keys: `division`,
   `data_modality`, `recruiting`, `last_refreshed`). Postgres + pgvector (one store).
4. **Ingestion** (`scripts/ingest.ts` or `optimization/ingest/`, new, offline): enumerate →
   `researchLab()` → `mapToLabProfile()` → upsert. Resumable, KV-cached. Reuses
   `lib/scraper.ts` and `lib/pubmed.ts` unchanged.
5. **Serving** (`app/api/research` stays for the general cold path; new `app/api/digest` for
   the UCSD DB path): return the per-lab research digest + optional rank. New UX page for the
   digest feed. Model the route on `app/api/research/route.ts` (auth/rate-limit patterns).
6. **Ranker** (new, pure functions): `computeCredibilityTier`, connection typing,
   `scoreLab`, `rankLabs` (pull from Postgres with the structured pre-filter).
7. **`writer.ts` is NOT touched.** It becomes the optional downstream layer, later.

---

## 8. Build order & scope

- **DB-first** (owner's call): populate a demoable UCSD DB before the ranker is proven.
  Mitigation: **ingest the 12 corpus labs first** so the ranker sanity check (§5) can run
  early, before the full-division Firecrawl spend completes.
- **Pilot ONE division: biology/biomedical** (first users = Bio Cloud students). Bound the
  ingestion cost before scaling to physics/chem/med.
- **Verify ~20 labs before the batch** — extraction-quality tuning is the step that overruns.
- Full order and gates: see `BUILD_STEPS.md`.

---

## 9. Success criteria

- **Primary (the product):** over real UCSD bio labs, a student gets a clean, fast,
  quote-backed research digest per lab, ordered by relevance to their profile, with explicit-no
  labs barred. This is the thing that has to feel good.
- **Secondary (the optional ranker):** an optional sort that puts higher-reply-likelihood labs
  first, validated by the 0-for-8 ordering sanity check.

---

## 10. Non-negotiables & out of scope

- Nothing enters a `LabProfile` without a verbatim source quote + URL (else `null`).
- The tool **never sends**, and does **no bulk draft export**.
- The only lab ever hidden is one that **explicitly** declines undergraduates.
- **Out of scope this phase:** any change to `writer.ts` (it's the later optional layer);
  vector retrieval beyond the optional relevance step (pgvector chunked retrieval scoped to
  within-lab passage selection is a later refinement); divisions beyond biology.
</content>
