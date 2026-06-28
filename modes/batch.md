# Mode: batch — Mass Processing of Jobs

Two usage modes: **conductor --chrome** (navigates portals in real time) or **standalone** (script for URLs already collected).

## Architecture

```text
Conductor (headed browser mode)
  │
  │  Chrome: navigates portals (logged-in sessions)
  │  Reads DOM directly — the user sees everything in real time
  │
  ├─ Job 1: reads JD from DOM + URL
  │    └─► headless worker → report .md + PDF + tracker-line
  │
  ├─ Job 2: click next, read JD + URL
  │    └─► headless worker → report .md + PDF + tracker-line
  │
  └─ End: merge tracker-additions → applications.md + summary
```

Each worker is a headless child process with a clean 200K token context. The conductor only orchestrates. See the **Headless / Batch Mode** table in `AGENTS.md` for the correct command per CLI.

## Files

```text
batch/
  batch-input.tsv               # URLs (from conductor or manual)
  batch-state.tsv               # Progress (auto-generated, gitignored)
  batch-runner.sh               # Standalone orchestrator script
  batch-prompt.md               # Prompt template for workers
  triage-prompt.md              # Cheap pre-screen prompt for obvious skips
  logs/                         # One log per job (gitignored)
  tracker-additions/            # Tracker lines (gitignored)
data/cache/
  candidate-facts.json          # Generated compact user facts (gitignored)
  company-research/*.json       # Generated reusable company research (gitignored)
```

## Mode A: Conductor --chrome

1. **Read state**: `batch/batch-state.tsv` → identify what has already been processed
2. **Navigate portal**: Chrome → search URL
3. **Extract URLs**: Read results DOM → extract URL list → append to `batch-input.tsv`
4. **For each pending URL**:
   a. Chrome: click on the job → read JD text from the DOM
   b. Save JD to `/tmp/batch-jd-{id}.txt`
   c. Calculate next sequential REPORT_NUM
   d. Execute via Bash:

      ```bash
      # Use your CLI's headless command (see AGENTS.md — Headless / Batch Mode)
      <headless-cmd> "Process this job. URL: {url}. JD: /tmp/batch-jd-{id}.txt. Report: {num}. ID: {id}"
      ```

   e. Update `batch-state.tsv` (completed/failed + score + report_num)
   f. Log to `logs/{report_num}-{id}.log`
   g. Chrome: go back → next job
5. **Pagination**: If no more jobs → click "Next" → repeat
6. **End**: Merge `tracker-additions/` → `applications.md` + summary

### What to watch during a run

During a conductor run, the operator has two primary live interfaces to monitor:
1. **The headed Chrome window:** Watch the browser navigate the portals, login to sessions, and interact with the job description pages in real time.
2. **The agent CLI conversation:** Follow the agent's turn-by-turn narration in the shell.

The individual worker tasks spawn headlessly in the background and write their stdout/stderr logs to `batch/logs/{report_num}-{id}.log`, which can be inspected on demand.

## Mode B: Standalone script

```bash
batch/batch-runner.sh [OPTIONS]
```

Options:
- `--dry-run` — list pending jobs without executing
- `--retry-failed` — retry only failed jobs
- `--resume-paused` — resume jobs paused after a Claude session/rate limit
- `--start-from N` — start from ID N
- `--parallel N` — N workers in parallel
- `--max-retries N` — attempts per job (default: 2)
- `--rate-limit-sleep N` — seconds to wait before retrying a transient rate-limited worker (default: 300; use 0 to pause the batch immediately)

## Token controls

Standalone batch runs use a two-stage path by default:

1. `node build-candidate-facts.mjs --quiet` refreshes a compact, gitignored summary from the user-layer files.
2. `triage-prompt.md` reads that cache plus the JD. If the role is clearly below `--triage-threshold`, it writes a concise SKIP report and tracker TSV, then marks the job `skipped`.
3. Borderline and promising jobs continue to the full `batch-prompt.md` A-G worker.

Runner options:
- `--no-triage` - disable the cheap pre-screen and run full A-G for every pending offer
- `--triage-threshold N` - score ceiling below which triage may write a SKIP report without running full A-G (default: 3.0)
- `--triage-model NAME` - model for the cheap pre-screen worker (default: the same value as `--model`)

This preserves full evaluation behavior for any uncertain role. Use `--no-triage` when you want the old behavior for audits or calibration.

Full A-G workers also check `data/cache/company-research/{company}.json` before WebSearch. If company-level salary, reputation, or hiring-signal research is fresh enough, reuse it and only search for missing role-specific gaps.

## batch-state.tsv Format

```text
id	url	status	started_at	completed_at	report_num	score	error	retries
1	https://...	completed	2026-...	2026-...	002	4.2	-	0
2	https://...	failed	2026-...	2026-...	-	-	Error msg	1
3	https://...	pending	-	-	-	-	-	0
4	https://...	rate_limited	2026-...	2026-...	004	-	rate-limit; retrying after 300s	1
5	https://...	paused_rate_limit	2026-...	2026-...	005	-	session limit; paused	1
```

Valid statuses include `pending`, `processing`, `completed`, `failed`, `skipped`, `rate_limited`, and `paused_rate_limit`. `skipped` includes both min-score skips after full evaluation and triage skips before full A-G. `rate_limited` is an intermediate non-completed state emitted while the runner waits before retrying; if the run is interrupted there, a later non-`--retry-failed` run treats it as pending work.

`paused_rate_limit` means a worker hit a Claude session/usage limit. The runner stops scheduling new offers, preserves the retry count, and resumes only when explicitly called with `--resume-paused`.

## Resumability

- If it crashes → re-run → reads `batch-state.tsv` → skip completed jobs
- Lock file (`batch-runner.pid`) prevents double execution
- Each worker is independent: failure in job #47 does not affect the others

## Workers (headless mode)

Each full worker receives `batch-prompt.md` as a system prompt. Triage workers receive `triage-prompt.md`. Use your CLI's headless command — see the **Headless / Batch Mode** table in `AGENTS.md`.

The worker produces:
1. `.md` report in `reports/`
2. PDF in `output/`
3. Tracker line in `batch/tracker-additions/{id}.tsv`
4. Result JSON via stdout

## Error handling

| Error | Recovery |
|-------|----------|
| URL inaccessible | Worker fails → conductor marks `failed`, continues |
| JD behind login | Conductor attempts to read DOM. If it fails → `failed` |
| Portal changes layout | Conductor reasons about HTML, adapts |
| Worker crashes | Conductor marks `failed`, continues. Retry with `--retry-failed` |
| Claude session/usage limit | Runner marks the current offer `paused_rate_limit`, stops scheduling new offers, preserves retries. Resume with `--resume-paused` after reset. |
| Conductor crashes | Re-run → reads state → skip completed jobs |
| PDF fails | .md report is saved. PDF remains pending |
