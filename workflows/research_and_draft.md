# Workflow: Research Lab and Draft Cold Email

## Objective
Research a specific research lab and draft a personalized cold email from a student seeking a volunteer or research assistant position. The email should feel genuinely written, not templated — the student's goal is to secure a 15-20 minute meeting or call with the PI.

## Required Inputs
- Student profile (name, school, year, experience level, relevant background, why research, science interests)
- Lab URL
- Selected email style example

## Research Steps

### Step 1: Fetch Lab Homepage
- Call `fetch_webpage` with the lab URL
- Extract: lab name, PI name, research focus, any links to subpages

### Step 2: Find Publications
- Look for links to /publications, /papers, /research, or /work pages
- Call `fetch_webpage` on the publications page if found
- Identify 2-3 papers most relevant to the student's stated interests

### Step 3: PubMed Fallback
- If the lab website has fewer than 3 papers with meaningful descriptions:
  - Call `search_pubmed` with the PI's name + their primary research area
  - Identify 1-2 relevant results
  - Call `fetch_pubmed_abstract` for the most relevant paper(s)

### Step 4: Find PI Contact Info
- Look for the PI's email address on the lab homepage
- If not found, try fetching a /people, /team, or /contact subpage
- If still not found, leave pi_email as empty string

### Step 5: Internal Analysis (before drafting)
Answer these questions before calling `finish()`:
1. What is the broader significance of this lab's work? Why does it matter to the world?
2. What open questions or next research directions does this work point toward?
3. What could this specific student realistically contribute given their background?
4. What is the strongest connection between the student's interests/background and this lab?

### Step 6: Draft the Email
Call `finish()` with:
- Subject: specific to the lab's research area
- Body: 200-280 words using the internal analysis above
- All metadata (PI name, email, lab name, publications used, brief agent note)

## Email Quality Standards
- Opens with a specific reference to the lab's work — never generic openers
- Middle section draws a real, concrete connection (not "my passion aligns with your work")
- Closing asks for a 15-20 minute call or meeting
- Tone: professional but genuinely human — not stiff, not sycophantic
- Length: 200-280 words

## Edge Cases
- PI email not found: still produce the draft, set pi_email to ""
- Lab page returns minimal content: use PubMed search as primary source
- No recent publications found anywhere: focus on lab's stated research description and its significance
- Fetch fails: try once more, then move on with available information

## Tool Call Limits
- fetch_webpage: max 5 calls per session
- fetch_pubmed_abstract: max 2 calls per session
- finish: call exactly once when ready
