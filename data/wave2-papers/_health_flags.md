# Wave-2 paper ingest — health-check flag log (for Roman)

Running log of every data-quality flag raised during the summary waves, with verdict.

## Contamination (author collision) — CAUGHT + FIXED
- **Andrei Osterman (SBP)**: PubMed affil-search pulled a hand surgeon "Osterman AL" (Thomas
  Jefferson Orthopaedics). ROOT CAUSE: page's PubMed link had [Author] but no [Affiliation].
  FIX: force institute [Affiliation] into esearch + gather Gate C. Re-verified CLEAN (18 papers,
  all Sanford Burnham microbiome/AMR, 0 orthopedics).

## Topic-breadth flags — REVIEWED, papers are LEGIT (kept)
- **Andrei Osterman**: 2 cancer papers (MYCN neuroblastoma, LINE-1) among microbiome work —
  SBP-affiliated, he's a broad computational systems biologist. Likely collaborations.
- **Ani Deshpande**: 4 papers flagged off-core-theme (Down syndrome, PDAC macropinocytosis,
  peptide-ML, SARS-CoV-2). VERIFIED: every one has "Aniruddha J" (his exact name) as author +
  SBP affiliation → genuine collaborations, NOT a different Deshpande. Kept.

## Duplicate paper (preprint + published)
- **David Millar**: eLife paper + its bioRxiv preprint both in bundle (different DOIs). Store-time
  dedup must collapse by title similarity, not just DOI. TODO at store.

## Wrong-person papers dropped by first-name Gate B (2026-08-15)
- **Randal J. Kaufman**: dropped "HSF1 glyco-immune surveillance" (32-author collab) — the "Kaufman"
  author is Dan S. Kaufman (UCSD, different person). 3→2 papers. CONFIRMED contaminant, removed.
- **Kuo-Fen Lee**: dropped 1 paper (a same-surname "Lee" with a mismatching first name). 8→7.
Only these 2 labs affected across the whole corpus — the gate is surgical.

## Wave-7 topic flags — REVIEWED, both LEGIT (kept)
- **Talmo Pereira** (pose-estimation): 3 pure-neuroscience papers flagged — all 12 have a
  first-name-compatible Pereira author. Legit collaborations, topic breadth. Kept.
- **R. Luke Wiseman**: cryo-EM detergent paper flagged off UPR-theme — he's "R Luke Wiseman"
  (middle name); all papers author-verified. Kept. (Gate correctly used "R" initial.)

## Same-first-name cross-institution strangers dropped by Gate-C-on-LJI (2026-08-16)
- **Patrick Hogan (LJI)**: dropped a pediatric-hospital time-motion paper by a DIFFERENT Patrick
  Hogan (Ranken Jordan Pediatric Bridge Hospital — same first name, affiliation != LJI). 6→5.
- **Anjana Rao (LJI)**: dropped 1 same-name non-LJI paper. 11→10.
- Samuel Myers globupain paper KEPT (Samuel A. Myers IS at LJI — verified real collaboration).

## Consolidated pre-store verification sweep (2026-08-16) — ALL topic-flags cleared
Verified every agent topic-flag by first-name + affiliation. ALL are the correct PI (legit
collaborations or cross-field work), 0 actual contaminants:
- Peng Wu ×4: all "Peng" Wu at Scripps (common-name fear unfounded). KEEP.
- Timothy Y. Huang (senescence, tapasin): his Sanford Burnham collaborations. KEEP.
- Sette (HSCT case report), Saphire (HLA transplant), Sharma (doxorubicin), Boutros (exercise):
  all the real PIs, correct name+affiliation. KEEP.
- de Carvalho (Leishmania): his OWN earlier Brazil parasitology work ("Renan V H de Carvalho",
  switched fields). KEEP.
- Parker (atherosclerosis): genuinely Christopher Parker. KEEP.
CONCLUSION: the layered gates caught every real contaminant (Osterman hand-surgeon, Dan-S
Kaufman, pediatric Hogan, Rao stranger); remaining agent flags are topic-breadth false positives.
