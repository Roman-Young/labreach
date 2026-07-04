"""
metric.py — GEPA scoring + textual-feedback metric for LabReach's writer prompt.

WHAT THIS IS
------------
GEPA optimizes a prompt by (1) running it, (2) scoring the output, and (3)
reflecting on WHY it scored that way to propose a better prompt. Step 3 is the
whole reason GEPA is sample-efficient: it reads natural-language feedback, not
just a number. This file produces that feedback.

The single most important rule below: when an axis FAILS, the feedback must say
why AND quote the offending phrase from the email. Generic feedback ("score was
low") throws away GEPA's entire advantage. Your evaluator already produces
per-axis verdicts with quoted phrases — this metric's job is to translate them
into instruction-shaped feedback the reflection LM can act on.

HOW IT SCORES
-------------
LabReach's evaluator has 11 checks total:
  - 2 code checks:  structure (word/para count), prohibitions (regex AI-tells)
  - 9 LLM checks:   opener, hook.isFinding, hook.isRecent, bridge.isBidirectional,
                    bridge.isNonTransferable, noFabrication, naturalness, voice,
                    wouldSend
Score = weighted fraction of checks passed. Weights let you tell GEPA that, e.g.,
a generic non-transferable bridge matters more than a slightly-off word count.

SIGNATURE (confirmed against dspy.GEPA)
---------------------------------------
    metric(gold, pred, trace=None, pred_name=None, pred_trace=None)
        -> dspy.Prediction(score: float, feedback: str | None)
The tail args (trace/pred_name/pred_trace) are filled by GEPA for per-predictor
scoring; single-prompt optimization can ignore them. Confirm the exact return
type against the dspy version you install — older/newer builds expose it as
`dspy.Prediction(score=, feedback=)` or a `ScoreWithFeedback` dataclass from
`dspy.teleprompt.gepa.gepa_utils`. They are interchangeable in practice.

INTEGRATION NOTE
----------------
`score_draft_via_app_evaluator()` is a stub. Wire it to the SAME evaluator the
LabReach app uses — ideally by calling an admin-gated endpoint that runs
`evaluateDraft(draft, evidence, profile)` and returns the per-axis verdict — so
the optimization target is identical to the scorer that gates real emails. Do
NOT reimplement the checks in Python; you'd be optimizing toward a different
judge than production uses.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Optional
import os
import requests

import dspy


# ---------------------------------------------------------------------------
# 1. Axis weights. Higher weight = GEPA treats failures on this axis as more
#    costly, so it prioritizes fixing them. These reflect the qualities the
#    student flagged as weak (cliché, weak human connection, odd flow), so
#    bridge/naturalness/voice are weighted above the mechanical checks.
#    Tune these; they are the main knob on what GEPA optimizes toward.
# ---------------------------------------------------------------------------
AXIS_WEIGHTS: dict[str, float] = {
    "structure":               0.5,   # code check
    "prohibitions":            1.0,   # code check (AI-tell phrases, em dashes)
    "opener":                  0.75,  # hard-rule single sentence: name/school/year/interest
    "hook_isFinding":          1.0,
    "hook_isRecent":           1.0,
    "bridge_isBidirectional":  1.5,   # weak human connection = the stated problem
    "bridge_isNonTransferable":1.5,   # generic/swappable bridge = the stated problem
    "noFabrication":           2.0,   # a fabricated specific is disqualifying; weight high
    "naturalness":             1.5,   # cliché / odd flow = the stated problem
    "voice":                   1.25,
    "wouldSend":               1.0,   # holistic check-on-the-checks
}

# Human-readable, instruction-shaped guidance per axis. Appended to the quoted
# offending phrase when an axis fails, so the reflection LM gets a concrete,
# actionable "here's what to change" rather than just a label.
AXIS_FIX_HINTS: dict[str, str] = {
    "structure":
        "Hold the body to exactly four paragraphs and 200-280 words "
        "(excluding sign-off and attachment-reminder lines).",
    "prohibitions":
        "Remove the flagged AI-tell phrase entirely. Do not paraphrase it into "
        "a softer version of the same cliche; cut the sentence's reliance on it.",
    "opener":
        "Make sentence one a single sentence that states the student's name, "
        "school, year, and one general scientific interest area — nothing more.",
    "hook_isFinding":
        "Paragraph two must name an actual FINDING from the lab's work "
        "(what they showed/discovered), not merely the field or topic they study.",
    "hook_isRecent":
        "Surface a specific, non-obvious result from deeper in the lab's work, "
        "not the single most famous headline result that any lazy reader would cite.",
    "bridge_isBidirectional":
        "The bridge must name something specific on BOTH sides: a concrete detail "
        "from this lab AND a concrete detail from this student's own background.",
    "bridge_isNonTransferable":
        "Rewrite the bridge so it could NOT be sent unchanged to a different "
        "student or a different lab. If it survives that swap, it is too generic.",
    "noFabrication":
        "Every specific claim about the lab must trace to the provided evidence. "
        "Remove any detail not grounded in the extracted findings.",
    "naturalness":
        "Fix the flagged unnatural pattern (self-focus imbalance, uniform sentence "
        "length, overloaded sentence, generic zoom-out close, or quoted jargon). "
        "Vary rhythm; let the strongest concrete detail carry the paragraph.",
    "voice":
        "Match the vocabulary and sentence rhythm of the student's writing sample. "
        "Do not elevate the register above what the student actually writes like.",
    "wouldSend":
        "Make the email one a busy PI would actually reply to: specific, brief, "
        "and free of filler. If it reads as a template, it fails.",
}


@dataclass
class AxisVerdict:
    """One axis result as returned by the LabReach evaluator."""
    passed: bool
    quote: Optional[str]   # the offending/supporting phrase, or None
    reason: Optional[str]  # the evaluator's own short reason


@dataclass
class EvalResult:
    """Normalized shape of a full evaluator verdict for one draft."""
    axes: dict[str, AxisVerdict]
    evaluator_failed_open: bool  # true if the Gemini eval call failed / bad JSON


# ---------------------------------------------------------------------------
# 2. The bridge to LabReach's real evaluator. REPLACE THE BODY with a call to
#    the same evaluator the app uses. The recommended path is an admin-gated
#    endpoint that runs evaluateDraft() and returns the per-axis verdict.
# ---------------------------------------------------------------------------
def score_draft_via_app_evaluator(
    draft: str,
    evidence: Any,
    student_profile: Any,
    evaluator_prompt: Optional[str] = None,
) -> EvalResult:
    """
    Call LabReach's real evaluator over HTTP and normalize the response.

    Expects an admin-gated endpoint (e.g. POST /api/evaluate-adhoc) that accepts
    {draft, evidence, studentProfile, evaluatorPrompt?} and returns the same
    per-axis verdict structure the app logs to evaluator:log.

    Reconcile the JSON field names below with the ACTUAL evaluator output shape
    (see the reconciliation note produced in Phase 1). Do not assume these names.
    """
    base_url = os.environ["LABREACH_BASE_URL"]           # e.g. http://localhost:3000
    admin_token = os.environ["LABREACH_ADMIN_TOKEN"]     # matches ADMIN_PASSWORD

    resp = requests.post(
        f"{base_url}/api/evaluate-adhoc",
        headers={"x-admin-token": admin_token},
        json={
            "draft": draft,
            "evidence": evidence,
            "studentProfile": student_profile,
            "evaluatorPrompt": evaluator_prompt,
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()

    # --- Normalize. Map the app's verdict JSON into EvalResult. ADAPT NAMES. ---
    # The design doc groups checks as: structure + prohibitions (code) and the
    # nine LLM axes with nested keys like hook.isFinding. Flatten nested keys to
    # underscore form (hook.isFinding -> hook_isFinding) to match AXIS_WEIGHTS.
    axes: dict[str, AxisVerdict] = {}
    for key in AXIS_WEIGHTS:
        raw = data.get("axes", {}).get(key) or data.get(key)  # tolerate either shape
        if raw is None:
            # Missing axis: treat as failed but flag clearly so it's visible.
            axes[key] = AxisVerdict(passed=False, quote=None,
                                    reason="axis missing from evaluator output")
            continue
        axes[key] = AxisVerdict(
            passed=bool(raw.get("passed", raw.get("pass", False))),
            quote=raw.get("quote"),
            reason=raw.get("reason"),
        )

    return EvalResult(
        axes=axes,
        evaluator_failed_open=bool(data.get("evaluatorFailedOpen", False)),
    )


# ---------------------------------------------------------------------------
# 3. Turn a verdict into (score, feedback). This is the heart of the file.
# ---------------------------------------------------------------------------
def build_score_and_feedback(result: EvalResult) -> tuple[float, str]:
    total_weight = sum(AXIS_WEIGHTS.values())
    earned = 0.0
    passed_lines: list[str] = []
    failed_lines: list[str] = []

    for axis, weight in AXIS_WEIGHTS.items():
        verdict = result.axes.get(axis)
        if verdict is None:
            failed_lines.append(f"- {axis}: no verdict returned.")
            continue

        if verdict.passed:
            earned += weight
            passed_lines.append(f"- {axis}: passed.")
        else:
            # The load-bearing part: name the axis, quote the offending phrase,
            # and give the actionable fix hint. This is what GEPA reflects on.
            quote = f' Offending text: "{verdict.quote}".' if verdict.quote else ""
            reason = f" Evaluator reason: {verdict.reason}." if verdict.reason else ""
            hint = AXIS_FIX_HINTS.get(axis, "")
            failed_lines.append(f"- {axis}: FAILED.{quote}{reason} Fix: {hint}")

    score = earned / total_weight if total_weight else 0.0

    # If the evaluator failed open, the score is not trustworthy signal. Say so
    # loudly and return a neutral score so GEPA doesn't chase a phantom gradient.
    if result.evaluator_failed_open:
        feedback = (
            "The evaluator call failed and every LLM-graded axis was marked "
            "passing WITHOUT verification. This score is not reliable signal; "
            "do not treat this trajectory as a genuine success."
        )
        return 0.5, feedback

    header = (
        f"Weighted score: {score:.2f} "
        f"({len(passed_lines)}/{len(AXIS_WEIGHTS)} axes passed).\n"
    )
    if failed_lines:
        body = "Axes that FAILED (fix these first):\n" + "\n".join(failed_lines)
        if passed_lines:
            body += "\n\nAxes that passed:\n" + "\n".join(passed_lines)
    else:
        body = "All axes passed. " + "\n".join(passed_lines)

    return score, header + body


# ---------------------------------------------------------------------------
# 4. The GEPA metric entrypoint. This is what you pass to dspy.GEPA(metric=...).
# ---------------------------------------------------------------------------
def labreach_metric(
    gold: dspy.Example,
    pred: dspy.Prediction,
    trace: Optional[Any] = None,
    pred_name: Optional[str] = None,
    pred_trace: Optional[Any] = None,
) -> dspy.Prediction:
    """
    gold:  a dspy.Example carrying the seed inputs — expected fields:
           gold.lab_url, gold.evidence, gold.student_profile
           (evidence is pre-extracted/cached so rollouts skip Stage 1; see plan §5.6)
    pred:  the program's output — expected field: pred.email (the composed draft)

    Returns dspy.Prediction(score, feedback). GEPA averages score across the
    batch and feeds feedback to the reflection LM to rewrite the writer prompt.
    """
    draft = getattr(pred, "email", None) or getattr(pred, "draft", None)
    if not draft:
        return dspy.Prediction(
            score=0.0,
            feedback="The program produced no email text. The writer prompt must "
                     "output a complete four-paragraph draft.",
        )

    result = score_draft_via_app_evaluator(
        draft=draft,
        evidence=gold.evidence,
        student_profile=gold.student_profile,
        # No evaluator_prompt override here: when optimizing the WRITER we hold
        # the (already-calibrated) evaluator fixed. Only pass an override when
        # optimizing the EVALUATOR prompt itself (a separate GEPA run).
    )

    score, feedback = build_score_and_feedback(result)
    return dspy.Prediction(score=score, feedback=feedback)


# ---------------------------------------------------------------------------
# 5. Optional: a plain-score version for dspy.Evaluate (no feedback), useful for
#    a quick before/after benchmark of a candidate prompt outside GEPA.
# ---------------------------------------------------------------------------
def labreach_score_only(gold: dspy.Example, pred: dspy.Prediction, trace=None) -> float:
    draft = getattr(pred, "email", None) or getattr(pred, "draft", None)
    if not draft:
        return 0.0
    result = score_draft_via_app_evaluator(draft, gold.evidence, gold.student_profile)
    score, _ = build_score_and_feedback(result)
    return score
