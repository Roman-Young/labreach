# Corpus eval results — does judged quality predict replies?

Ran the live LabReach evaluator over all **53 real cold emails** with known reply
outcomes (17 replied, 36 did not). Reproduce with `npm run eval:ingest && npm run eval:judge`.
All 53 scored; 0 evaluator failures.

## The headline

> **The evaluator would not have sent a single one of the 17 emails that actually got replies.**

`wouldSend` — the judge's holistic *"would a PI respond to this?"* verdict — is **0 for 17**
on emails that real PIs demonstrably *did* respond to. That includes **A37**, the email that
became an actual job.

The quality bar the tool enforces is real, and it is **uncorrelated with the outcome it was
built to improve.**

## Per-axis, split by outcome

Evidence-independent axes (the interpretable ones — see caveats below). Two-sided Fisher
exact test on each 2×2:

| axis | replied (n=17) | no-reply (n=36) | gap | p | separates? |
|---|---|---|---|---|---|
| `opener` | 13 (76%) | 27 (75%) | +1 | 1.000 | no |
| `hookIsFinding` | 2 (12%) | 1 (3%) | +9 | 0.238 | no |
| `bridgeIsBidirectional` | 3 (18%) | 3 (8%) | +9 | 0.372 | no |
| `bridgeIsNonTransferable` | 12 (71%) | 18 (50%) | +21 | 0.236 | no |
| `naturalness` | 0 (0%) | 0 (0%) | 0 | 1.000 | no |
| `wouldSend` | **0 (0%)** | **0 (0%)** | 0 | 1.000 | no |
| `prohibitions` | 14 (82%) | 24 (67%) | +16 | 0.333 | no |
| `structure` | 0 (0%) | 0 (0%) | 0 | 1.000 | no |

**Not one axis separates repliers from non-repliers.** The smallest p-value is 0.236.

## What this does and doesn't establish

**Does:** the tool's notion of a good email has no measurable relationship to whether the
email worked. This is the corpus falsifying the project's original premise — that a better-
written email gets more replies — using the project's own judge as the instrument. It is why
LabReach moved its leverage upstream into the **Lab Digest** (pick better labs) and demoted
the writer's output to an **editable starting point** rather than a graded artifact.

**Doesn't:** prove the gaps are exactly zero. With 17 vs 36, only large effects are
detectable; "not significant" means *undetectable at this n*, not *proven absent*. The
honest reading is that no axis separates the groups, and the strongest quality signal the
judge has (`wouldSend`) is flatly wrong on every positive case.

## Caveats that matter

- **`structure` failing 100% is mechanical, not a quality verdict.** The check demands exactly
  4 paragraphs and 200–280 words — the LabReach house format. Real emails don't conform. Ignore it.
- **`naturalness` failing 100% is plausibly *correct*.** These emails recycle boilerplate
  ("my eagerness to learn, work ethic, and creativity…") verbatim across dozens of sends. The
  judge is right that they're formulaic. They got a 32% reply rate anyway. That's the point.
- **`noFabrication`, `voice`, `hookIsRecent` are excluded.** The 2023–24 lab pages have changed,
  so there is no honest evidence bundle to ground against, and no writing sample for voice.
- The corpus is one student, two years, self-selected labs. Reply rate is confounded by timing,
  funding, lab capacity, and two warm contacts. Treat replies as evidence, not ground truth.

## One hypothesis worth keeping (not a finding)

The largest gap — `bridgeIsNonTransferable` (+21pp), the **swap test**: *could this exact
sentence be sent by a different student to a different lab?* — is directionally consistent with
the idea that non-generic, non-swappable specificity is the thing that matters. It is **not
significant here** (p=0.236) and must not be sold as a result. It's the axis to watch if more
labeled data ever arrives.
