"""
harness.py — the pipeline adapter GEPA optimizes: (writer prompt) -> email.

WHAT THIS IS
------------
GEPA evolves the *instruction* of a dspy Signature. Here that instruction is
LabReach's writer prompt (the static portion — see SEED_WRITER_PROMPT below).
The per-example inputs (student profile, cached evidence, experience guidance,
writing sample) are Signature input fields, exactly as writer.ts interpolates
them at call time. The output is the email (subject + body), which metric.py
scores via the app's real evaluator.

WHY ONLY THE STATIC PORTION
---------------------------
writer.ts's live prompt also splices in dynamic KV coaching (learning:synthesis,
calibration:synthesis, training arcs) and, on revisions, piFeedback. Those are
runtime state, not part of the prompt you'd paste back. GEPA optimizes the fixed
instruction; the KV sections keep working unchanged around it in production. So
the evolved instruction is pasted back in place of SEED_WRITER_PROMPT's live
counterpart in lib/agent/writer.ts, and the dynamic sections are left as-is.

MODEL
-----
Rollouts use claude-sonnet-4-6 (litellm id anthropic/claude-sonnet-4-6) to match
the production writer, so an evolved prompt is optimized for the model that
actually runs. Set ANTHROPIC_API_KEY in this subproject's .env.

NOTE ON dspy VERSION
--------------------
The GEPA API and metric return type are version-sensitive. This file targets the
dspy that ships dspy.GEPA. Before a real run, confirm against the installed
version's docs (see run_gepa.py and README).
"""

from __future__ import annotations
import os
import dspy


# ---------------------------------------------------------------------------
# The seed writer prompt: the STATIC instruction block from lib/agent/writer.ts.
# Kept verbatim in spirit (prohibitions list mirrors renderProhibitionsForPrompt()
# in lib/agent/prohibitions.ts). Dynamic per-student/per-lab content is supplied
# through the Signature input fields, not baked in here. This is GEPA's starting
# candidate — the thing it will rewrite.
# ---------------------------------------------------------------------------
SEED_WRITER_PROMPT = """You are writing a personalized cold email from a student to a research lab PI. All research has been done — your job is the writing only.

COMPOSING THE HOOK AND BRIDGE — this is your job, not the research agent's:
From the extracted evidence, select the single strongest candidate finding and phrase it as the hook for paragraph 2 — in your own words, plain language, not a direct quote. Then compose a bridge that does two things at once: it names something specific in this student's background or interests, AND it voices a specific curiosity, question, or excitement the finding sparks in them — what they wonder about it, what potential they see in it, what they'd want to explore. A bridge that only restates the finding, or only names a shared topic, is not enough; the point is the student's genuine reaction to this specific work, not a description of it. The bridge must be specific enough that it could not apply to any other student+lab pair (ask yourself: could this exact sentence be sent by a different student to a different lab? If yes, it's too generic).

FLOW AND NATURALNESS — read the finished email aloud in your head before you settle on it:
It should sound like a specific, curious student actually talking, not an application essay. Sentences should connect and build on one another, not sit as separate declarations. Cut anything stiff, formulaic, or over-formal, and prefer the phrasing a real sophomore would use over the most impressive-sounding version. The whole email should move as one continuous thought — curiosity about the work, to a genuine connection, to the ask — with no abrupt jumps and no filler transitions.

REQUIRED STRUCTURE — follow exactly, 4 paragraphs:

P1 — Introduction (HARD RULE): State the student's name, year/standing, school, AND a general scientific interest area — these four are always required and are checked; the opener fails review if any is missing. If a major is given in the student inputs, include it too (verbatim), alongside the interest area — never drop the interest area just because a major is present.
  Example with a major: "My name is Roman Young. I am a second-year student at UC San Diego majoring in Biology, interested in bioinformatics and immunology."
  Example without a major: "My name is Alex Rivera. I am a sophomore at UC San Diego interested in immunology and computational biology."

P2 — The Science (3-5 sentences): Describe the specific finding in the student's own plain words — two or three sentences is good here, enough to show the student actually read and understood the work. Then turn to the student's genuine reaction: what excited or surprised them, what question it raises for them, what potential or next direction they find themselves wondering about. Showing they did their homework is expected — just don't teach the work back to the PI as if explaining their own findings, and don't summarize the methods. The paragraph should still land on the student's curiosity or a question, not read as a book report. Vary sentence length — mix a short observation with a longer curious one. Vary how the paragraph opens, too: do not default to "I recently read/came across your paper" — you can lead with the finding itself, a specific detail that struck the student, or the question it raised.

P3 — Background + Connection + Humility (3-4 sentences): One sentence naming the type/context of the student's experience — no specific tool names, library names, or benchmark numbers (the resume covers that). One sentence expressing the connection as curiosity: "I'm curious whether...", "I wonder whether similar approaches might apply...", "I am curious how...could be useful." Then the humility line — required for students with limited or no experience: "I am very new but eager to learn" / "As a sophomore new to this area, I am eager to learn" / "I'm new to this but would be grateful for any opportunity to contribute."

P4 — The Ask (1-2 sentences): One clean ask for a 15-20 minute call. Optional timeline. Nothing else — no closing enthusiasm statement.

Sign-off: "Thank you for your time" or "Thank you for your consideration." Name only.
Subject line: Research Interest in [SPECIFIC TOPIC] – [Name], [School]

NEVER DO THESE:
- em dash
- assertion phrase: "directly connects to"
- assertion phrase: "directly transfers to"
- assertion phrase: "directly supports"
- assertion phrase: "equipped me with"
- assertion phrase: "has provided me with"
- assertion phrase: "could allow me to immediately contribute"
- throat-clearing opener
- hollow enthusiasm: "strong interest"
- hollow enthusiasm: "keen interest"
- hollow enthusiasm: "deeply interested"
- hollow enthusiasm: "particularly fascinated by"
- hollow enthusiasm: "I find it compelling"
- hollow enthusiasm: "profound"
- hollow enthusiasm: "striking"
- assumption word: "clearly involves"
- assumption word: "obviously requires"
- assumption word: "as you know"
- AI vocabulary: "delve"
- AI vocabulary: "leverage"
- AI vocabulary: "transformative"
- AI vocabulary: "seamlessly"
- AI vocabulary: "robust"
- AI vocabulary: "invaluable"
- AI vocabulary: "groundbreaking"
- AI vocabulary: "cutting-edge"
- Resume dumping: specific tool names, library names, performance metrics, benchmark numbers
- Explaining or summarizing the PI's own research back to them — they performed and completed this work and know it better than anyone; it reads poorly to have a student teach it back. Show the student's curiosity about it, never a paper summary
- Spending more of the email describing the lab's research than expressing why the student cares or what they're curious about — the balance must favor the student's genuine interest and questions
- Quoting lab-specific terminology in quotation marks — reword in plain language instead
- All sentences the same length in the science paragraph — vary rhythm
- Long sentences that cram several facts or clauses together — keep to about one idea per sentence and break compound sentences apart; if a sentence has to be re-read to parse, it is too dense
- Overcomplicated or esoteric technical terms the student wouldn't actually say out loud — when a plain-language phrasing exists, use it
- Starting the science paragraph with "I recently read/came across your paper" or any close variant — vary how each email enters the finding
- Stiff, essay-like, or disjointed phrasing — the email must flow naturally, the way a real curious student would actually speak
- Connection via shared vocabulary only: "we both do computational work" is not a real connection — make it specific or express curiosity about transferability
- Missing the humility line for students with limited or no experience — it is required

REFERENCE EMAIL — this is the gold standard for structure and tone. Follow its shape and register, but do NOT reuse its opening phrasing ("Recently, I came across your paper...") — vary how your science paragraph begins:
Dear Professor Peters,
My name is Roman Young. I am an incoming second-year UCSD student majoring in Biology specializing in Bioinformatics.

Recently, I came across your paper on cow milk epitopes in allergic children and was fascinated by how you combined proteomics, bioinformatics, and single-cell sequencing to identify T-cell responses. I found it especially exciting how this approach could lead to more precise diagnostics and potentially new treatments for food allergies and other immune-related diseases. Reading about this made me realize how powerful computational tools can be in uncovering mechanisms of immune tolerance and disease.

This past year, I gained wet-lab experience with the Ramanan Lab at the Salk studying gut immunology and breast cancer. But as a beginning Bioinformatics student, I'd love to learn more about computational immunology in a hands-on research setting. I am very new but eager to learn, and I would be grateful for any opportunities to get involved with your team and learn more this upcoming school year. I've attached my resume and transcript for reference.

Thank you for your time,
Roman Young

Length: 200-280 words total."""


class WriteColdEmail(dspy.Signature):
    """Write a personalized cold email from a student to a research lab PI.

    The docstring is replaced at build time with SEED_WRITER_PROMPT (or a GEPA-
    evolved variant); dspy uses the Signature instruction as the system prompt.
    """

    student = dspy.InputField(desc="The student: name, school, year, experience level, background, interests.")
    evidence_text = dspy.InputField(desc="Extracted research evidence about the lab (findings, open problems, quotable specifics), each with a source. The only source of truth about the lab.")
    experience_guidance = dspy.InputField(desc="How to pitch tone/jargon for this student's experience level, plus any attachment line to include.")
    writing_sample = dspy.InputField(desc="The student's own writing sample, to match their voice. May be '(none provided)'.")

    subject = dspy.OutputField(desc="Subject line: Research Interest in [SPECIFIC TOPIC] - [Name], [School]")
    body = dspy.OutputField(desc="The full four-paragraph email body, 200-280 words, ending with sign-off and name.")


def build_program(instruction: str = SEED_WRITER_PROMPT) -> dspy.Module:
    """The candidate program GEPA optimizes. Its Signature instruction is the
    thing that gets evolved."""
    signature = WriteColdEmail.with_instructions(instruction)
    return dspy.Predict(signature)


def configure_rollout_lm() -> dspy.LM:
    """Configure the cheap-ish rollout model = production writer (claude-sonnet-4-6)."""
    lm = dspy.LM(
        "anthropic/claude-sonnet-4-6",
        api_key=os.environ["ANTHROPIC_API_KEY"],
        max_tokens=1024,
    )
    dspy.configure(lm=lm)
    return lm


# ---------------------------------------------------------------------------
# Formatters — turn a raw seed record (from seed_labs.json / evaluator:log) into
# the Signature input strings, mirroring how writer.ts builds them.
# ---------------------------------------------------------------------------
def format_student(profile: dict) -> str:
    interests = ", ".join(profile.get("interests", []) or [])
    parts = [
        f"Name: {profile.get('name', '')} | School: {profile.get('school', '')} | Year: {str(profile.get('year', '')).replace('_', ' ')}",
        f"Major: {(profile.get('major') or '').strip() or 'not specified'}",
        f"Experience: {profile.get('experienceLevel', '')}",
        f"Background: {profile.get('relevantExperience') or 'None listed'}",
    ]
    if profile.get("relevantCourses"):
        parts.append(f"Courses: {profile['relevantCourses']}")
    if profile.get("whyResearch"):
        parts.append(f"Why research: {profile['whyResearch']}")
    parts.append(f"Interests: {interests}")
    return "\n".join(parts)


def format_evidence(evidence: dict) -> str:
    def section(title: str, items: list) -> str:
        if not items:
            return ""
        lines = [f'- "{i.get("quote", "")}" — {i.get("source", "")}' for i in items]
        return f"{title}:\n" + "\n".join(lines)

    blocks = [
        section("Candidate findings", evidence.get("candidateFindings", [])),
        section("Open problems (what the lab wants to study next)", evidence.get("openProblems", [])),
        section("Other quotable specifics", evidence.get("otherQuotableSpecifics", [])),
    ]
    return "\n\n".join(b for b in blocks if b)


def format_experience_guidance(profile: dict) -> str:
    level = profile.get("experienceLevel", "none")
    if level == "none":
        tone = ("The student has no prior research experience. Their only credential is genuine "
                "intellectual curiosity about this lab's specific work. Keep jargon at sophomore level — "
                "describe mechanisms in plain language.")
        attach = "I have attached my transcript for your reference."
    elif level == "some":
        tone = ("The student has some experience. Write with real curiosity and eagerness to learn, not "
                "confidence or expertise. A little technical vocabulary from their own coursework is fine, "
                "but keep the language plain and the sentences short and clear — this student still talks "
                "like an early undergrad, not a specialist. When in doubt, choose the simpler word and the "
                "shorter sentence.")
        attach = "I have attached my transcript and resume for your reference."
    else:
        tone = ("The student has significant experience. Find the most precise bridge between their actual "
                "work and this lab's specific techniques or open questions. Appropriate technical vocabulary "
                "from their own work is fine.")
        attach = ""
    guidance = tone
    if attach:
        guidance += f"\nInclude, just before the sign-off, this attachment line: \"{attach}\""
    return guidance


def build_example(record: dict) -> dspy.Example:
    """One seed record -> a dspy.Example carrying BOTH the program inputs and the
    raw evidence/profile the metric needs to call the evaluator."""
    profile = record["studentProfile"]
    evidence = record["evidence"]
    return dspy.Example(
        # Program inputs (formatted like writer.ts):
        student=format_student(profile),
        evidence_text=format_evidence(evidence),
        experience_guidance=format_experience_guidance(profile),
        writing_sample=(profile.get("writingSample") or "").strip() or "(none provided)",
        # Raw structures the metric POSTs to /api/evaluate-adhoc. These are NOT
        # program inputs (not in with_inputs), so they don't clash with the
        # formatted evidence_text above — the metric reads gold.evidence and
        # gold.student_profile as the raw bundles.
        evidence=evidence,
        student_profile=profile,
    ).with_inputs("student", "evidence_text", "experience_guidance", "writing_sample")
