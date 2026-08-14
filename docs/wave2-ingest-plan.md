# Wave-2 ingest plan — Salk / Scripps / Sanford Burnham Prebys / LJI

Written 2026-08-14 after examining the real page structure at each institute (not assumed).
Governed by `$CONTEXT_DIR/skills/labreach-ingest.md` (the 6 gates) and its prime directive:
**loud emptiness beats fake data.**

## Verified roster sizes (checked against each site's own total, not one page render)

| Institute | PIs | Directory | Pagination |
|---|---|---|---|
| Scripps Research | **106** | `/faculty/directory/` | REST `wp-json/scripps/v1/faculty`, 24/page × 5. A single fetch shows only 24 — must page. |
| Salk | **51** | `/science/directory/faculty/` | none (static) |
| Sanford Burnham Prebys | **49** | `/scientists/` | none; page states `totalCount">49` |
| LJI | **24** | `/labs-directory/` | none |

~230 PIs total. Scripps + SBP 403 bare curl → need browser-like headers (UA + Accept + Referer).

## Per-institute page structure (THE reason each needs its own adapter)

| | Salk | Scripps | SBP | LJI |
|---|---|---|---|---|
| Profile URL | `/scientist/<slug>/` | `/faculty/<slug>/` | `/scientists/<slug>-phd/` | `/labs/<slug>/` (IS the lab page) |
| **PI email on page** | ✅ yes | ❌ never | ❌ never | ⚠️ 16-28 *team* emails, PI's own usually absent |
| Lab site link | ✅ "Lab Website" anchor | ✅ `a.sidebarAccordion__trigger--link` (sidebar) | ❌ rarely | n/a (already the lab) |
| Research prose | thin on profile → on lab site | thin on profile → on lab site | ✅ substantive `<p>` on profile | ✅ on lab page |
| Bonus | — | lab subdomain `<name>.scripps.edu` or external | ✅ **PubMed link w/ affiliation filter** (`?term=Colas+AR[Author]+AND+burnham[Affiliation]`) — a gift for attribution | team roster |

## Email: SOLVED for 3 of 4 — grounded extraction, never derivation

**There is no derivable formula** — Salk has `gage@` / `ctowers@` / `animmerj@`, Scripps has
`boger@` / `blackmon@` / `pbaran@`, SBP has `rolf@` / `osterman@` / `asacco@`. Any constructed
address is fabrication. Every rule below READS the page's own markup (Roman, 2026-08-14: *"I'd
rather you tell me you can't find emails than find WRONG ones"*).

| Institute | Where the email actually lives | 10-PI test |
|---|---|---|
| **Salk** | plain `…@salk.edu` in the page (shared boxes filtered) | **8/10** |
| **Scripps** | contact panel, **Cloudflare `email-protection` hex** (first byte = XOR key); the panel also carries `contactName`, so the address is name-verifiable | **9/10** |
| **SBP** | anti-scrape split attrs `data-button-e-1` + `data-button-e-2`, joined with `@` | **10/10** |
| **LJI** | lab page lists 16-28 TEAM emails; the PI's own is usually absent and nearest-match yields `communications@` → **NULL by design → manual** | 0/10 (expected) |

Curl sees all of these — **no headless browser needed at runtime** (Playwright was used only to
*discover* SBP's split-attribute trick; extraction itself is a plain fetch). A miss writes NULL +
a `no-email` flag into the `>>` residual file. LJI's ~24 are Roman's manual pass.
Every write stamps `pi_email_source` and validates the address is on the institute's domain.

## Attribution — PARAMETERIZED (shipped)

`lib/attribution.ts` hardcodes `UCSD_AFFIL` (used as the positive "this author IS the PI" rescue)
and `SD_REGION` (negative exclusion). For wave 2 the positive rescue must become the *ingesting
institute's* affiliation, or every Salk/Scripps paper loses its affiliation rescue and drops to
`ambiguous`. `SD_REGION` already lists salk/scripps/sanford burnham/lji, so the negative test is
fine as-is. **Shipped:** optional `PiIdentity.affil?: RegExp` + an `INSTITUTE_AFFIL` map
(ucsd/salk/scripps/sbp/lji), threaded `ingestLabV2(url, onProgress, piName, { institute })` →
`gatherLab` → `gatherPapers` → `gatePapers` → `classifyPaper`. Omitting `institute` keeps the
UCSD default, so the wave-1 corpus is untouched. Covered by 3 new unit tests (42 total), including
a negative one: a Scripps affiliation must NOT rescue a Salk PI.

## Pipeline shape

```
enumerate-institutes.ts <inst>     → data/<inst>-labs.json      (adapter per institute)
      ↓
institute-profile.ts <inst>        → data/<inst>-enriched.json  (email / lab_url / bio per rules)
      ↓
seed-verify.ts (Gate 1+2)          → seed-review.txt            (only the flagged need eyes)
      ↓  (Roman reviews flagged + LJI emails)
ingest (ingestLabV2 + { institute })→ papers gated by institute-parameterized attribution
      ↓
sample-cards.ts (Gate 6)           → product-eyes QA before anything scales
```

## Verified 2026-08-14 (read-only — NOTHING written to the DB)

Enumerators hit their exact expected counts: **Salk 51 · Scripps 106 · SBP 49 · LJI 24 = 230**.
Profile enrichment over 10 PIs each: **bio ≥200c 40/40**; lab_url Salk 9/10, Scripps 10/10,
SBP 4/10 (many SBP PIs genuinely have no lab site), LJI 10/10. Paper gather + attribution returns
on-topic papers for all four (Allen→astrocytes, Baran→radical chemistry, Bodmer→cardiac,
Ay→genome topology).

**Two bugs surfaced and fixed by the fail-loud count guards** — both the same class: a
length-capped lazy regex (`[\s\S]{0,400}?`) silently matching nothing when a card's inner markup
ran long. It zeroed the enumerator's first run and SBP's lab links. Fixed by scanning to the real
closing tag, and by anchoring on the icon marker and scanning backwards. Guards that fail loudly
are why these took minutes instead of becoming another wave-1.

## STOP POINT

Pipeline built and correctness-tested; **no full run, no DB writes**. The ~230-PI run goes through
the orchestrator bus so Roman can track progress.
