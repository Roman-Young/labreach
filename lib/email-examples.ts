// Real outreach emails from LabReach's author that got responses (one led to a position). Shown on
// the compose page as annotated case studies — NOT more templates. Their job is the one thing a
// template can't do: calibrate tone, depth, and specificity, and show how the [bracketed prompts]
// look when a real person fills them honestly. PI names are anonymized ("Professor [X]"); the
// science is kept because specificity is the whole lesson. Curated for VARIETY over count — three
// distinct situations, not five near-duplicates — so the takeaway is "study why each line works,"
// never "copy this shape."
//
// Each annotation's `quote` is a verbatim substring of `body`; the UI highlights it and shows the
// note beneath. Keep them verbatim or the highlight silently fails to match.

export interface EmailAnnotation {
  quote: string // must appear verbatim in body
  note: string
}
export interface EmailExample {
  id: string
  scenario: string // the situation this models, in a few words
  body: string
  annotations: EmailAnnotation[]
}

export const EMAIL_EXAMPLES: EmailExample[] = [
  {
    id: 'building-on-prior',
    scenario: 'Second-year — building on prior research (this one led to a position)',
    body: `Dear Professor [P],

My name is Roman Young, and I am an incoming second-year UCSD student majoring in Biology with a specialization in Bioinformatics.

This past year, I worked in a lab at the Salk on gut immunology and breast cancer projects, which showed me how much there is still to learn about immune responses in complex environments. It also motivated me to explore how computational approaches could complement traditional immunology.

Reading your paper on identifying cow milk epitopes in allergic children fascinated me, especially how bioinformatics tools and peptide pooling helped uncover disease-specific T-cell responses. It struck me as an elegant way to combine big-data analysis with immunology, and I'm curious about its broader applications to map T-cell responses in other allergic or autoimmune conditions — even progressive steps toward highly personalized medicine.

As an eager learner, I would love the chance to explore bioinformatics and contribute in your lab if there are opportunities this year.

Thank you for your time,
Roman Young`,
    annotations: [
      {
        quote: 'This past year, I worked in a lab at the Salk on gut immunology and breast cancer projects, which showed me how much there is still to learn',
        note: 'The prior-experience version of the background bracket: what you did + what it taught you, in one sentence. "How much there is still to learn" is honest and confident — no overselling.',
      },
      {
        quote: 'It also motivated me to explore how computational approaches could complement traditional immunology.',
        note: 'Bridges past work to what you want next. This is what makes the next paragraph feel earned instead of random.',
      },
      {
        quote: 'especially how bioinformatics tools and peptide pooling helped uncover disease-specific T-cell responses',
        note: 'Names the specific technique that hooked you, not just the topic. Precision is the clearest signal that you actually read the paper.',
      },
      {
        quote: "I'm curious about its broader applications to map T-cell responses in other allergic or autoimmune conditions",
        note: "A forward-looking question — you're thinking past the paper. This is the reaction the [react to their work] bracket is asking for.",
      },
    ],
  },
  {
    id: 'first-year-coursework',
    scenario: 'First-year — no research experience yet',
    body: `Hi Professor [L],

My name is Roman Young. I am a first-year UCSD student majoring in Biology with a specialization in Bioinformatics. I am reaching out to ask if you would consider me to volunteer in your laboratory.

I am interested in the intersection of medicine and hypothesis-driven research and plan to pursue a career in biotechnology. I would love to participate in your team's research on neural circuit computations for memory and how their dysfunctions contribute to neurological disease. I found your recent publication on localized hAPP expression in CA3 pyramidal cells and its effects on memory loss particularly fascinating — the discovery that disrupted timing in neuron activity can happen even in cells not directly affected by hAPP is especially intriguing. How specifically could restoring these timing patterns offer new ways to treat early Alzheimer's symptoms, even before plaques form?

This coming winter quarter I plan to take Bild 4 and Bild 5, building the lab skills and quantitative techniques I'd want to apply in your lab in real time. I'm hoping my eagerness to learn, work ethic, and creativity can contribute to your work. For reference, my resume is attached.

Thank you for your consideration,
Roman Young`,
    annotations: [
      {
        quote: 'I found your recent publication on localized hAPP expression in CA3 pyramidal cells and its effects on memory loss particularly fascinating',
        note: "Names ONE specific paper — not 'your research.' If you can't do this yet, you haven't read enough. This is the [specific finding] bracket done right.",
      },
      {
        quote: 'the discovery that disrupted timing in neuron activity can happen even in cells not directly affected by hAPP is especially intriguing',
        note: 'Restates the finding in your own words — proof you understood it, grounded in something real from the paper.',
      },
      {
        quote: "How specifically could restoring these timing patterns offer new ways to treat early Alzheimer's symptoms, even before plaques form?",
        note: 'A genuine question that only makes sense if you understood the result. This is what separates a real email from a template.',
      },
      {
        quote: 'This coming winter quarter I plan to take Bild 4 and Bild 5, building the lab skills',
        note: "The background bracket with NO research yet: honest coursework + timing. A first-year doesn't need to fake experience — this got a response.",
      },
    ],
  },
  {
    id: 'first-year-different-field',
    scenario: 'First-year — different field, same approach',
    body: `Hi Professor [K],

My name is Roman Young. I am a first-year UCSD student majoring in Biology with a specialization in Bioinformatics. I am reaching out to ask if you would consider me to volunteer in your laboratory.

While exploring your team's work, I found it striking how you take the fundamental science of motor proteins and look to leverage it for medical applications. It fascinates me that dynein, a key motor protein, can shift from an inactive "Phi" state to an active form that transports essential cargo within cells — and what that could mean for neurodegenerative disease. Your use of cryo-EM to capture these changes and study the role of Lis1 in activating dynein really draws me in, and it builds on what I first learned in AP Biology. I'm curious how the different dynein shapes affect cell division, and I'd love to contribute to projects like these.

Although as a first-year I don't have formal research experience yet (I'm taking Bild 4 and 5), I hope my eagerness to learn, work ethic, and creativity can contribute positively to your lab. If given the opportunity, I'll be in San Diego over the summer to keep volunteering. My resume is attached.

Thank you for your consideration,
Roman Young`,
    annotations: [
      {
        quote: 'dynein, a key motor protein, can shift from an inactive "Phi" state to an active form that transports essential cargo within cells',
        note: "Explains a technical finding in plain, own words. You don't need to sound like an expert — you need to show you understood it.",
      },
      {
        quote: 'it builds on what I first learned in AP Biology',
        note: 'Honest about your level. Naming where your understanding comes from is disarming, not disqualifying.',
      },
      {
        quote: "I'm curious how the different dynein shapes affect cell division",
        note: "One forward question is enough. It shows you're thinking beyond what you read.",
      },
      {
        quote: "I'll be in San Diego over the summer to keep volunteering",
        note: 'Concrete availability removes a logistical objection before they raise it — pairs with the [hours/week + quarters] slot in the skeleton.',
      },
    ],
  },
]
