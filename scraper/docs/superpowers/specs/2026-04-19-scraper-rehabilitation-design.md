# Scraper Rehabilitation Design Spec

**Date:** 2026-04-19
**Status:** Approved
**Sub-project:** A (of A → B sequence; B is scraper-web UI redesign, future spec)

## Goal

Bring the scraper at `C:\Users\Administrator\OneDrive\Projects\scraper` from "1 of 24 sources producing rows" to "at least 10 of 24 sources producing rows, with a clear diagnostic trail and operator tooling." The frontend at `scraper-web` is already deployed and correct; the bottleneck is this data pipeline.

## Problem statement

Last scraper run (`data/reports/report_2026-04-19.json`) shows:

```json
{ "total_fetched": 96, "total_unique": 3, "total_exported": 3,
  "per_source": { "remoteok": 3 }, "failed_sources": [] }
```

Only `remoteok` produced rows. Supabase query confirms — `scraper_jobs_clean` has exactly 3 rows, all `remoteok`. The other 23 sources returned 0 rows with no explicit errors. Three likely root causes, ranked:

1. **Empty or minimal seed files for opaque-tenant ATSes** — `data/companies/dayforce.txt` is 0 bytes, `eightfold.txt` has 1 line, `paylocity.txt` has 2 lines. These connectors iterate over empty company lists and silently produce nothing.
2. **Greenhouse / Lever / Ashby return HTTP 200 but 0 parsed jobs** — logs confirm the API calls succeed. Something between parse and ingest is dropping everything. Root cause unknown without instrumentation.
3. **Recency filter too aggressive** — `RECENCY_HOURS=24` in `.env`. RemoteOK's feed churns daily so always has "new" rows; enterprise ATS boards post less frequently, so 24h filters everything out.

## Scope decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope level | **S2 — Standard Recovery** | Balanced: diagnostic deep-dive on top sources + light seed curation + per-source recency tuning. |
| Schedule | **C2 — Manual daily** | User runs `scripts/refresh.sh` when they want fresh data. No cron, no deployment. |
| Seed curation | **SC1 — Hand-curate from public vendor customer pages** | AI-operated during implementation. 10-15 verified customers per ATS. No user manual effort. |
| Diagnostic scope | **DS2 — Ranked top-8** | Greenhouse, Lever, Ashby, Workday, SmartRecruiters, iCIMS, USAJobs, Adzuna. The other 15 sources pick up organically from recency + seed fixes, or get deferred. |
| Implementation approach | **A — Instrumented-first** | Build `--diagnose` harness, then fix in priority order with one commit per fix. Causal attribution on every change. |

## Architecture

Four layers of change, lightest to heaviest:

### Layer 1 — Config & seed data

- Rewrite `data/companies/dayforce.txt`, `paylocity.txt`, `ukg.txt`, `eightfold.txt`, `oracle_rc.txt`. 10-15 verified customers each. Sources: public vendor customer pages (`dayforce.com/customers`, `paylocity.com/customers`, `ukg.com/about/customers`, `eightfold.ai/customers`, `oracle.com/.../customers`).
- Update `.env` and `.env.example` with per-source recency overrides.

### Layer 2 — Diagnostic harness (new code)

- New module: `src/diagnose.py` — pure function `diagnose_source(name, target, no_ingest) -> DiagnosticReport`.
- CLI wiring: `run_daily.py` grows a `--diagnose <source>` flag that routes to the harness instead of normal ingest. Also supports `--no-ingest` for dry-run.
- Emits structured JSON to `data/reports/diagnose_<source>_<ISO-ts>.json` (gitignored, local-only).

### Layer 3 — Per-source connector fixes

- Targeted fixes to 2-8 files under `src/sources/` based on what the diagnostic reports reveal. One commit per source. Commit body cites the pre-fix report filename.

### Layer 4 — Operator wrappers

- `scripts/refresh.sh` — sources `.env`, runs `run_daily.py` across all sources via the existing `scripts/run_sources_sequentially.py`, prints a summary.
- `scripts/diagnose.sh <source>` — wrapper for `python run_daily.py --diagnose <source>`.

## Diagnostic harness design

### CLI contract

```bash
python run_daily.py --diagnose greenhouse
python run_daily.py --diagnose greenhouse --target 50       # tighter report
python run_daily.py --diagnose greenhouse --no-ingest       # dry-run
```

### Pipeline stages instrumented

| Stage | What it records |
|---|---|
| `fetch_seeds` | seed file path, company count loaded |
| `fetch_listings` | per-company HTTP: URL, status, response bytes, duration. Failures captured. |
| `parse_listings` | raw jobs extracted before any filtering |
| `normalize` | jobs after field mapping |
| `recency_filter` | jobs surviving cutoff; the cutoff timestamp used |
| `dedup_check` | jobs not already in Supabase (via fingerprint lookup) |
| `ingest` | jobs actually written |

### Report shape

`data/reports/diagnose_<source>_<ISO-ts>.json`:

```json
{
  "source": "greenhouse",
  "started_at": "2026-04-19T14:30:00Z",
  "duration_seconds": 135.2,
  "config": { "recency_hours": 168, "target": 100 },
  "stages": [
    { "stage": "fetch_seeds", "output_count": 132, "duration_ms": 12 },
    { "stage": "fetch_listings", "input_count": 132, "output_count": 128,
      "failures": [{ "company": "examplco", "status": 404,
                      "url": "https://boards-api.greenhouse.io/v1/boards/examplco/jobs" }] },
    { "stage": "parse_listings", "input_count": 128, "output_count": 2453 },
    { "stage": "recency_filter", "input_count": 2453, "output_count": 12,
      "notes": "cutoff=2026-04-12T14:30Z" },
    { "stage": "dedup_check", "input_count": 12, "output_count": 11 },
    { "stage": "ingest", "input_count": 11, "output_count": 11 }
  ],
  "summary": { "rows_written": 11,
               "dropped_by": { "recency": 2441, "dedup": 1 },
               "http_failures": 4,
               "top_failure_reason": "404 company not found" }
}
```

One read tells you exactly where rows died. No need to grep logs.

### Implementation notes

- `src/diagnose.py` wraps existing `fetch_listings` callables through a context manager — no changes required inside source connectors.
- Drop attribution is implicit: `input_count - output_count = dropped by this stage`.
- Reports are gitignored via existing `data/reports/*` rule — they're ephemeral diagnostic artifacts.

## Per-source recency config

### Env schema

```bash
RECENCY_HOURS=168                 # 7d global default (up from 24h)
RECENCY_HOURS_REMOTEOK=24         # aggregator churns daily
RECENCY_HOURS_ADZUNA=72           # 3d — aggregator, reduces duplicate ingests
RECENCY_HOURS_USAJOBS=720         # 30d — govt postings stay open longer
RECENCY_HOURS_WORKDAY=336         # 14d — enterprise hiring cadence slower
```

### Lookup contract

`src/recency.py` exports:

```python
def recency_for_source(name: str) -> int:
    """Returns hours for this source. Checks RECENCY_HOURS_<SOURCE_UPPER>,
    falls back to RECENCY_HOURS, finally defaults to 168 (7d)."""
```

All source ingest paths call `recency_for_source(source.name)` instead of reading the global constant directly.

### Backward compatibility

- Unset overrides → falls back to `RECENCY_HOURS` global.
- Unset global → defaults to 168h (7d). Old behavior of 24h becomes the remoteok-specific override.
- Cannot cause duplicate rows because `dedup_check` fingerprints against Supabase before any write.

## Seed curation (SC1)

Operator (the AI executing the plan) will, for each of `dayforce`, `paylocity`, `ukg`, `eightfold`, `oracle_rc`:

1. Use `WebFetch` / `WebSearch` to retrieve the vendor's public customer list page.
2. Extract 10-15 enterprise names.
3. Resolve each to its actual careers host by heuristic (`careers.{brand}.com`, `{brand}.dayforcehcm.com`, `recruiting.paylocity.com/Recruiting/Jobs/All/{slug}`, etc.).
4. Probe each resolved URL; skip any that 404. Target **10 good seeds, not 15 mediocre**.
5. Write to `data/companies/<ats>.txt` — one domain per line, alphabetised.
6. Commit separately: `data(seeds/<ats>): hand-curate N verified customers`.

No manual user input. Each commit is independently revertable.

## Execution sequence

| # | Task | Commit | Estimated time |
|---|---|---|---|
| 1 | Set up branch + worktree | — | 5 min |
| 2 | Build `src/diagnose.py` + wire `--diagnose` CLI flag | `feat(diagnose): add per-source diagnostic harness` | 45 min |
| 3 | Run `--diagnose` against top-8 sources, capture reports | no commit (reports gitignored) | 30 min |
| 4 | Per-source fix loop — one commit per source, cites pre-fix report | `fix(sources/<name>): <specific fix>` × up to 8 | 2-3 hours |
| 5 | Loosen global recency + wire per-source overrides | `feat(recency): per-source recency windows` | 30 min |
| 6 | Hand-curate 5 ATS seed files | `data(seeds/<ats>): hand-curate N verified customers` × 5 | 45 min |
| 7 | Final validation: `scripts/run_sources_sequentially.py` across all 24 | no commit | 30 min |
| 8 | `scripts/refresh.sh` + `scripts/diagnose.sh` wrappers | `feat(scripts): operator wrappers for refresh + diagnose` | 15 min |
| 9 | Write `docs/scraper-rehabilitation-report.md` | `docs: scraper rehabilitation report` | 30 min |

**Total active budget: ~5 hours.**

## Validation criteria

### Hard pass (all required before marking A done)

- ≥ **10 of 24 sources** have ≥1 row in Supabase `scraper_jobs_clean`.
- Each of the **top-8 sources** either produces ≥1 row **or** has a documented reason for zero in the rehabilitation report (e.g. "needs API key", "tenant-gated", "connector broken, deferred").
- Total Supabase row count ≥ **200**.
- `scripts/refresh.sh` runs end-to-end with exit code 0.
- JSON diagnostic reports exist under `data/reports/diagnose_<top-8-source>_*.json` (local, not committed).

### Soft indicators (nice to have, not blockers)

- Posting dates spread across ≥ 14 distinct days (so the 30-day chart has shape for sub-project B).
- ≥ 3 distinct `remote_type` values present.
- ≥ 20 distinct `company_name` values.

## Deliverables

1. A healthier Supabase — diverse rows across sources and dates.
2. `scripts/refresh.sh` — one-command manual refresh with readable summary.
3. `scripts/diagnose.sh <source>` — one-command per-source diagnostic.
4. `docs/scraper-rehabilitation-report.md` — before/after table, per-source verdicts, rerun instructions, known remaining issues.
5. Clean git log — one commit per source fix, one per seed file, fully revertable.

## Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | A top-8 source needs a full connector rewrite, not a tweak (ATS schema changed). | Time-box each per-source fix at 1 hour. If stuck, commit the diagnostic report, mark `needs-rewrite` in rehabilitation report. Don't derail the pass. |
| R2 | Seed curation lands on brands whose careers subdomain doesn't resolve cleanly. | Probe each URL before committing; skip 404s. Target 10 good seeds, not 15 mediocre ones. |
| R3 | Supabase bulk-insert rate limits during final sequential pass. | Existing code already batches + sleeps between upserts. Don't modify it. |
| R4 | Loosened recency surfaces new zero-row long-tail sources (workable, jobvite, teamtailor). | Out of top-8 scope. Document in rehabilitation report as `post-A-followup`; does not block A. |

## Out of scope

- No changes to `scraper-web`. That is sub-project B, a separate design spec.
- No Supabase schema migrations — existing schema is sufficient.
- No automated cron / GitHub Actions deployment (user chose C2 manual).
- No `pytest` integration test suite (user chose approach A, not C).
- No per-tenant validation beyond "connector doesn't crash and seed URL resolves." Deep per-tenant debugging is a future pass.

## Handoff to writing-plans

After this spec is committed, the next step is `superpowers:writing-plans` which will produce a bite-sized task plan at `docs/superpowers/plans/2026-04-19-scraper-rehabilitation.md`. That plan will be executed via `superpowers:subagent-driven-development`.
