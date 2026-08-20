# Retrieval design decisions + evidence (2026-08-20)

Roman's calls, and what the eval evidence does/doesn't yet support.

## SETTLED — shipped

**Input shape: `{interests[], resume}`, not one prose blob.** `distillProfile` prepends interests
VERBATIM (no LLM) and LLM-condenses the resume; it deliberately drops stated aspirations from resume
prose ("I want to study X" is not experience). The first eval passed everything as `resume`, so it
measured a query the product never builds. Fixed. Mechanism-verified, not just a number: p01 Kersten
#20→#1, Hui #22→#6 with zero retrieval-code change. Mean Recall@20 68.3% → 73.9%.

**Eval match rule: intent must match (Roman).** A lab that merely uses the student's technique as a
TOOL for a different question is NOT a good match. Mali (CRISPR *screens* for functional genomics)
removed from p02's key — retrieval is correct to rank her low. Keyword overlap ≠ intent overlap.

## DECIDED, NOT YET BUILT — needs a bigger sample first

**Two-sided presentation (interests vs experience).** Roman: show labs matching EITHER, tagged so the
student sees WHY ("matches your interest" / "matches your skills"). This is additive presentation,
not a ranking gamble — safe to build independent of the decomposition question. Arm attribution
falls out of the fan-out for free (we already log which sub-query matched each lab).

**Mild recency boost.** Roman: a 2025-26 matching paper should outrank an equally-matching 2021 one
(better cold emails, favors labs active in the area now). Small change to lab aggregation:
`score = Σ rrf_i · decay^i · recency(year)`. UNVALIDATED — hold until the golden set is bigger.

## OPEN — evidence says DON'T ship yet

**Per-interest decomposition.** Fan out one sub-query per interest + one for experience, union by RRF.

- *Latency: a non-issue.* 1 embed 397ms · 4 serial 1020ms · **4 PARALLEL 274ms**. Capping interests
  at 3 makes it a bounded 4-way `Promise.all` ≈ the cost of one call. Roman's instinct was right.
- *But recall gain is inside the noise.* Recall@20 over 18 gold labs, 2 profiles:
  | scoring | p01 | p02 | total |
  |---|---|---|---|
  | blended (today) | 7/10 | 5/8 | **12/18** |
  | sum across arms | 7/10 | 4/8 | 11/18 |
  | max arm | 8/10 | 5/8 | **13/18** |
  | decay-weighted arms | 8/10 | 5/8 | **13/18** |
- *Sum-across-arms is actively wrong* — it rewards labs matching every interest a little and buries
  specialists (Komor, THE base-editing lab, fell out of top-20; Boddy who hit all 4 arms went #1).
  Same "breadth beats bullseye" failure `retrieve.ts` already solves at the chunk level with decay.
  If we ever decompose, score by BEST arm (max/decay), never sum.
- *No mode dominates.* max and decay recover DIFFERENT labs (max gets Komor+Weiskopf but loses Kaech
  and Kadonaga; decay keeps those but loses Komor). 13/18 vs 12/18 on two profiles is one lab of
  difference — not a result.
- **Verdict: do not ship a ranking change on n=2 profiles.** Label ~10-12 profiles, then re-run this
  shootout. Shipping on this evidence would be exactly the eyeballing the eval exists to replace.

**Klemke is missed by every mode** (blended, sum, max, decay) — a `paper`-hook match buried in a
thematically divergent lab. If paper-hook recall stays low across a bigger sample, that's the case
for chunk-level surfacing, not query decomposition.

## THE REFRAME (Roman, 2026-08-20) — recall, not precision

> "It doesn't have to return only the best things, it just has to return all valid good ones."

The product is browse-and-star: the STUDENT is the final reranker. So the objective is getting every
valid lab into the pool they scan — not ordering the pool perfectly. That single sentence decides
most of the open questions, and the data backs it:

**Pool depth is the cheapest recall lever, and it beats every ranking scheme tested.**
| approach | Recall@20-equivalent | engineering cost |
|---|---|---|
| blended @20 (today) | 13/18 (72%) | — |
| decomposition, sum arms | 11/18 | days + latency + new failure modes |
| decomposition, max/decay arms | 13/18 | days + latency + new failure modes |
| **blended @30 (just show more)** | **16/18 (89%)** | **one config value** |
| blended @40 | 16/18 (no further gain) | — |

Consequences:
- **Decomposition: DON'T BUILD.** Loses to a config change. Revisit only if depth plateaus and
  paper-hook recall is still bad on a bigger sample.
- **Reranking: DON'T BUILD.** Reranking is a precision tool; we don't have a precision problem.
  Confirms `retrieve.ts`'s original "no reranker" call.
- **Recency boost: RECONSIDER — it contradicts this principle.** Roman picked it earlier, but a
  recency weight REORDERS the pool without adding valid labs; a lab whose best-fit paper is 2021 is
  still a valid match inside the 5-year floor. It's precision work. Recommend dropping it, or
  demoting it to a display-order tiebreak that can't push a valid lab out of the pool.
- **Metric: TWO metrics, not one** (corrected 2026-08-20 after Roman pushed back on my
  over-correction — see "RANKING STILL MATTERS" below). Recall@N for coverage, Precision@5 for
  top-of-list quality. Optimizing either alone is wrong.
- **Two-sided (interests ⊕ experience) with source flags: BUILD.** It's a union → strictly more
  valid labs in the pool (a recall move), plus the student sees WHY a lab matched. Aligned.

**Still missing beyond @40** (the genuinely hard residue, n=2 so treat as anecdote): Weiskopf
(`overall`) and Klemke (`paper`-hook, missed by every scheme). If paper-hook recall stays low on a
bigger sample, that argues for surfacing the matching CHUNK, not for query decomposition.

### RANKING STILL MATTERS (Roman's correction, 2026-08-20) — I over-corrected

I swung from "precision matters" to "only recall matters." Wrong. Roman:

> "We should still rank the labs in the general order of most related... if a lab aligned with their
> interest AND their experience, that should definitely be at the top... otherwise there's just a lot
> of mess for them to look at."

Two facts I should have checked before recommending a depth change:
1. **Pool depth is ALREADY user-controlled** — `app/digest/page.tsx` has a 5–30 slider (default
   **15**, not 20). The student decides breadth-vs-focus; shipping a new default was never the lever.
   NOTE: default 15 means real-world recall sits BELOW the @20 numbers measured above.
2. **The UI literally promises ordering** — slider caption: *"The most relevant always come first."*
   Ranking quality is a stated commitment to the user, not an optional nicety.

So the correct synthesis is BOTH, with a clean division of labor:
- **Recall** decides what's IN the pool. The student sets depth; our job is that valid labs appear
  within whatever depth they choose.
- **Ranking** decides the ORDER inside it. Attention is finite and the top is what actually gets
  read — an unranked pool is "a lot of mess."
- **The ranking rule Roman wants:** a lab matching BOTH interests and experience outranks one
  matching only a single dimension.

**This resurrects the arm-based (two-sided) machinery — but justified on RANKING, not recall.** A
single blended embedding produces one score and CANNOT tell you why a lab matched; separate
interest/experience arms are the only way to know "this hit both." That same attribution powers the
source flags.

**...and then the measurement said don't ship it as a RANKING change:**
| | P@5 | R@15 |
|---|---|---|
| blended (today) | **60.0%** | 72.5% |
| two-sided (best-arm + ½ other) | 50.0% | **78.8%** |

Two-sided trades top-of-list quality for coverage — backwards from what Roman asked for. Today's
blended ordering is already the better one at the top.

**Key negative result: "matched both arms" is a DEGENERATE signal as implemented.** In the top-30,
labs hitting both arms were 25/30 (p01) and 27/30 (p02) — with 80 candidates per arm, essentially
every lab appears in both, so the flag carries almost no information. Roman's rule is sound in
principle; capturing it needs "*strongly ranked* in both arms" (e.g. both ranks inside top-N, or a
product/min of arm scores), not mere presence. Untested — and testing formulations at n=2 is exactly
the eyeballing this eval exists to replace.

**SAFE SPLIT (recommended): keep blended RANKING, add arm attribution as DISPLAY-ONLY metadata.**
Compute which arm(s) a lab matched and show "matches your interest / matches your experience" without
touching order. Gives Roman the transparency he wants, zero ranking risk, no metric regression.
Revisit arm-based ORDERING once the golden set is big enough to decide it.

## STOP DESIGNING, START LABELING (2026-08-20)

Four benchmarks now — decomposition, arm-scoring shootout, depth curve, ranking — each produced a
*differently-signed* weak answer on the same 2 profiles. That pattern is the signature of an
undersized sample, not of a hard problem. Continuing to propose retrieval changes on n=2 would be
precisely the "eyeball whether it helped" the eval was built to eliminate.

Confidently known today:
- Input shape `{interests, resume}` was a real bug, fixed. (Mechanism-verified, not a metric wobble.)
- Today's blended ranking is decent at the top (P@5 = 60%).
- Depth raises recall (@20 72% → @30 89%), and the STUDENT already controls it (5–30 slider).
- Everything else — decomposition, arm ranking, recency — is unresolved noise at this sample size.

Next action is labeling ~6–8 more profiles (target 8–10 total), not more benchmarks.

**Undergrad vs grad (Roman's forward look).** Undergrads: experience often does NOT correlate with
target field (they took whatever lab job they could get) → wide net, recall-first, deeper pool. Grad
students: tighter profile, work correlates with interests, smaller viable lab set → precision matters
more, shallower pool. The non-over-engineered version of this is ONE KNOB (pool depth, maybe an
interests-vs-experience weight), not two retrieval systems. Do not fork the pipeline.

## THE `tool` MATCH TYPE (Roman, 2026-08-20) — reconciles Mali vs Talmo

Roman: "if a lab like Talmo is creating tools that contribute to your scientific interest or
experience, that is a pretty good (though slightly more unorthodox) connection worth flagging."

This looks like it contradicts the earlier "intent must match / drop Mali" call. It doesn't — the
line is DIRECTION of the tool relationship:
- **Mali** — *uses* the student's technique (CRISPR) to study an UNRELATED question (functional-
  genomics screens). Technique is incidental to the lab's science. → NOT a match.
- **Talmo** — *builds* tools (SLEAP, Keypoint-MoSeq) that SERVE the student's own field. A behavior/
  optogenetics student interested in fear/pain/feeding circuits would use — or help build — exactly
  these. → a real, unorthodox connection, tag `tool`.

The test is not "does a keyword overlap" but "is the lab's tool-building IN SERVICE OF the student's
interest/experience." So the match taxonomy is now four types: `overall`, `paper`, `both`, `tool`
(see normGood in eval-rag.ts). `tool` labs surface AND carry a flag so the student sees why ("this
lab builds methods for your area") — which is a differentiated cold-email hook, not noise. Reported
as its own recall bucket.

## LEADING RETRIEVAL FIX: query expansion (umbrella term → field jargon) — 2026-08-20

The strongest retrieval-improvement lead, because it's MECHANISTIC and reproduces across independent
cases, not a metric wobble on n=2.

**Symptom:** the marquee lab of a subfield ranks just outside the shown pool.
- p02 Komor (base editing) — writes "base editors," not "CRISPR gene editing."
- p04 Cravatt (chemical biology) — the phrase "chemical biology" appears in **0 of his 19 chunks**
  (papers AND overview). His vocabulary: covalent(6), inhibitor(5), proteomic(5). Lab rank **#20**.

**Mechanism (traced):** students query in UMBRELLA terms; established labs write in FIELD JARGON.
The sparse arm can't rescue them (their text lacks the query's literal words — Cravatt's best chunk
is sparse #368), and the dense arm places them mid-pack (#29-41) because their specific-mechanism
papers embed toward the mechanism, not the umbrella. Counterintuitive consequence: **the bigger and
more specialized the lab, the more likely it's missed**, because it least often uses the beginner's
umbrella phrase.

**Fix:** expand each interest term to its field synonyms/jargon before retrieval (e.g. "chemical
biology" → + "chemoproteomics, activity-based protein profiling, covalent probes, small-molecule
target ID"). Helps BOTH arms (lexical terms for sparse, richer semantics for dense). Known technique
(query expansion / pseudo-HyDE). Risks: expansion adds noise, can pull wrong labs — so it MUST be
validated on the golden set, not shipped on n=4. This is the top item for the "once 8-10 profiles are
labeled" re-test. Cheap interim reality: both labs sit at ~#20, so the existing 5-30 slider surfaces
them when a student widens the net.

## QUERY EXPANSION — BUILT (off by default), targeted-validated 2026-08-20

Files: `lib/rag/interest-expansion.ts` (the 17-chip → jargon map, Roman-audited) + `retrieveLabs`
`opts.expansionQuery` (additive low-weight arm; absent → behavior byte-identical to before) +
`eval-rag.ts --expand`. Corpus untouched; query-side only.

**Safe:** baseline (no expansionQuery) is unchanged; Parker (a strong chem-bio match) #1→#1 — expansion
never demotes a strong match. Additive fusion only ever ADDS a discounted bonus, never lowers a base
score.

**Helps where the chip is well-scoped:** Cravatt (the chemical-biology lab) #9→#7 for the chem-bio
chip, because that chip's jargon (chemoproteomics/covalent) IS his vocabulary, with no collateral.

**Doesn't help — and can't cleanly — for coarse multi-subfield chips.** Komor (gene editing) stays
>40 under "Genetics, genomics & epigenetics" because that chip's jargon is epigenetics-leaning.
Adding gene-editing terms lifts her (>40→#8) BUT demotes an epigenomics lab (Ecker #13→#26). The chip
lumps gene-editing + genomics + epigenetics; one expansion can't serve all three. This is chip-level
multi-topic dilution — a TAXONOMY problem, not a retrieval one. Real fix = a finer chip (split
"Genetics…" or add a "Gene editing / CRISPR" chip), which is a UI/product decision. Recommendation:
keep the Genetics chip's expansion conservative (epi-leaning, demotes nobody); let a gene-editing
student's RESUME carry "CRISPR"; revisit with a finer chip if the eval shows the niche matters.

**Can't validate via the golden set yet** — 3rd eval-faithfulness gap found: the eval profiles'
`interests` are free-text phrases ("chemical biology"), NOT the 17 fixed UI chips ("Biochemistry &
chemical biology") the map keys on, so `--expand` was a no-op through the golden set (the MRR wiggle
was distill LLM nondeterminism). To validate: re-express each profile's interests as real chips. BUT
chips are much BROADER than my phrases, which changes the relevant-lab set and the labels — a labeling-
model decision (Roman's call) before that realignment.

**Enable gate:** stays OFF until chip-aligned golden validation shows Recall↑ with P@5 flat. Targeted
tests give confidence it's safe, but production enable waits for the eval.

### REVERSAL after chip-aligned validation (2026-08-20) — do NOT enable as-built

Realigned the golden set's `interests` to the real 17 UI chips (was free text — see below). That
alone dropped mean Recall@20 71.8% (was 86.4% under the old, artificially-narrow free text) — the
earlier baseline was optimistic. Then re-ran expansion on the CORRECTED baseline:

| | mean R@20 |
|---|---|
| chip-based, no expansion | 71.8% |
| chip-based, WITH expansion | **65.8%** (worse, now fails the 70% floor) |

**Expansion's earlier win (Cravatt #9→#7) does not generalize.** It was validated against my own
hand-picked narrow phrase, not a real broad chip query. On the real shape, p03 lost ground (50%→42%,
also lost Roberto). Mechanism: the expansion arm retrieves on jargon ALONE; for a broad chip like
"Neuroscience & neurodegeneration" the jargon (neural circuit/synaptic/optogenetics/neurodegeneration)
is itself generic across dozens of unrelated neuro labs, so it adds noise instead of precision — the
same breadth-beats-bullseye failure already seen in decomposition, now inside expansion too. Narrow
chips (chem-bio) still plausibly benefit; broad ones actively hurt. Net negative on n=4.

**Verdict: stays OFF (unchanged — it always was). Do not flip it on as currently built.** Not tuning
further without labeling more profiles first — adjusting weights/jargon on n=4 would repeat the exact
mistake this eval exists to prevent. If revisited, the fix is likely PER-CHIP gating (enable only for
chips whose jargon is measurably discriminative, e.g. via corpus term-frequency spread) rather than a
single global weight — but that's a hypothesis, not a plan, until there's more data.

### Eval-faithfulness fix that CAUSED this correction — interests are real chips, not free text

Found via Roman asking "is this a UI change?" — clarified it wasn't (chips already existed, untouched)
but the EVAL's `interests` fields were invented free text ("chemical biology") instead of the real
chip strings ("Biochemistry & chemical biology") the app actually offers (`app/digest/page.tsx`,
17 fixed checkboxes, max 5, no free-text option). Fixed by copying every chip verbatim into PROFILES.
Two profiles don't fit any chip cleanly (p17 circadian rhythms, p18 autophagy/cell biology) — flagged
inline rather than forcing a bad match; a genuine chip-taxonomy coverage gap, not an eval bug. This is
the 4th time re-aligning the eval to the REAL product shape changed the answer — each time the eval
had been quietly testing an easier, unrealistic version of the actual problem.

## Method note

Bench scripts: `scripts/_bench_decomp.mjs` (latency + naive union), `_bench_decomp2.mjs` (scoring
shootout), `_diag_miss.mjs` (per-lab miss trace: distilled query → chunk rank → lab rank). Temp/
untracked; re-run or delete freely.
