"""
run_gepa.py — entrypoint: evolve LabReach's writer prompt with GEPA.

WHAT IT DOES
------------
1. Loads seed examples (seed_labs.json, produced by export_seeds.py).
2. Builds the seed program (writer prompt as Signature instruction).
3. Runs dspy.GEPA with the evaluator-backed metric from metric.py.
4. Prints the best evolved instruction and a diff against the seed.
   It does NOT edit lib/agent/writer.ts — you review and paste manually.

DO NOT RUN until the evaluator is calibrated (Phase 2: ~90% per-axis agreement
on ~50 labeled drafts). GEPA optimizes toward the evaluator; an un-calibrated
judge means optimizing toward the wrong target.

VERSION NOTE
------------
dspy.GEPA's constructor args and the metric return type vary across dspy
releases. Confirm against the installed version's docs before a real run:
    python -c "import dspy, inspect; print(inspect.signature(dspy.GEPA.__init__))"
Some builds want reflection_lm as a dspy.LM, auto in {"light","medium","heavy"},
and metric returning dspy.Prediction(score=, feedback=). Adjust here if needed.
"""

from __future__ import annotations
import argparse
import difflib
import json
import os
import sys

import dspy

from harness import SEED_WRITER_PROMPT, build_program, build_example, configure_rollout_lm
from metric import labreach_metric


def load_dataset(path: str) -> list[dspy.Example]:
    with open(path) as f:
        records = json.load(f)
    examples = [build_example(r) for r in records]
    if not examples:
        sys.exit(f"No seed examples in {path}. Run export_seeds.py first.")
    return examples


def split(examples: list, val_frac: float = 0.4) -> tuple[list, list]:
    n_val = max(1, int(len(examples) * val_frac))
    return examples[n_val:], examples[:n_val]  # (train, val)


def print_diff(seed: str, evolved: str) -> None:
    print("\n" + "=" * 72)
    print("EVOLVED WRITER PROMPT (paste into lib/agent/writer.ts's static block")
    print("in place of the current instruction, review first):")
    print("=" * 72)
    print(evolved)
    print("\n" + "=" * 72)
    print("DIFF vs seed:")
    print("=" * 72)
    diff = difflib.unified_diff(
        seed.splitlines(), evolved.splitlines(),
        fromfile="seed_writer_prompt", tofile="evolved_writer_prompt", lineterm="",
    )
    print("\n".join(diff) or "(no textual change)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default=os.path.join(os.path.dirname(__file__), "seed_labs.json"))
    ap.add_argument("--auto", default="light", choices=["light", "medium", "heavy"],
                    help="GEPA budget. Start light to shake out the harness.")
    ap.add_argument("--reflection-model", default="gemini/gemini-2.5-pro",
                    help="Strong LM that writes prompt revisions (called only a few times).")
    ap.add_argument("--out", default=None, help="Optional path to write the evolved prompt string.")
    args = ap.parse_args()

    for var in ("LABREACH_BASE_URL", "LABREACH_ADMIN_TOKEN", "ANTHROPIC_API_KEY"):
        if not os.environ.get(var):
            sys.exit(f"Missing required env var: {var} (see README).")

    configure_rollout_lm()  # rollouts = claude-sonnet-4-6

    reflection_lm = dspy.LM(args.reflection_model, max_tokens=8192)

    dataset = load_dataset(args.seeds)
    trainset, valset = split(dataset)
    print(f"Loaded {len(dataset)} seed examples -> {len(trainset)} train / {len(valset)} val.")

    seed_program = build_program(SEED_WRITER_PROMPT)

    gepa = dspy.GEPA(
        metric=labreach_metric,
        auto=args.auto,
        reflection_lm=reflection_lm,
        track_stats=True,
    )

    print(f"Starting GEPA (auto={args.auto}). Rollouts on claude-sonnet-4-6, "
          f"reflection on {args.reflection_model}.")
    optimized = gepa.compile(seed_program, trainset=trainset, valset=valset)

    # The evolved instruction lives on the optimized program's predictor.
    evolved = optimized.signature.instructions if hasattr(optimized, "signature") \
        else optimized.predictors()[0].signature.instructions

    print_diff(SEED_WRITER_PROMPT, evolved)

    if args.out:
        with open(args.out, "w") as f:
            f.write(evolved)
        print(f"\nWrote evolved prompt to {args.out}")


if __name__ == "__main__":
    main()
