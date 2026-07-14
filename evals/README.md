# Corpus evals

The evidence base for LabReach is 53 real cold emails the project owner sent to real
labs across two years, with known reply outcomes. This directory turns that corpus
into a runnable eval that asks the load-bearing question:

> **Does any quality axis separate the emails that got replies from the ones that didn't?**

The thesis — from the corpus itself — is *no*: prose quality did not predict replies,
and the best-written email in the corpus (`B02`, "the canonical negative") got silence.
`eval:judge` checks that against the live evaluator.

## Privacy

The corpus names real professors and records whether they ignored a student, so the
repo is public-safe by construction:

- **Committed:** `corpus/labels.csv` — anonymized, PI column is a stable id (`B02`),
  surnames scrubbed from the notes (cross-references preserved as ids).
- **Gitignored (never committed):** `corpus/raw/` (the email bodies + the
  name-bearing `labels-with-names.csv`), `corpus/emails.json`, `corpus/judge-results.json`.

Everything downstream keys on the id, so the evals run identically with names (locally)
or without (a fresh clone).

## Files you provide

Put these in `corpus/raw/` (gitignored):

- `labels-with-names.csv` — the name-bearing labels (columns `id,corpus,pi,replied,tag,notes`).
- The 53 emails, one per file, as `.md` or `.txt`. Name each file with its id (`B02.md`)
  or the PI surname (`curtius.txt`); ingest also falls back to the greeting line
  ("Dear Professor …"). An optional leading `Subject:` line is parsed out.

## Workflow

```bash
# 1. Regenerate the anonymized, committed labels from the name-bearing source.
npm run corpus:anonymize

# 2. Match the raw email files to labels -> corpus/emails.json (id-keyed, gitignored).
npm run eval:ingest      # reports any file/label that didn't match — nothing is dropped silently

# 3. Score every email with the live evaluator and split by reply outcome.
#    Needs the dev server running WITHOUT SITE_PASSWORD, and ADMIN_PASSWORD set.
npm run dev              # in another terminal
ADMIN_PASSWORD=... npm run eval:judge
```

## Reading the judge output

The corpus has no stored evidence bundle (the 2023-24 lab pages have changed), so
`eval:judge` scores with **empty evidence**. Two axes are therefore reported but *not*
interpretable here and are shown in a separate block:

- `noFabrication` — with no evidence bundle, every claim reads as ungrounded.
- `voice` — with no writing sample, it default-passes.
- `hookIsRecent` — borderline; judging recency wants a sense of the lab's prominent work.

The interpretable, evidence-independent axes (opener, hookIsFinding, both bridge axes
incl. the swap test, naturalness, wouldSend, prohibitions, structure) are what the
thesis is about. If the **gap** column is near zero across them, quality does not
separate repliers from non-repliers — the finding the whole product is built on.
