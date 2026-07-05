# LabReach GEPA harness (offline writer-prompt optimization)

This is an **isolated Python subproject**, deliberately outside the WAT `tools/`
convention: GEPA (`dspy.GEPA`) is Python and this does not ship in the Next.js
app. Its only product is an improved **writer-prompt string** you paste back into
`lib/agent/writer.ts`. If it underperforms in production, `git revert`.

## Prerequisites (gate)

**Do not run GEPA until the evaluator is calibrated.** GEPA optimizes toward the
evaluator, so an un-calibrated judge means optimizing toward the wrong target.
The gate (per the implementation plan): **~50 hand-labeled drafts at ~90%
per-axis agreement** on `/admin/calibrate`'s agreement report. Until then, only
the cheap harness checks below are meaningful.

## Files

| File | Role |
|---|---|
| `metric.py` | Scoring + textual feedback. Calls `POST /api/evaluate-adhoc` (the app's real `evaluateDraft`) so Python and production score identically. `AXIS_WEIGHTS` is the main tuning knob. |
| `harness.py` | The dspy program GEPA optimizes: writer prompt (as Signature instruction) + (student, evidence) → email. `SEED_WRITER_PROMPT` is the static block from `writer.ts`. |
| `run_gepa.py` | Entrypoint. Runs GEPA, prints the best evolved prompt + a diff vs the seed. Never edits `writer.ts`. |
| `export_seeds.py` | Builds `seed_labs.json` from cached evidence in `evaluator:log` (rollouts skip Stage 1). |
| `requirements.txt` | `dspy` + `requests`. |

## Setup

```bash
cd optimization/gepa
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Create `optimization/gepa/.env` (gitignored) — or export directly:

```bash
export LABREACH_BASE_URL=http://localhost:3000     # a running LabReach instance
export LABREACH_ADMIN_TOKEN=...                     # matches the app's ADMIN_PASSWORD
export ANTHROPIC_API_KEY=...                        # rollout writer = claude-sonnet-4-6
export GEMINI_API_KEY=...                           # reflection LM (gemini-2.5-pro), if used
```

The app (`LABREACH_BASE_URL`) must be running with its own `.env` so
`/api/evaluate-adhoc` can reach Gemini.

## Cheap checks (safe to run now, no GEPA)

```bash
# 1. Everything imports.
python -c "import metric, harness, run_gepa, export_seeds; print('imports ok')"

# 2. Build the seed dataset from cached evidence.
python export_seeds.py --limit 40

# 3. One live scoring call: score a stored draft via the real evaluator
#    (single Gemini call). Confirms the metric <-> /api/evaluate-adhoc wiring.
python - <<'PY'
import json, dspy
from metric import score_draft_via_app_evaluator, build_score_and_feedback
rec = json.load(open("seed_labs.json"))[0]
# Use the stored draft if you have one; otherwise any body text works as a smoke test.
res = score_draft_via_app_evaluator(
    subject="Research Interest in X - A, B",
    body="Dear Professor...\n\n(paste or generate a draft body)\n\nThank you for your time,\nName",
    evidence=rec["evidence"], student_profile=rec["studentProfile"],
)
score, feedback = build_score_and_feedback(res)
print("score:", score); print(feedback[:500])
PY
```

## Real run (after the calibration gate)

```bash
# Confirm the installed dspy's GEPA API first:
python -c "import dspy, inspect; print(inspect.signature(dspy.GEPA.__init__))"

python run_gepa.py --auto light            # ~6 candidates; shake out the harness
# then, if promising:
python run_gepa.py --auto medium --out evolved_prompt.txt
```

`run_gepa.py` prints the evolved instruction and a unified diff against the seed.
**Review it, then paste it by hand** into `lib/agent/writer.ts` in place of the
current static instruction block (leave the dynamic KV sections —
`learning:synthesis`, `calibration:synthesis`, training arcs, `piFeedback` —
untouched). Commit with a message noting it's a GEPA-evolved prompt, and A/B it
in production.

## Cost

A `light` run over ~20-40 seeds is tens of dollars, not thousands: bounded by
~100-500 rollouts on the cheap-ish writer, a handful of expensive reflection
calls. Reusing cached evidence (no Stage 1) keeps it there. Expect a few
iterations tuning `AXIS_WEIGHTS` and the metric feedback before results are good.
