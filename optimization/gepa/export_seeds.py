"""
export_seeds.py — build seed_labs.json from the app's cached evaluator:log.

WHY
---
GEPA rollouts need (lab evidence + student profile) pairs. Stage 1 (research /
extraction) is the slow, expensive part of the pipeline — but every draft the
app has ever produced already has its full evidence bundle cached in
evaluator:log. This script pulls those via the admin calibrate endpoint so
rollouts skip Stage 1 entirely and reuse extraction you've already paid for
(plan §5.6). Diversity matters more than volume: aim for ~20-40 records spanning
different fields, lab fame, and student experience levels.

Entries logged before the profile-persistence change lack studentProfile; this
script reconstructs a minimal profile (interests + experience level, empty
writing sample) for those and flags them, since voice can't be judged without a
sample. Prefer entries that DO carry a full studentProfile.

USAGE
-----
    LABREACH_BASE_URL=http://localhost:3000 LABREACH_ADMIN_TOKEN=... \\
        python export_seeds.py --limit 40 --out seed_labs.json
"""

from __future__ import annotations
import argparse
import json
import os
import sys
import requests


def reconstruct_profile(entry: dict) -> dict:
    """Minimal profile for legacy entries without a stored studentProfile."""
    return {
        "name": "",
        "school": "",
        "year": "sophomore",
        "experienceLevel": entry.get("experienceLevel") or "none",
        "relevantCourses": "",
        "relevantExperience": "",
        "whyResearch": "",
        "interests": entry.get("studentInterests") or [],
        "writingSample": "",
    }


def has_usable_evidence(evidence: dict) -> bool:
    if not evidence:
        return False
    return any(evidence.get(k) for k in ("candidateFindings", "openProblems", "otherQuotableSpecifics"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=40, help="Max records to export.")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "seed_labs.json"))
    ap.add_argument("--require-profile", action="store_true",
                    help="Only export entries that carry a full stored studentProfile.")
    args = ap.parse_args()

    base = os.environ.get("LABREACH_BASE_URL", "").rstrip("/")
    token = os.environ.get("LABREACH_ADMIN_TOKEN", "")
    if not base or not token:
        sys.exit("Set LABREACH_BASE_URL and LABREACH_ADMIN_TOKEN (see README).")

    # evaluator:log is capped at 500, so one large page fetches everything.
    resp = requests.get(
        f"{base}/api/admin/calibrate?offset=0&limit=500",
        headers={"x-admin-token": token},
        timeout=60,
    )
    resp.raise_for_status()
    entries = resp.json().get("entries", [])

    records = []
    reconstructed = 0
    seen_labs = set()
    for e in entries:
        if not has_usable_evidence(e.get("evidence")):
            continue
        # De-dupe by lab so the seed set stays diverse rather than repeating a lab.
        lab_key = (e.get("labName"), e.get("piName"))
        if lab_key in seen_labs:
            continue

        profile = e.get("studentProfile")
        if not profile:
            if args.require_profile:
                continue
            profile = reconstruct_profile(e)
            reconstructed += 1

        seen_labs.add(lab_key)
        records.append({
            "timestamp": e.get("timestamp"),
            "labName": e.get("labName"),
            "piName": e.get("piName"),
            "evidence": e["evidence"],
            "studentProfile": profile,
        })
        if len(records) >= args.limit:
            break

    with open(args.out, "w") as f:
        json.dump(records, f, indent=2)

    print(f"Wrote {len(records)} seed records to {args.out} "
          f"({reconstructed} with reconstructed minimal profiles — voice unreliable for those).")
    if len(records) < 20:
        print("WARNING: fewer than 20 records. Generate more drafts (via /admin/calibrate) "
              "to build a diverse seed set before running GEPA.")


if __name__ == "__main__":
    main()
