# LabReach — Implementation Plan: Cheap Re-Eval Endpoint, Calibration Harness, and GEPA Training Pathway

**Audience:** Claude Code, working in the LabReach repository.
**Author's note to the agent:** This plan was written from LabReach's architecture/design document, **not from the actual source code.** Every filename, function name, KV key, and signature below is an *expectation* to verify, not ground truth. In each phase, your first action is to read the real files and reconcile them with what this plan assumes. Where reality differs, follow reality and note the difference in your commit message. Do not invent code to match this document; adapt this document to the code.

---

## 0. Goal and non-goals

**Goal.** Decouple *evaluating* a draft from *generating* one, so that:
1. A previously-logged draft can be re-scored against a (possibly modified) evaluator prompt for the cost of a single Gemini call, with no extraction and no composition.
2. The `/admin/calibrate` flow can hold drafts fixed and compare evaluator-prompt variants against human labels, instead of regenerating a new draft every time.
3. An offline GEPA optimization loop can score hundreds of candidate writer-prompts cheaply, using the calibrated evaluator as its metric, and emit an improved writer prompt string to paste into the app.

**Non-goals for this work.** No fine-tuning. No model training. No new database. No send integration. No change to the student-facing UX except where explicitly noted. We are optimizing prompts and the judge, not weights.

**Sequencing (strict).** Phase 1 (re-eval endpoint) is the keystone and must be built and verified first. Phase 2 (calibration on top of re-eval) depends on Phase 1. Phase 3 (GEPA) depends on a *trustworthy* evaluator, which Phase 2 produces. Do not start a phase until the prior one is committed and working.

---

## 1. Ground rules for this repository work

1. **Git is already initialized** with a baseline commit and a `.gitignore` excluding `.env`. Before any edit, run `git status` and confirm the working tree is clean. If it is not, stop and surface that to the user.
2. **Commit after each self-contained unit of work**, with a descriptive message. One logical change per commit. Never bundle the re-eval endpoint, the calibration change, and the GEPA harness into one commit.
3. **Never break generation.** The public student flow (`/` → `/draft`) must work identically at every commit. After any change that touches the shared evaluation code path, generate one email end-to-end and confirm it still completes before committing.
4. **Read before write.** At the start of each phase, read the actual files named in that phase and confirm the real function signatures, KV keys, and data shapes. Report any mismatch against this plan.
5. **Do not commit secrets.** `.env` stays out of git. If you ever see it staged, stop.
6. **Prefer additive changes.** The refactor in Phase 1 should *extract* an existing capability into a reusable function without changing its behavior in the existing generation path. Existing callers must get identical results.
7. **Ask before destructive or ambiguous changes.** If a required refactor would change the behavior of the live generation pipeline in any observable way, describe the change and get confirmation before proceeding.

---

## 2. Files this plan expects to exist (verify first)

From the design doc, the relevant modules are expected to be:

- `lib/agent/index.ts` — `runAgent()` orchestrator (the 3-stage pipeline)
- `lib/agent/writer.ts` — Stage 2 composition; expected to export something like `writeEmail(...)` taking a `piFeedback` parameter
- `lib/agent/evaluator.ts` — Stage 3 evaluation; the 9 LLM-judged checks in one Gemini call
- `lib/agent/critique.ts` — expected `buildCritique()`
- `lib/agent/prohibitions.ts` — regex AI-tell checks (code, no model call)
- `lib/agent/structure-check.ts` — word/paragraph count checks (code, no model call)
- `lib/agent/eval-log.ts` — writes verdicts to `evaluator:log` in KV
- `lib/kv.ts` — `kvGet` / `kvSet` abstraction
- `lib/admin-auth.ts` — `x-admin-token` / `ADMIN_PASSWORD` check
- `lib/rate-limit.ts` — the 3/hour/IP cap
- App routes under the Next.js `app/` (or `pages/`) directory, including `/api/research` and the admin surfaces `/admin`, `/admin/calibrate`, `/train`

**First task, before writing anything:** open each of these, confirm it exists and roughly matches, and produce a short reconciliation note (a comment in your working notes or the PR description) listing: actual export names, actual evaluator input/output types, and the actual shape of an `evaluator:log` entry. Everything downstream keys off those real types.

---

## 3. Phase 1 — The cheap re-evaluate endpoint (keystone)

### 3.1 The core idea

Today, getting an evaluator verdict requires generating the draft first, because evaluation only runs as a step *inside* `runAgent()`. We are going to make evaluation a **pure function of (draft, evidence, evaluator-config)** that can be called on its own, and expose it behind an endpoint that reads a stored log entry and re-scores it.

Nothing about how evaluation works during live generation should change. We are extracting, not rewriting.

### 3.2 Step 1 — Audit and, if needed, enrich the log schema

Read `lib/agent/eval-log.ts` and inspect a real `evaluator:log` entry (via the admin surface or a quick script against KV in dev).

**Requirement:** a log entry must be *self-contained enough to re-score without regenerating.* At minimum it must contain, or be extended to contain:

- `id` — a stable unique id (timestamp-based is fine; it is used as the re-eval key)
- `draft` — the full email body text that was evaluated (subject + four paragraphs + sign-off, exactly as scored)
- `evidence` — the exact Stage-1 evidence bundle that was available to the writer and evaluator (candidate findings, open problems, quotable specifics, each with source). This is the field most likely to be missing or truncated today — **verify it is stored in full.**
- `studentProfile` — the student profile + writing sample used, if any evaluator axis (e.g. `voice`) depends on it. Confirm which axes read the profile and ensure whatever they read is persisted.
- `evaluatorPromptVersion` — an identifier (hash or version string) of the evaluator prompt used to produce the stored verdict. If this does not exist yet, add it. It lets you tell "same draft, different judge" runs apart.
- `verdict` — the existing per-axis result set (each axis: pass/fail, quoted phrase or null, reason).

If `evidence` or `studentProfile` are not currently persisted in full, **the first change is to start persisting them** on new generations. Do not attempt to backfill old entries; re-eval simply won't be available for pre-change entries, and that's acceptable. Add a short migration note.

**Commit checkpoint:** "Persist full evidence + profile + evaluator prompt version in eval log entries."

### 3.3 Step 2 — Extract evaluation into a pure, reusable function

In `lib/agent/evaluator.ts` (or a new `lib/agent/evaluate-draft.ts` if cleaner), define a single entry point with roughly this shape — **adapt names/types to the real code:**

```ts
// Types are illustrative — reconcile with the actual evaluator I/O.
export interface EvaluateInput {
  draft: string;
  evidence: EvidenceBundle;
  studentProfile?: StudentProfile;
  evaluatorPrompt?: string;      // optional override; falls back to the current default
  model?: string;                // optional override; defaults to the current Gemini eval model
}

export interface EvaluateResult {
  structure: CheckResult;        // code check, no model call
  prohibitions: CheckResult;     // code check, no model call
  llmAxes: Record<string, CheckResult>; // the 9 checks from the single Gemini call
  passedAll: boolean;
  evaluatorPromptVersion: string;
  evaluatorFailedOpen: boolean;  // true if the Gemini call failed/returned bad JSON
}

export async function evaluateDraft(input: EvaluateInput): Promise<EvaluateResult>;
```

Key constraints:

- This function must contain **all three kinds of checks**: the two code-only checks (`structure-check.ts`, `prohibitions.ts`) and the single combined Gemini call for the nine LLM-judged axes (temperature 0.2, JSON mode, as today).
- **Preserve the fail-open behavior exactly:** if the Gemini call fails or returns malformed JSON, every LLM-graded axis is marked passing but tagged with the distinct "evaluator call failed, not verified" reason, and `evaluatorFailedOpen` is set true. Do not silently change this.
- The `evaluatorPrompt` override is the whole point: when absent, use the current default prompt; when present, use it verbatim. This is what lets calibration and GEPA test prompt variants.
- **Refactor the existing generation path (`runAgent` Stage 3) to call this same function.** After the refactor, live generation must produce byte-identical verdicts to before for the same input. This is the correctness bar for the refactor: existing callers unchanged in behavior.

Verify the refactor by generating one email end-to-end and confirming the verdict shape and content match pre-refactor behavior.

**Commit checkpoint:** "Extract evaluateDraft() as pure function; route live generation through it (no behavior change)."

### 3.4 Step 3 — The `/api/re-evaluate` endpoint

Create an admin-gated route (e.g. `app/api/re-evaluate/route.ts`). Behavior:

1. **Auth:** require the `x-admin-token` matching `ADMIN_PASSWORD` via the existing `lib/admin-auth.ts` check. This endpoint is internal tooling; it must not be publicly reachable. It is exempt from the 3/hour IP rate limit for the same reason `/admin/calibrate` generation is.
2. **Input:** `{ logEntryId: string, evaluatorPrompt?: string, model?: string }`.
3. **Load:** fetch the entry from `evaluator:log` by id via `kvGet`. If missing, or if it predates the enriched schema (no full `evidence`), return a clear 4xx explaining it can't be re-scored.
4. **Run:** call `evaluateDraft({ draft, evidence, studentProfile, evaluatorPrompt, model })` from the stored entry. **No extraction, no composition — only the evaluation call.**
5. **Return:** the fresh `EvaluateResult`. Do **not** overwrite the original log entry's verdict — re-eval is non-destructive. Optionally write the re-eval result to a separate key (see below) if the user wants a trail; default to returning it only.

Optional (nice, not required for Phase 1): persist re-eval runs to a `reeval:log` key keyed by `(logEntryId, evaluatorPromptVersion)` so batch calibration comparisons don't re-run identical scorings. Gate this behind a flag; last-write-wins is fine at this scale.

**Test:** pick a logged entry, hit the endpoint with no `evaluatorPrompt` (should reproduce something equivalent to the stored verdict, modulo model nondeterminism), then hit it again with a deliberately stricter `evaluatorPrompt` and confirm at least one axis flips. Confirm the whole call is a single Gemini request and returns in ~1–3s, not 30+.

**Commit checkpoint:** "Add admin-gated /api/re-evaluate: re-score a logged draft for one Gemini call."

### 3.5 Phase 1 done-criteria

- Live generation behavior unchanged; one end-to-end email still generates correctly.
- A logged draft can be re-scored in a single Gemini call via the endpoint.
- Re-eval is non-destructive to the original log.
- Evidence + profile + evaluator-prompt-version are persisted on new generations.

---

## 4. Phase 2 — Calibration harness on top of re-eval

Now that scoring is decoupled, make `/admin/calibrate` (and/or a small script) able to compare evaluator-prompt variants against human labels **without regenerating drafts.**

### 4.1 What exists and what changes

- `calibration:labels` already stores human pass/fail labels keyed by entry timestamp (upsert). Keep it.
- The blind-grading UX stays: human answers all nine axes before the evaluator's verdict is revealed. Do not change the anchoring-prevention design.
- **New capability:** given a set of logged drafts that already have human labels, re-score each one under a candidate evaluator prompt via `/api/re-evaluate`, and compute **per-axis agreement** between the candidate evaluator and the human labels.

### 4.2 The agreement report

Build a small admin view or script that:

1. Takes a candidate `evaluatorPrompt` (or a version id).
2. For every logged draft that has a human label in `calibration:labels`, calls `/api/re-evaluate` with that prompt.
3. Computes, per axis, the fraction of drafts where the evaluator's pass/fail matches the human's. Report agreement per axis and overall.
4. Surfaces the specific drafts where they disagree, per axis, so the user can read them.

This is the mechanized version of "align the judge once." A low agreement number on one axis points directly at the line of the evaluator prompt that is too strict or too lenient. The user edits that line, re-runs the report (cheap, no regeneration), and watches agreement move.

**Target:** the user's stated bar is ~50 hand-labeled drafts and ~90% per-axis agreement. Treat that as the "evaluator is trustworthy" gate for Phase 3.

### 4.3 Two coaching notes stay separate

Do not merge `learning:synthesis` (from `/train`) and `calibration:synthesis`. They are injected into the writer prompt as two distinct sections and must stay independently auditable and resettable, exactly as designed. This plan does not change that.

**Commit checkpoint:** "Add per-axis evaluator-vs-human agreement report using re-eval (no regeneration)."

---

## 5. Phase 3 — GEPA training pathway (offline)

This runs **outside** the Next.js app, as a Python harness. It does not ship in the product. Its only output is an improved prompt *string* that the user pastes into `writer.ts`.

### 5.1 Why offline / why Python

GEPA (`dspy.GEPA`, backed by the `gepa` package) is Python. We do not rewrite the app in Python. The harness reproduces just enough of the pipeline to (a) generate an email from a candidate writer prompt and (b) score it, then lets GEPA evolve the prompt. The evolved prompt is human-readable and gets pasted back into the TypeScript writer. If it underperforms in production, `git revert`.

### 5.2 Directory layout

Create an isolated, git-ignored-for-secrets subproject, e.g.:

```
/optimization
  /gepa
    harness.py          # pipeline adapter: prompt -> email
    metric.py           # scoring + textual feedback (the hard part)
    run_gepa.py         # entrypoint: budget, reflection LM, dataset
    seed_labs.json      # ~20-40 sample lab URLs + student profiles
    requirements.txt    # dspy / gepa, provider SDKs
    README.md           # how to run, how to paste result back
```

Add `/optimization/**/.env` and any key files to `.gitignore`. The harness reads API keys from its own env, never hardcoded.

### 5.3 The dataset

GEPA needs surprisingly little — it works with as few as a handful of examples and typically 100–500 total rollouts, not thousands. Assemble **~20–40 seed examples**, each = one lab URL + one student profile spanning the three experience levels (none / some / significant). Diversity matters more than volume: vary field, lab fame, and student background so the optimizer can't overfit to one shape. These can reuse labs you've already researched (and, once Phase 1 lands, whose evidence is already cached in the log — see 5.6).

### 5.4 The metric — this is where the real work is

GEPA's sample efficiency comes entirely from *textual* feedback, not just a score. The metric must return **both** a scalar and a natural-language explanation of what failed. You already generate exactly this: your evaluator's per-axis verdicts with quoted phrases, and `buildCritique()`'s per-axis instructions. Wire that through.

`metric.py` should, for a generated email:

1. Run the same checks the app runs — ideally by calling the **same evaluator** the app uses (see 5.6 on reuse), so the optimization target is identical to production scoring.
2. Produce a scalar score. A reasonable start: fraction of the eleven checks passed, or a weighted sum if some axes matter more. Keep it simple first.
3. Produce **feedback text** that names, per failing axis, *why* it failed and quotes the offending phrase — e.g. "FAILED bridge.isNonTransferable: the bridge 'I am also passionate about immunology' would apply to any lab; make it name a specific method or finding from this lab and a specific item from this student's background." This is the signal GEPA reflects on. Generic feedback ("score was low") wastes the whole advantage.

DSPy's GEPA metric signature returns something like `dspy.Prediction(score=..., feedback=...)`. Match whatever the installed version expects; confirm against the `dspy.GEPA` docs for the version you install.

### 5.5 The run

In `run_gepa.py`:

- Set a **strong reflection LM** (Gemini 2.5 Pro / GPT-4.1-caliber or better). It is called only a handful of times, so its cost is negligible; its job is to write good prompt revisions.
- Use a **cheap model for rollouts** (the many generation+score passes).
- Start with the smallest budget (`auto="light"` — evaluates ~6 candidates) to shake out the harness before spending on `medium`/`heavy`.
- The seed program is your current writer prompt as the starting candidate.
- Let it evolve; it returns the best candidate prompt on the validation set.

**Output handling:** the result is a prompt string. Print it, diff it against the current `writer.ts` prompt so the user can read what changed and why (GEPA's traces are human-readable — surface them), and **stop.** Do not auto-edit `writer.ts`. The user reviews, pastes manually, commits with a message noting it's a GEPA-evolved prompt, and A/B-checks in production.

### 5.6 Reuse the app's evaluator and cached evidence (important)

Two efficiency wins that also keep the optimization target honest:

1. **Score via the same evaluator the app uses.** The cleanest path is to have the harness call a thin admin endpoint (e.g. the `evaluateDraft` capability, or a dedicated `/api/evaluate-adhoc` that takes draft+evidence+profile and returns the verdict, admin-gated) so Python and production score identically. Otherwise you optimize toward a scorer that differs from the one that gates real emails.
2. **Reuse cached evidence.** For seed labs already in `evaluator:log` with full evidence, the harness can skip Stage 1 entirely and feed stored evidence straight into composition+scoring. This mirrors the "lab-URL result caching" roadmap item and makes rollouts dramatically cheaper — extraction is the slow, expensive stage, and for a fixed seed set you only need to run it once per lab, ever.

### 5.7 Cost expectations

- Software: free (open source, Apache).
- API: a `light` run over ~20-40 seeds is tens of dollars, not thousands — bounded by ~100-500 rollouts, cheap rollout model, few expensive reflection calls. Reusing cached evidence (5.6) cuts it further.
- Real cost is engineering the harness + metric. Budget it as a mini-project. GEPA's effectiveness is configuration-sensitive; expect a few iterations to get the metric feedback and budget right before results are good.

**Commit checkpoints (harness is its own commits, separate from app code):**
- "Add GEPA optimization harness scaffold (offline, Python)."
- "Add evaluator-backed metric with per-axis textual feedback."
- "Add seed dataset + run entrypoint."

---

### 5.8 The metric function (`metric.py`) — reference implementation

A concrete `metric.py` accompanies this plan as a separate file. It is the scoring-plus-textual-feedback function GEPA calls on every rollout, and it is the single fiddliest piece of Phase 3, so it is written out in full rather than described. Key points for the agent integrating it:

- **Confirmed signature.** `metric(gold, pred, trace=None, pred_name=None, pred_trace=None) -> dspy.Prediction(score, feedback)`. The tail args are filled by GEPA for per-predictor scoring and can be ignored for single-writer-prompt optimization. Verify the exact return type against the installed `dspy` version — some builds expose it as `dspy.Prediction(score=, feedback=)` and others as a `ScoreWithFeedback` dataclass from `dspy.teleprompt.gepa.gepa_utils`; they are interchangeable.
- **The load-bearing behavior** is in `build_score_and_feedback()`: on every *failing* axis it emits the axis name, the **quoted offending phrase** from the email, the evaluator's own reason, and an instruction-shaped fix hint. This is the entire reason GEPA is sample-efficient — the reflection LM reads these lines to rewrite the writer prompt. Passing axes get terse acknowledgment; failing axes get the detail. Do not flatten this into a bare score.
- **Weights over axes** (`AXIS_WEIGHTS`) encode what to optimize toward. They are pre-set to weight the qualities the user flagged as weak — generic/swappable bridge (`bridge_isNonTransferable`, `bridge_isBidirectional`), cliché and odd flow (`naturalness`), and voice — above the mechanical checks, with `noFabrication` weighted highest because a fabricated specific is disqualifying. These are the main tuning knob; expect to adjust them across runs.
- **The one integration point to wire up** is `score_draft_via_app_evaluator()`, currently a stub that POSTs to an admin-gated `/api/evaluate-adhoc` endpoint. It must call the **same evaluator the app uses** (the `evaluateDraft()` from Phase 1), not a Python reimplementation — otherwise GEPA optimizes toward a judge that differs from the one gating real emails. If you did not add `/api/evaluate-adhoc` in Phase 1, add it now: it is a thin sibling of `/api/re-evaluate` that takes `{draft, evidence, studentProfile, evaluatorPrompt?}` directly instead of a `logEntryId`.
- **Fail-open handling is preserved end-to-end:** if the evaluator call failed open (unverified pass), the metric returns a neutral 0.5 and says so loudly in the feedback, so GEPA does not chase a phantom gradient from an unverified success.
- **Field-name reconciliation:** the normalization block in `score_draft_via_app_evaluator()` maps the evaluator's JSON into the axis keys in `AXIS_WEIGHTS` (flattening nested keys like `hook.isFinding` → `hook_isFinding`). Reconcile these names against the real evaluator output shape from the Phase 1 reconciliation note before running.
- **When optimizing the evaluator instead of the writer:** the same file supports it — pass an `evaluator_prompt` override into `score_draft_via_app_evaluator()` and use human calibration labels as `gold`. For writer optimization (the default), the evaluator is held fixed and no override is passed.

Place the file at `/optimization/gepa/metric.py`. It has no dependencies beyond `dspy` and `requests` and parses standalone; the stub is the only thing that must be wired before a real run.

---

## 6. Overall build order and checkpoints (summary)

1. **(Done) Git baseline** with `.gitignore` excluding `.env`.
2. **Phase 1 — re-eval endpoint** (keystone):
   - Enrich log schema (persist full evidence + profile + evaluator prompt version).
   - Extract `evaluateDraft()`; route live generation through it, no behavior change.
   - Add admin-gated `/api/re-evaluate`.
3. **Phase 2 — calibration harness:** per-axis evaluator-vs-human agreement via re-eval; drive the evaluator prompt to ~90% agreement on ~50 labeled drafts.
4. **Phase 3 — GEPA:** offline Python harness, evaluator-backed metric with textual feedback (`metric.py`, provided alongside this plan — see §5.8), light-budget run, paste evolved writer prompt back into `writer.ts`.

Each numbered sub-step is its own commit. Generation must work at every commit.

---

## 7. Things to explicitly verify or ask about (do not assume)

- Real export names and I/O types for the writer and evaluator — this plan's types are illustrative.
- The actual shape of an `evaluator:log` entry and whether it already stores full evidence and profile.
- Whether any evaluator axis reads the student profile/writing sample (affects what must be persisted for faithful re-eval).
- The exact fail-open tagging string and structure, so it's preserved verbatim.
- Which Next.js router (`app/` vs `pages/`) and matching route conventions.
- The installed (or to-be-installed) `dspy` / `gepa` version's exact GEPA API and metric signature — confirm against its docs, don't assume.

If any of these contradicts the plan, follow the code, not the plan, and say so in the commit message.
