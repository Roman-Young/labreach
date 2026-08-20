// ⚠️ REJECTED / UNUSED — kept only as a record of a measured-and-rejected experiment.
// NOTHING IMPORTS THIS FILE. Safe to delete. Do not wire it back in without re-reading
// data/eval/RAG-AUDIT.md § "Rejected changes".
//
// Verdict (2026-08-20): query expansion measured NET NEGATIVE on real UI-chip queries —
// mean Recall@20 71.8% → 65.8%. Its apparent win (Cravatt #9→#7) only existed against
// artificially narrow hand-written test phrases; on the broad chips the product actually
// sends, the jargon arm is itself generic and adds noise. The retrieval arm that consumed
// this was removed from lib/rag/retrieve.ts.
//
// ─── original header ───
// INTEREST-CHIP → FIELD-JARGON expansion map (RAG checklist, 2026-08-20).
//
// Why: students pick from a fixed 17-chip interest list (app/digest/page.tsx) in UMBRELLA terms
// ("Biochemistry & chemical biology"), but a field's marquee, most-specialized lab writes in JARGON
// and rarely uses the umbrella phrase — Cravatt's papers say "covalent / chemoproteomics", never
// "chemical biology"; Komor says "base editor", not "CRISPR gene editing". So the umbrella query and
// the best lab's real text don't intersect, and the lab ranks just outside the shown pool (Cravatt
// #20, Komor #19). See data/eval/DECISIONS.md "LEADING RETRIEVAL FIX".
//
// This bridges the two — QUERY-SIDE ONLY. The corpus is never touched: retrieval still matches the
// lab's real paper/website text. Every term below was verified to occur in real paper chunks (the
// distinct-lab count is in the comment); near-stopwords (>~40% of labs, e.g. "development"(251),
// "therapeutic"(260)) and dead-rare terms were deliberately cut so the expansion stays DISCRIMINATIVE.
// One entry helps every lab in that field at once (lab-agnostic). Keys must exactly match the chip
// strings in app/digest/page.tsx INTERESTS.
//
// Applied as a LOW-WEIGHT ADDITIVE retrieval arm (see retrieveLabs opts.expansionQuery): the base
// query runs unchanged at full weight; expansion can only ADD a discounted bonus to a chunk's score,
// never lower one — so the base ranking's strong matches are preserved and near-misses get promoted.
// OFF by default; enabled via LABREACH_QUERY_EXPANSION=1 only after golden-set validation
// (Recall up, Precision@5 flat). Roman-audited 2026-08-20.

export const INTEREST_EXPANSION: Record<string, string[]> = {
  'Cancer & oncology': ['oncogene', 'metastasis', 'carcinoma', 'tumor microenvironment'],
  'Immunology & immunotherapy': ['checkpoint', 'antibody', 'cytokine', 'macrophage'],
  'Microbiome & infectious disease': ['microbiome', 'pathogen', 'bacterial', 'viral'],
  'Neuroscience & neurodegeneration': ['neural circuit', 'synaptic', 'optogenetics', 'neurodegeneration'],
  'Stem cells & regenerative medicine': ['stem cell', 'iPSC', 'differentiation', 'organoid'],
  'Developmental biology': ['morphogenesis', 'cell fate', 'embryo', 'patterning'],
  'Genetics, genomics & epigenetics': ['genome', 'chromatin', 'methylation', 'epigenetic'],
  'Computational biology / bioinformatics / ML': ['machine learning', 'single-cell', 'algorithm'],
  'Structural biology & biophysics': ['cryo-EM', 'crystal structure', 'single-molecule', 'conformation'],
  'Biochemistry & chemical biology': ['chemoproteomics', 'activity-based protein profiling', 'covalent', 'small-molecule probe'],
  'Drug discovery & pharmacology': ['inhibitor', 'small molecule', 'medicinal chemistry', 'drug target'],
  'Cardiovascular & metabolic disease': ['cardiac', 'insulin', 'cardiomyocyte', 'lipid'],
  'Aging': ['senescence', 'longevity', 'age-related'],
  'Synthetic biology & bioengineering': ['synthetic biology', 'biosensor', 'biomaterial'],
  'Systems biology': ['signaling network', 'single-cell'],
  'Ecology & evolution': ['evolution', 'phylogenetic', 'adaptation'],
  'Public health / clinical informatics': ['cohort'],
}

// Return the de-duplicated jargon string for a set of selected interest chips (''= nothing to add).
// Unknown chips are ignored (no-op) — the closed chip set means this can't silently mismatch.
export function expandInterests(interests: string[] | undefined): string {
  const terms = new Set<string>()
  for (const chip of interests ?? []) for (const t of INTEREST_EXPANSION[chip] ?? []) terms.add(t)
  return [...terms].join(', ')
}
