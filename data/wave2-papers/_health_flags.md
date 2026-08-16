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

## Wave-13 topic flags (2026-08-16) — VERIFIED via deterministic sweep, ALL CLEARED (0 contaminants)
Final 9 labs summarized tonight (wave 13), bringing the corpus to 118/118 summarized. Separately, a
pre-existing gap was found and fixed: 9 already-gathered labs (Kaufman, Kumsta, Su, Talmo Pereira,
Mendoza, Ward, Williamson, Wiseman, Kuo-Fen Lee) had `.papers.json` but were missing `.summary.json`
— written directly tonight from the already-vetted paper extractions (no re-summarization needed).

Topic-breadth flags raised by summarizing agents, verified with `/tmp/verify_flags2.ts` (fetch by
DOI, check PI-surname author's first name + affiliation/ORCID) — ALL confirmed legitimate, same
false-positive pattern as every prior wave:
- **Stowers (Lisa Stowers Anderson)**: "Less is more..." (doi:10.1016/j.neuron.2021.05.010) is a
  Neuron *Previews* commentary WRITTEN BY the Stowers lab (Palle, Mukhopadhyay, Stowers — author
  email stowers@scripps.edu) about the Leinwand/Scott primary paper, not authored by them. The
  in-bundle title differs from the flag's search term ("juvenile hormone"), which is what triggered
  the false flag. KEEP both papers.
- **Yip (Kevin Yip)**: HIRA/PML/p62 paper and HDAC8-inhibitor paper share the IDENTICAL ORCID
  (0000-0001-5516-9944) — confirmed the same person, with a dual Sanford Burnham Prebys / CUHK CSE
  appointment. KEEP both.
- **Lee (Kuo-Fen Lee, Salk)**: all 3 flagged papers (2 epigenomics/BICCN, 1 primate PFC) have a
  first-name + "Peptide Biology Laboratories, Salk" affiliation match. KEEP all 3 (wide collaborative
  footprint, consistent with his established pattern from the wave-1 Gate-B fix).
- **Su (Andrew Su)**: T1D extraislet-vasculature paper — author "andrew i su", Scripps ISCB
  affiliation, exact match. KEEP.
- **Talmo Pereira**: all 3 flagged papers have "talmo" as first name (Salk affiliation on 1, absent
  on 2 — kept per no-affil rule). Consistent with the wave-7 finding that all 12 Pereira papers are
  legit. KEEP all 3.
- **Wiseman (R. Luke Wiseman)**: DM cryo-EM methods paper author format ("luke wiseman", no
  affiliation/ORCID in source) is IDENTICAL to a known-core-theme Wiseman paper (AA147) from the same
  bioRxiv metadata source — not a mismatch, just a data-source gap. KEEP.
- Henderson, Sanna, Topol, Park, Xiaotian, Kaufman, Kumsta, Mendoza, Williamson, Ward: reviewed,
  thematically coherent, no flags raised.

CONCLUSION: wave-13 adds 0 new contaminants. Corpus-wide, the layered gates + this sweep have now
verified every topic-breadth flag raised across all 13 waves as a legitimate collaboration or
cross-field work; the only real contaminants ever found remain Osterman (hand surgeon), Dan-S
Kaufman, pediatric Hogan, and Rao stranger (all fixed at gather time).

REMAINING KNOWN ISSUE (unchanged, for the store pass): Wiseman lab has 3 preprint/published
duplicate pairs (AA147, PDIA1 x2, XBP1s/CMT1B) — the largest batch found — reinforcing the
title-similarity dedup fix already required for Millar/Parker/Sung Han before `wave2-pub-store.ts`.

## Wave-14 re-harvest (2026-08-16) — 7 labs stored, all topic-flags CLEARED (0 contaminants)
Re-harvested the 11 manual-flag labs with Roman's direct pub-page links. Results:
- **STORED (7):** Roberto (18, addiction/CeA neuroscience), Xiang-Lei Yang (18, aaRS moonlighting —
  stored under labUrl scripps.edu/schimmel/about.html), Lamia (12, circadian/cancer/metabolism),
  MacRae (8, Argonaute/PIWI structural biology), Teyton (4, lipid-antigen autoimmunity), Schimmel
  (2, aaRS), Diercks (2, directed-evolution protein engineering). Embedded (64 chunks). Tests 44/44.
- **Topic flags — both VERIFIED CLEAN** (deterministic DOI→author sweep):
  - Schimmel "sperm small non-coding RNA aging" (doi:10.1038/s44318-025-00687-8): author "paul
    schimmel" @ Scripps Molecular Medicine — tRNA-fragment work adjacent to his synthetase program. KEEP.
  - Yang "PANDORA-seq" (doi:10.1038/s41556-021-00652-7): author "xiang lei yang" @ same dept — tRNA-
    fragment methodology collab. KEEP. (Schimmel & Yang share a lab page; both do tRNA biology.)
- **Lamia preprint near-dup — MANUALLY DROPPED 1.** ccRCC/BMAL1-HIF2α study listed 3×: published
  (Nat Commun 2025, doi:10.1038/s41467-025-60904-0) + bioRxiv + Research Square. RS collapsed via
  exact-title dedup; the bioRxiv "BMAL1-HIF2α heterodimers contribute to ccRCC"
  (doi:10.1101/2024.06.07.597806) has a DIFFERENT title from the published version, so exact-title
  dedup (and even the handoff's ≥0.9 rule) missed it — dropped manually (published version present).
  13→12. **KNOWN LIMITATION:** differently-titled preprint/published pairs are NOT auto-caught; other
  labs may harbor similar near-dups (not audited corpus-wide).
- **EXCLUDED (1):** Karen Ocorr — re-harvest got 27 DOIs off her own page but newest is 2020 (0 within
  5-yr floor). Genuinely stale → status='excluded' + chunk quarantined.
- **STILL FAILED — need manual DOI lists from Roman (3):** Eric Wang (ewanglab.com — pubs are a JS/
  widget render, textLen~389, 0 ids even after clicking "2022-present"); Shannon Miller
  (millerlabresearch.com — pubs not in extractable text); Chunlei Wu (Google Scholar exposes titles
  but no DOIs). "Fail loud, flag, never guess" — not faked. Wu also has the wulab.io PROJECTS request.
