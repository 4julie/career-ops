# Architecture

## System Overview

```text
AI Coding CLI Agent
  reads AGENTS.md + modes/*.md
  |
  +-- Single Eval (auto-pipeline)
  |
  +-- Portal Scan (scan.md)
  |     |
  |     +-- pipeline.md URL inbox
  |
  +-- Batch Process (batch-runner)
        |
        +-- candidate facts cache
        |
        +-- triage workers for clear skips
        |
        +-- full A-G workers for surviving offers
              |
              +-- Report .md
              +-- PDF from HTML
              +-- Tracker TSV
                    |
                    +-- merge-tracker.mjs
                          |
                          +-- data/applications.md canonical tracker
```

## Evaluation Flow (Single Offer)

1. **Input**: User pastes JD text or URL
2. **Extract**: Playwright/WebFetch extracts JD from URL
3. **Classify**: Detect archetype (1 of 6 types)
4. **Evaluate**: 6 blocks (A-F):
   - A: Role summary
   - B: CV match (gaps + mitigation)
   - C: Level strategy
   - D: Comp research (WebSearch)
   - E: CV personalization plan
   - F: Interview prep (STAR stories)
5. **Score**: Weighted average across 10 dimensions (1-5)
6. **Report**: Save as `reports/{num}-{company}-{date}.md`
7. **PDF**: Generate ATS-optimized CV (`generate-pdf.mjs`)
8. **Track**: Write TSV to `batch/tracker-additions/`, auto-merged

## Batch Processing

The batch system processes multiple offers in parallel:

```text
batch-input.tsv  ->  batch-runner.sh  ->  triage worker  ->  full A-G worker
(id, url, source)    (orchestrator)       (cheap gate)       (self-contained prompt)
                         |
                         +-- build-candidate-facts.mjs
                         +-- batch-state.tsv tracks progress
```

Before scheduling workers, the runner refreshes `data/cache/candidate-facts.json` from user-layer files. Triage workers read that compact cache plus the JD. If an offer is clearly below the configured `--triage-threshold`, triage writes a concise SKIP report and tracker TSV, then marks the job `skipped`. Borderline or promising roles continue to the full A-G worker.

Full workers are headless AI CLI instances using `batch-prompt.md`. They produce:
- Report .md
- PDF when the score clears the configured gate
- Tracker TSV line

The orchestrator manages parallelism, state, retries, and resume.

## Data Flow

```
cv.md                      -> Evaluation context
article-digest.md          -> Proof points for matching
config/profile.yml         -> Candidate identity
data/cache/candidate-facts.json -> Compact generated cache for batch triage
data/cache/company-research/*.json -> Reusable company salary/hiring research
portals.yml                -> Scanner configuration
templates/states.yml       -> Canonical status values
templates/cv-template.html -> PDF generation template
```

## File Naming Conventions

- Reports: `{###}-{company-slug}-{YYYY-MM-DD}.md` (3-digit zero-padded)
- PDFs: `cv-candidate-{company-slug}-{YYYY-MM-DD}.pdf`
- Tracker TSVs: `batch/tracker-additions/{id}.tsv`

## Pipeline Integrity

Scripts maintain data consistency:

| Script | Purpose |
|--------|---------|
| `merge-tracker.mjs` | Merges batch TSV additions into applications.md |
| `build-candidate-facts.mjs` | Builds the generated candidate facts cache for batch triage |
| `company-research-cache.mjs` | Reads/writes reusable company research cache entries |
| `verify-pipeline.mjs` | Health check: statuses, duplicates, links |
| `dedup-tracker.mjs` | Removes duplicate entries by company+role |
| `normalize-statuses.mjs` | Maps status aliases to canonical values |
| `cv-sync-check.mjs` | Validates setup consistency |

## Dashboard TUI

The `dashboard/` directory contains a standalone Go TUI application that visualizes the pipeline:

- Filter tabs: All, Evaluated, Applied, Interview, Top >=4, SKIP
- Sort modes: Score, Date, Company, Status
- Grouped/flat view
- Lazy-loaded report previews
- Inline status picker
