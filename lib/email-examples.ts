// Real outreach emails from LabReach's author that got responses (one led to a position). Shown on
// the compose page as annotated case studies, NOT more templates. Their job is the one thing a
// template can't do: calibrate tone, depth, and specificity, and show how the [bracketed prompts]
// look when a real person fills them honestly. Bodies are the author's VERBATIM emails; the only
// edits are anonymization (student name to "[Your name]", PI/lab names to "[P]"/"[L]"/"[K]"/"[R]",
// "the Salk" kept) and no em dashes. Curated for VARIETY over count, so the takeaway is "study why
// each line works," never "copy this shape."
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
    scenario: 'Second-year, building on prior research (this one led to a position)',
    body: `Dear Professor [P],

My name is [Your name], and I am an incoming second-year UCSD student majoring in Biology with a specialization in Bioinformatics.

This past year, I worked in the [R] Lab at the Salk on gut immunology and breast cancer projects, which showed me how much there is still to learn about immune responses in complex environments. It also motivated me to explore how computational approaches could complement traditional immunology.

Reading your paper on identifying cow milk epitopes in allergic children fascinated me, especially how bioinformatics tools and peptide pooling helped uncover disease-specific T-cell responses. It struck me as an elegant way to combine big-data analysis with immunology and I'm curious about its broader applications to map T-cell responses in other allergic or autoimmune conditions. Or even progressive steps towards highly personalized medicine.

As an eager learner, I would love the chance to explore Bioinformatics and contribute in your lab if there are opportunities this year.

Thank you for your time,
[Your name]`,
    annotations: [
      {
        quote: 'This past year, I worked in the [R] Lab at the Salk on gut immunology and breast cancer projects, which showed me how much there is still to learn',
        note: 'The prior-experience version of the background bracket: what you did and what it taught you, in one sentence. "How much there is still to learn" stays honest and confident without overselling.',
      },
      {
        quote: 'It also motivated me to explore how computational approaches could complement traditional immunology.',
        note: 'Bridges past work to what you want next, so the next paragraph feels earned instead of random.',
      },
      {
        quote: 'especially how bioinformatics tools and peptide pooling helped uncover disease-specific T-cell responses',
        note: 'Names the specific technique that hooked you, not just the topic. Precision is the clearest signal that you actually read the paper.',
      },
      {
        quote: "I'm curious about its broader applications to map T-cell responses in other allergic or autoimmune conditions",
        note: 'A forward-looking question shows you are thinking past the paper. This is the reaction the react-to-their-work bracket asks for.',
      },
    ],
  },
  {
    id: 'first-year-coursework',
    scenario: 'First-year, no research experience yet',
    body: `Hi Dr. [L],

My name is [Your name]. I am a first-year UCSD student majoring in Biology specializing in Bioinformatics. I am reaching out to ask if you would consider me to volunteer in your laboratory.

I am interested in the intersection of medicine and hypothesis-driven research and plan to pursue a career in Biotechnology in the future. Therefore, I would love to participate in your team's research on neural circuit computations for memory and how dysfunctions contribute to various neurological diseases. I found your recent publication on localized hAPP expression in CA3 pyramidal cells and its effects on memory loss particularly fascinating. The discovery that disrupted timing in neuron activity can happen even in cells not directly affected by hAPP is especially intriguing. How specifically could restoring these timing patterns offer new ways to treat early Alzheimer's symptoms, even before plaques form? I'm inspired by the potential of this work and would love to learn more!

To couple this interest, this upcoming winter quarter, I plan to take Bild 4 and Bild 5, mastering critical lab skills and refining my experimental design and quantitative analysis techniques, respectively. Pursuing this courseload and a research opportunity concurrently will greatly increase my aptitude for wet lab work and help me hone my skills and apply what I learn to the lab's fascinating research in real time.

I am hoping that my eagerness to learn, work ethic, and creativity will provide fruitful contributions to your lab. For reference, attached is my resume.

Thank you for your consideration,
[Your name]`,
    annotations: [
      {
        quote: 'I found your recent publication on localized hAPP expression in CA3 pyramidal cells and its effects on memory loss particularly fascinating',
        note: "Names ONE specific paper, not 'your research.' If you can't do this yet, you haven't read enough. This is the specific-finding bracket done right.",
      },
      {
        quote: 'The discovery that disrupted timing in neuron activity can happen even in cells not directly affected by hAPP is especially intriguing',
        note: 'Restates the finding in your own words, which proves you understood it and keeps it grounded in something real from the paper.',
      },
      {
        quote: "How specifically could restoring these timing patterns offer new ways to treat early Alzheimer's symptoms, even before plaques form?",
        note: 'A genuine question that only makes sense if you understood the result. This is what separates a real email from a template.',
      },
      {
        quote: 'this upcoming winter quarter, I plan to take Bild 4 and Bild 5, mastering critical lab skills',
        note: 'The background bracket with no research yet: honest coursework and timing. A first-year does not need to fake experience, and this got a response.',
      },
    ],
  },
  {
    id: 'first-year-different-field',
    scenario: 'First-year, different field, same approach',
    body: `Hi Dr. [K],

My name is [Your name]. I am a first-year UCSD student majoring in Biology specializing in Bioinformatics. I am reaching out to ask if you would consider me to volunteer in your laboratory.

While exploring your team's work, I found it interesting how you're taking the fundamental science of motor proteins work and looking to leverage its potential for medical applications. I find it exciting that dynein, a key motor protein, can change its shape from an inactive "Phi" state to an active form that transports essential cargoes within cells and what it could mean for neurodegenerative disease. Your use of cryo-EM to capture these changes and study the role of Lis1 in activating dynein really fascinates me and builds on my understanding from AP Biology in high school. The implications of understanding what goes wrong in diseases when a cell's motor system is disrupted are promising and I'm curious how the different dynein shapes affect cell division. I'd love to contribute to similar projects!

Although as a first-year I do not have any previous formal research experience (though I am taking Bild 4 and 5), I hope that my eagerness to learn, work ethic, and creativity will allow me to make a positive contribution to your lab. Additionally, if given the opportunity, I will be spending the summer in San Diego to continue volunteering. For reference, attached is my resume and UCSD transcript.

Thank you for your consideration,
[Your name]`,
    annotations: [
      {
        quote: 'dynein, a key motor protein, can change its shape from an inactive "Phi" state to an active form that transports essential cargoes within cells',
        note: 'Explains a technical finding in plain words of your own. You do not need to sound like an expert, only to show you understood it.',
      },
      {
        quote: 'builds on my understanding from AP Biology in high school',
        note: 'Honest about your level. Naming where your understanding comes from is disarming, not disqualifying.',
      },
      {
        quote: "I'm curious how the different dynein shapes affect cell division",
        note: 'One forward question is enough. It shows you are thinking beyond what you read.',
      },
      {
        quote: 'I will be spending the summer in San Diego to continue volunteering',
        note: 'Concrete availability removes a logistical objection before they raise it, and pairs with the hours-per-week and quarters slot in the skeleton.',
      },
    ],
  },
]
