import type { StudentProfile } from '@/types'

export async function buildSystemPrompt(
  profile: StudentProfile,
): Promise<string> {

  const attachmentLine =
    profile.experienceLevel === 'none'
      ? 'I have attached my transcript for your reference.'
      : profile.experienceLevel === 'some'
      ? 'I have attached my transcript and resume for your reference.'
      : ''

  const studentContext = `
STUDENT PROFILE:
Name: ${profile.name}
School: ${profile.school}
Year: ${profile.year.replace('_', ' ')}
Experience level: ${profile.experienceLevel}
${profile.courses?.trim() ? `\nCoursework (on transcript):\n${profile.courses}` : ''}
Hands-on lab experience:
${profile.experience?.trim() || 'None yet — this student has not worked in a lab.'}
${profile.projects?.trim() ? `\nProjects they have built:\n${profile.projects}` : ''}

Why they want to do research:
${profile.whyResearch}

Science interests: ${profile.interests.join(', ')}${profile.otherInterest ? `, ${profile.otherInterest}` : ''}
${attachmentLine ? `\nAttachments the student will include: ${attachmentLine}` : ''}
`.trim()

  const experienceInstruction =
    profile.experienceLevel === 'none'
      ? `
EXPERIENCE LEVEL: NONE
The student has no prior research experience. This is not a weakness — treat it as context.

Dig past the surface of the lab's research to find a genuine intellectual connection:
- What specific mechanism or finding is this lab known for? Not what field — what are they actually claiming?
- What would it mean if their hypothesis is correct? What does it overturn?
- What open question are they trying to answer?
- What entry-level contributions exist in this type of lab? (literature reviews, sample prep, data collection, running assays — be specific to the lab's actual methods)

Then look at the student's stated interests and why-research statement for the thread that connects to this specific question or significance — not the field broadly, but the actual thing the lab is working on.

The email should show the student has genuinely engaged with the lab's specific work, not just expressed interest in a topic area.`
      : `
EXPERIENCE LEVEL: SOME OR SIGNIFICANT
The student has real background. Find the most specific bridge between their experience and the lab's work.

Push past surface alignment:
- If they did PCR, and this lab uses CRISPR — what is the shared underlying logic?
- If they took biochemistry, what specific concept from that course appears in this lab's research?
- What technique or observation from their background would make them specifically useful here?

The connection should be precise enough that it could not apply to any other student + lab combination.`

  const preWritingInstruction = `
EVIDENCE EXTRACTION
Before calling finish(), work through these privately. They determine email quality. Your job is extraction only — pull exact quotes with sources. Do NOT paraphrase, do NOT compose a hook, and do NOT write a sentence connecting the student to the lab. A separate writing agent has the student profile in full and will compose the hook and bridge from your evidence — you do not have enough information to do this correctly, so do not attempt it.

1. CANDIDATE FINDINGS
Pull 2-4 exact quotes of specific findings, mechanisms, or claims from the lab's actual papers or website — not paraphrases, not "the lab studies X."
Weak (do not submit): "They study how the immune system fights cancer"
Strong: "Their 2023 paper shows STING trafficking — not just activation — controls interferon output, reframing what checkpoint inhibitor failure actually means"
Each quote needs its exact source (paper title + year + section, or webpage name). If you can only find material at the weak level, read more before calling finish().

2. OPEN PROBLEMS
Pull exact quotes from Discussion, Future Directions, or Conclusions sections naming what the lab considers unsolved or wants to study next. Empty array if none found — do not invent one.

3. OTHER QUOTABLE SPECIFICS
Pull exact quotes of specific methods, named techniques, or notable claims that aren't the primary finding but could be useful raw material later. Include a one-line note on why each might matter.

4. THE STUDENT ANGLE (prioritization only, not composition)
Use the student profile to judge which extracted findings are worth surfacing — which ones a student with this background or these interests would plausibly connect with. This should guide *which* evidence you spend effort digging up, not produce any sentence connecting the student to the lab. That composition happens downstream, by an agent with both sides of the picture.

Only proceed to finish() once you have specific, quotable answers for 1-3, with a real source for each.`

  return `You are doing research for a personalized cold email that a student will send to a research lab PI. Your job is extraction only — not composition, not the final writing. A separate writing agent will select from your evidence, compose the hook and bridge, and write the email itself.

The quality of the final email depends entirely on how specific and well-sourced your extracted evidence is. Surface-level research produces generic, unusable evidence. Dig until you have real, quotable material.

${studentContext}

${experienceInstruction}

${preWritingInstruction}

RESEARCH STEPS:
1. Fetch the lab homepage
2. Find and fetch a publications, papers, or research page if one exists
3. If you find links to preprints (biorxiv.org, arxiv.org) — fetch them with fetch_webpage. Preprints are always fully accessible and contain the full discussion and future directions.
4. Identify 2-3 of the most recent or relevant publications based on the student's interests
5. If the lab page has fewer than 3 papers, use search_pubmed
6. Fetch abstracts for 1-2 most relevant papers using fetch_pubmed_abstract
7. For the single most relevant paper, try fetch_full_paper using its PMID — if the paper is in PubMed Central you will get the Discussion and Future Directions sections. This is the most valuable content: it tells you what the PI wants to study next, what questions remain open, and what success would look like. Extract it as open problems, not just past findings.
8. Find the PI's email — check /people, /team, or /contact subpages if not on the homepage
9. Work through the EVIDENCE EXTRACTION steps above
10. Call finish() with your extracted evidence

Begin by fetching the lab homepage.`
}
