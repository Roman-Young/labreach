// Single source of truth for which Gemini model each stage uses. All three are
// env-configurable with a free-tier-friendly default (2.5 Flash everywhere), so a
// friend who clones the repo runs entirely free on one API key, while the owner's
// deploy can point the writer at a stronger model for a better starting draft.
//
//   GEMINI_WRITER_MODEL    — prose composition (writer.ts). Worth spending on: a
//                            better first draft means less editing in the review queue.
//   GEMINI_RESEARCH_MODEL  — structured extraction (research tool-loop + digest).
//   GEMINI_EVAL_MODEL      — classification (evaluator + the synthesis jobs).
//
// These are read at call time (not module-load) so tests and scripts can override
// the env between calls.

const DEFAULT_MODEL = 'gemini-2.5-flash'

export function writerModel(): string {
  return process.env.GEMINI_WRITER_MODEL?.trim() || DEFAULT_MODEL
}

export function researchModel(): string {
  return process.env.GEMINI_RESEARCH_MODEL?.trim() || DEFAULT_MODEL
}

export function evalModel(): string {
  return process.env.GEMINI_EVAL_MODEL?.trim() || DEFAULT_MODEL
}
