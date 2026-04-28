# Scraper Rehabilitation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the scraper at `C:\Users\Administrator\OneDrive\Projects\scraper` from 1/24 sources producing rows to 10+/24 sources producing rows, with a durable per-source diagnostic trail and operator-friendly wrappers.

**Architecture:** Four layers of change. (1) A new `src/diagnose.py` module plus `--diagnose <source>` CLI flag in `run_daily.py` that produces structured per-stage JSON reports. (2) Per-source recency config in `src/recency.py` + `config.py` + `.env.example` so enterprise ATS boards stop being filtered by a 24h window. (3) Data-only seed-file updates for 5 opaque-ATS connectors (`dayforce`, `paylocity`, `ukg`, `eightfold`, `oracle_rc`). (4) Operator wrappers `scripts/refresh.sh` and `scripts/diagnose.sh`. No schema changes, no new connectors, no changes to `scraper-web`.

**Tech Stack:** Python 3.11+, `structlog` (logging), `httpx` via `src/http_client.py` (HTTP), `supabase-py` (storage), `SQLAlchemy` (SQLite fallback), `python-dotenv` (env), `pytest` (tests), `dateutil` (timestamp parsing).

---

## Global rule: Context7 before any library use

Per global CLAUDE.md, before writing or editing code that uses any third-party library, call Context7 **first**:

1. `mcp__context7__resolve-library-id` — find the canonical library ID.
2. `mcp__context7__query-docs` — retrieve current, version-accurate docs.

Applies to every task. Especially relevant here for:
- `argparse` (new flags in Task 2) — stdlib but verify idiomatic `action="store_true"` + `metavar` usage
- `structlog` (Task 2, Task 5) — verify `bind()` / `bound_logger` patterns
- `supabase-py` (Task 2 dedup check) — verify `.select().in_()` filter syntax
- `python-dotenv` (Task 5) — verify `load_dotenv` behavior with explicit paths
- `pytest` (Task 2, Task 5 tests) — verify fixture + parametrize patterns

Skipping Context7 is a process failure.

---

## File Structure

### New files to create

| Path | Responsibility |
|---|---|
| `src/diagnose.py` | Diagnostic harness. Exports `diagnose_source(name, target, no_ingest) -> dict`. Writes JSON report to `data/reports/diagnose_<name>_<ts>.json`. |
| `scripts/refresh.sh` | Operator wrapper: runs `scripts/run_sources_sequentially.py` with printed summary. POSIX shell (works in Git Bash on Windows). |
| `scripts/refresh.ps1` | Same as above, PowerShell equivalent for native Windows. |
| `scripts/diagnose.sh` | Operator wrapper: runs `python run_daily.py --diagnose <source>`. POSIX shell. |
| `scripts/diagnose.ps1` | Same, PowerShell. |
| `docs/scraper-rehabilitation-report.md` | Human-readable before/after + per-source verdicts + rerun instructions. |
| `tests/test_diagnose.py` | Unit tests for `src/diagnose.py`. |
| `tests/test_recency_overrides.py` | Unit tests for per-source recency lookup. |

### Existing files to modify

| Path | Change |
|---|---|
| `run_daily.py` | Add `--diagnose <source>` and `--no-ingest` CLI flags. When `--diagnose` set, route to `src.diagnose.diagnose_source` and exit before normal ingest. |
| `src/recency.py` | Add `recency_for_source(name: str) -> int` helper. Leave `parse_posted` and `is_within_hours` untouched. |
| `config.py` | Add `recency_overrides: dict[str, int]` field on `Settings`, populated by scanning env vars starting with `RECENCY_HOURS_`. |
| `.env.example` | Update `RECENCY_HOURS=24` → `RECENCY_HOURS=168`. Add 4 example per-source overrides. |
| `.env` | Same changes as `.env.example` — done by operator during Task 5 step 5. Not committed (gitignored). |
| `data/companies/dayforce.txt` | Replace 0-byte file with 10-15 verified Dayforce customers. |
| `data/companies/paylocity.txt` | Replace 2-line file with 10-15 verified Paylocity customers. |
| `data/companies/ukg.txt` | Replace 19-line file with 10-15 verified UKG customers. |
| `data/companies/eightfold.txt` | Replace 1-line file with 10-15 verified Eightfold customers. |
| `data/companies/oracle_rc.txt` | Augment existing 187 lines with 10-15 additional verified Oracle RC customers. |
| `src/sources/<source>.py` | Targeted fixes — exact changes determined by diagnostic reports in Task 3. Up to 8 files. |

### Files explicitly not touched

- `supabase/migrations/*` — no schema changes.
- `src/storage.py`, `src/supabase_storage.py` — storage backends untouched.
- `src/sources/registry.py` — all 24 sources stay registered.
- `scraper-web` — separate sub-project (B).

---

## Task 1: Branch + worktree setup

**Goal:** Create an isolated workspace for this rehabilitation effort so the implementer subagent works against a clean branch.

**Files:** none modified

- [ ] **Step 1: Verify on main branch with clean tree**

Run:
```bash
cd "C:\Users\Administrator\OneDrive\Projects\scraper"
git status
git rev-parse --abbrev-ref HEAD
```

Expected: working tree clean; on branch `master` or `main`. If a different branch, stop and ask.

- [ ] **Step 2: Create worktree + feature branch**

Run:
```bash
cd "C:\Users\Administrator\OneDrive\Projects\scraper"
git worktree add ../scraper-rehabilitation -b scraper-rehabilitation
cd ../scraper-rehabilitation
```

Expected: `Preparing worktree (new branch 'scraper-rehabilitation')` + `HEAD is now at aa7a3cd chore: initial baseline + scraper rehabilitation spec`.

- [ ] **Step 3: Copy `.env` into worktree (not tracked by git)**

Run:
```bash
cp "C:\Users\Administrator\OneDrive\Projects\scraper\.env" ".env"
ls -la .env
```

Expected: `.env` exists in worktree with SUPABASE_URL + SUPABASE_KEY.

- [ ] **Step 4: Verify Python imports work in worktree**

Run:
```bash
python -c "from config import settings; print('OK recency_hours=', settings.recency_hours)"
```

Expected: `OK recency_hours= 24` (or whatever current value). No import errors.

- [ ] **Step 5: No commit for this task**

Worktree setup is not a code change. Proceed directly to Task 2.

---

## Task 2: Build `src/diagnose.py` + `--diagnose` CLI flag

**Goal:** Ship a per-source diagnostic harness that produces structured JSON reports pinpointing exactly which pipeline stage drops rows.

**Files:**
- Create: `src/diagnose.py`
- Create: `tests/test_diagnose.py`
- Modify: `run_daily.py` (add two argparse flags + early-exit routing)

- [ ] **Step 1: Call Context7 for `structlog` and `argparse` docs**

Run:
```
mcp__context7__resolve-library-id(libraryName="structlog")
mcp__context7__query-docs(library_id=<id>, topic="bound logger context processor")
```

Purpose: confirm idiomatic `get_logger(__name__)` + `.bind(source=name)` pattern before using in `diagnose.py`. No code change from this step — just verification.

- [ ] **Step 2: Write the failing test for `diagnose_source` structure**

Create `tests/test_diagnose.py`:

```python
"""Unit tests for src.diagnose.diagnose_source.

The harness must produce a structured report with documented stage names
and drop-attribution summary — regardless of which source is being diagnosed.
These tests use a fake in-memory scraper so they never hit the network.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator

import pytest

from src.base import BaseSourceScraper
from src.models import JobPosting


class _FakeOKScraper(BaseSourceScraper):
    """Yields 3 parseable job dicts; simulates a healthy source."""
    name = "_fake_ok"
    display_name = "Fake OK"

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for i in range(3):
            yield {"id": i, "title": f"Engineer {i}", "company": "Acme"}

    def parse_listing(self, raw: dict[str, Any]):
        return JobPosting(
            job_title=raw["title"],
            company_name=raw["company"],
            source_platform=self.name,
            source_url=f"https://example.com/jobs/{raw['id']}",
        )


class _FakeZeroScraper(BaseSourceScraper):
    """Yields 0 records; simulates an empty-seed source."""
    name = "_fake_zero"

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        if False:
            yield {}  # unreachable

    def parse_listing(self, raw: dict[str, Any]):
        return None


def test_report_has_required_top_level_keys(tmp_path: Path, monkeypatch):
    """Report must have source, started_at, duration_seconds, config, stages, summary."""
    from src import diagnose

    monkeypatch.setattr(diagnose, "_REPORTS_DIR", tmp_path)
    report = diagnose.diagnose_source_with(_FakeOKScraper(), target=100, no_ingest=True)

    assert report["source"] == "_fake_ok"
    assert "started_at" in report
    assert "duration_seconds" in report
    assert "config" in report
    assert "stages" in report
    assert "summary" in report


def test_report_stages_include_every_named_pipeline_stage(tmp_path: Path, monkeypatch):
    """Every report MUST document these six stages, in order."""
    from src import diagnose

    monkeypatch.setattr(diagnose, "_REPORTS_DIR", tmp_path)
    report = diagnose.diagnose_source_with(_FakeOKScraper(), target=100, no_ingest=True)

    stage_names = [s["stage"] for s in report["stages"]]
    assert stage_names == [
        "fetch_seeds",
        "fetch_listings",
        "parse_listings",
        "normalize",
        "recency_filter",
        "dedup_check",
        "ingest",
    ]


def test_report_stage_counts_attribute_drops(tmp_path: Path, monkeypatch):
    """Each stage has input_count and output_count; drops = input - output."""
    from src import diagnose

    monkeypatch.setattr(diagnose, "_REPORTS_DIR", tmp_path)
    report = diagnose.diagnose_source_with(_FakeOKScraper(), target=100, no_ingest=True)

    for stage in report["stages"]:
        assert "output_count" in stage, f"stage {stage['stage']} missing output_count"
        assert "duration_ms" in stage, f"stage {stage['stage']} missing duration_ms"


def test_report_written_to_disk(tmp_path: Path, monkeypatch):
    """Report must be persisted to data/reports/diagnose_<source>_<ts>.json."""
    from src import diagnose

    monkeypatch.setattr(diagnose, "_REPORTS_DIR", tmp_path)
    diagnose.diagnose_source_with(_FakeOKScraper(), target=100, no_ingest=True)

    files = list(tmp_path.glob("diagnose__fake_ok_*.json"))
    assert len(files) == 1, f"expected 1 report file, got {len(files)}"
    payload = json.loads(files[0].read_text(encoding="utf-8"))
    assert payload["source"] == "_fake_ok"


def test_zero_source_reports_zero_rows(tmp_path: Path, monkeypatch):
    """Empty-yield source produces a report with rows_written=0 and documented drops."""
    from src import diagnose

    monkeypatch.setattr(diagnose, "_REPORTS_DIR", tmp_path)
    report = diagnose.diagnose_source_with(_FakeZeroScraper(), target=100, no_ingest=True)

    assert report["summary"]["rows_written"] == 0
    assert report["stages"][1]["output_count"] == 0  # fetch_listings


def test_no_ingest_true_skips_storage_write(tmp_path: Path, monkeypatch):
    """With no_ingest=True the report must report zero ingest writes even if rows survived."""
    from src import diagnose

    monkeypatch.setattr(diagnose, "_REPORTS_DIR", tmp_path)
    report = diagnose.diagnose_source_with(_FakeOKScraper(), target=100, no_ingest=True)

    ingest_stage = next(s for s in report["stages"] if s["stage"] == "ingest")
    assert ingest_stage["output_count"] == 0
```

- [ ] **Step 3: Run the failing test to verify it fails with ImportError**

Run:
```bash
cd "C:\Users\Administrator\OneDrive\Projects\scraper-rehabilitation"
python -m pytest tests/test_diagnose.py -v
```

Expected: `ModuleNotFoundError: No module named 'src.diagnose'` — all 6 tests fail at import.

- [ ] **Step 4: Implement `src/diagnose.py`**

Create `src/diagnose.py`:

```python
"""Per-source diagnostic harness.

Wraps a single source's fetch → parse → filter → dedup → ingest pipeline
with structured instrumentation. Emits a JSON report to
``data/reports/diagnose_<source>_<ISO-ts>.json`` so operators can see
exactly where rows die without grepping logs.

Public entry points:
    diagnose_source(name, target=100, no_ingest=False) -> dict
    diagnose_source_with(scraper, target=100, no_ingest=False) -> dict

The first looks the source up via registry; the second accepts a
pre-instantiated scraper and is the testable core.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from src.base import BaseSourceScraper
from src.logging_config import get_logger
from src.models import JobPosting

log = get_logger(__name__)

# Overridable in tests via monkeypatch.
_REPORTS_DIR = Path(__file__).resolve().parents[1] / "data" / "reports"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stage(name: str, *, input_count: int | None = None, output_count: int,
           duration_ms: int, notes: str | None = None,
           failures: list[dict] | None = None) -> dict:
    d: dict[str, Any] = {"stage": name, "output_count": output_count,
                          "duration_ms": duration_ms}
    if input_count is not None:
        d["input_count"] = input_count
    if notes:
        d["notes"] = notes
    if failures:
        d["failures"] = failures
    return d


def _seed_count(scraper: BaseSourceScraper) -> int:
    """Best-effort count of seed companies/boards/tenants the scraper will
    iterate. Different scrapers use different attribute names."""
    for attr in ("boards", "companies", "tenants", "urls"):
        v = getattr(scraper, attr, None)
        if isinstance(v, list):
            return len(v)
    # Aggregators like RemoteOK/Adzuna/USAJobs don't have seeds.
    return 1


def diagnose_source_with(scraper: BaseSourceScraper, *, target: int = 100,
                          no_ingest: bool = False) -> dict:
    """Diagnose an already-instantiated scraper. Returns the report dict
    AND writes it to disk."""
    from src.normalizer import post_filter
    from src.recency import recency_for_source

    t_start = time.monotonic()
    started_at = _now()
    source_name = scraper.name
    recency_hours = recency_for_source(source_name)

    stages: list[dict] = []

    # Stage 1: fetch_seeds
    t0 = time.monotonic()
    seed_count = _seed_count(scraper)
    stages.append(_stage("fetch_seeds", output_count=seed_count,
                          duration_ms=int((time.monotonic() - t0) * 1000)))

    # Stages 2 + 3: fetch_listings + parse_listings (run together because
    # base.run() interleaves them; we recapitulate that here).
    t0 = time.monotonic()
    raw_records: list[dict[str, Any]] = []
    parsed: list[JobPosting] = []
    failures: list[dict] = []
    try:
        for raw in scraper.fetch_listings():
            raw_records.append(raw)
            try:
                job = scraper.parse_listing(raw)
            except Exception as e:
                failures.append({"reason": "parse_error", "error": str(e)[:200]})
                continue
            if job and job.company_name:
                job.source_platform = source_name
                parsed.append(job)
    except Exception as e:
        failures.append({"reason": "fetch_fatal", "error": str(e)[:200]})
    fetch_ms = int((time.monotonic() - t0) * 1000)

    stages.append(_stage("fetch_listings", input_count=seed_count,
                          output_count=len(raw_records), duration_ms=fetch_ms,
                          failures=failures or None))
    stages.append(_stage("parse_listings", input_count=len(raw_records),
                          output_count=len(parsed), duration_ms=0))

    # Stage 4: normalize (title + US filter + experience inference)
    t0 = time.monotonic()
    normalized = post_filter(parsed)
    stages.append(_stage("normalize", input_count=len(parsed),
                          output_count=len(normalized),
                          duration_ms=int((time.monotonic() - t0) * 1000)))

    # Stage 5: recency_filter
    t0 = time.monotonic()
    cutoff = started_at - timedelta(hours=recency_hours)
    survivors: list[JobPosting] = []
    for j in normalized:
        dt = j.date_posted_normalized
        if dt is None:
            survivors.append(j)  # never drop on missing date
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if dt >= cutoff:
            survivors.append(j)
    stages.append(_stage("recency_filter", input_count=len(normalized),
                          output_count=len(survivors),
                          duration_ms=int((time.monotonic() - t0) * 1000),
                          notes=f"cutoff={cutoff.isoformat()} hours={recency_hours}"))

    # Stage 6: dedup_check — best-effort against Supabase if configured.
    t0 = time.monotonic()
    new_keys = [j.canonical_key() for j in survivors]
    dedup_survivors = survivors  # default: skip lookup when no backend
    dedup_note = "skipped (no backend)"
    try:
        import os
        if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY"):
            from src.supabase_storage import SupabaseStorage
            storage = SupabaseStorage()
            existing = storage.existing_canonical_keys(new_keys) if hasattr(
                storage, "existing_canonical_keys") else set()
            dedup_survivors = [j for j, k in zip(survivors, new_keys)
                                if k not in existing]
            dedup_note = f"existing_in_db={len(existing)}"
    except Exception as e:
        dedup_note = f"error: {str(e)[:100]}"
    stages.append(_stage("dedup_check", input_count=len(survivors),
                          output_count=len(dedup_survivors),
                          duration_ms=int((time.monotonic() - t0) * 1000),
                          notes=dedup_note))

    # Stage 7: ingest
    t0 = time.monotonic()
    if no_ingest:
        rows_written = 0
        ingest_note = "skipped (--no-ingest)"
    else:
        try:
            import os
            if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY"):
                from src.supabase_storage import SupabaseStorage
                counts = SupabaseStorage().ingest(dedup_survivors)
                rows_written = sum(counts.values()) if isinstance(counts, dict) else len(dedup_survivors)
                ingest_note = f"counts={counts}"
            else:
                rows_written = 0
                ingest_note = "no backend configured"
        except Exception as e:
            rows_written = 0
            ingest_note = f"error: {str(e)[:100]}"
    stages.append(_stage("ingest", input_count=len(dedup_survivors),
                          output_count=rows_written,
                          duration_ms=int((time.monotonic() - t0) * 1000),
                          notes=ingest_note))

    # Summary
    dropped_recency = len(normalized) - len(survivors)
    dropped_dedup = len(survivors) - len(dedup_survivors)
    dropped_normalize = len(parsed) - len(normalized)
    http_failures = sum(1 for f in failures if f.get("reason") == "parse_error") + \
                    sum(1 for f in failures if f.get("reason") == "fetch_fatal")
    top_failure = failures[0] if failures else None

    report = {
        "source": source_name,
        "started_at": started_at.isoformat(),
        "duration_seconds": round(time.monotonic() - t_start, 2),
        "config": {"recency_hours": recency_hours, "target": target,
                    "no_ingest": no_ingest},
        "stages": stages,
        "summary": {
            "rows_written": rows_written,
            "dropped_by": {
                "normalize": dropped_normalize,
                "recency": dropped_recency,
                "dedup": dropped_dedup,
            },
            "http_failures": http_failures,
            "top_failure_reason": top_failure.get("reason") if top_failure else None,
        },
    }

    # Persist report
    _REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = started_at.strftime("%Y-%m-%dT%H-%M-%S")
    out_path = _REPORTS_DIR / f"diagnose_{source_name}_{ts}.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    log.info("diagnose.complete", source=source_name, path=str(out_path),
              rows_written=rows_written)

    try:
        scraper.close()
    except Exception:
        pass

    return report


def diagnose_source(name: str, *, target: int = 100,
                     no_ingest: bool = False) -> dict:
    """Look up `name` in the registry and run the diagnostic."""
    from src.sources.registry import all_scrapers

    found = next((s for s in all_scrapers() if s.name == name), None)
    if found is None:
        raise ValueError(f"unknown source: {name}")
    return diagnose_source_with(found, target=target, no_ingest=no_ingest)
```

- [ ] **Step 5: Run the test suite — expect 6 passes**

Run:
```bash
cd "C:\Users\Administrator\OneDrive\Projects\scraper-rehabilitation"
python -m pytest tests/test_diagnose.py -v
```

Expected: all 6 tests pass. If any fail, read the assertion message, fix `src/diagnose.py`, rerun.

- [ ] **Step 6: Wire `--diagnose` into `run_daily.py`**

Edit `run_daily.py`. In `_parse_args`, add these two flags after the existing `--parallel`:

```python
    p.add_argument(
        "--diagnose", metavar="SOURCE",
        help="Run one source with per-stage diagnostics and exit. "
             "Emits data/reports/diagnose_<source>_<ts>.json.",
    )
    p.add_argument(
        "--no-ingest", action="store_true",
        help="Dry-run: skip storage writes. Only meaningful with --diagnose.",
    )
```

In `main()`, add this block immediately after `args = _parse_args()` (before the backend-selection logic):

```python
    # --diagnose short-circuits normal ingest with per-stage instrumentation.
    if args.diagnose:
        from src.diagnose import diagnose_source
        import json as _json
        report = diagnose_source(
            args.diagnose,
            target=args.target,
            no_ingest=args.no_ingest,
        )
        print(_json.dumps({"source": report["source"],
                            "summary": report["summary"],
                            "stages": [{"stage": s["stage"],
                                        "input_count": s.get("input_count"),
                                        "output_count": s["output_count"]}
                                       for s in report["stages"]]},
                           indent=2))
        return 0
```

- [ ] **Step 7: Smoke-test the CLI flag end-to-end**

Run:
```bash
cd "C:\Users\Administrator\OneDrive\Projects\scraper-rehabilitation"
python run_daily.py --diagnose remoteok --target 10 --no-ingest
```

Expected: JSON output with `"source": "remoteok"` and 7 stages printed to stdout, AND a new file under `data/reports/diagnose_remoteok_*.json`. Non-zero rows_written in recency_filter is acceptable because remoteok is healthy — we're just confirming the plumbing works.

- [ ] **Step 8: Commit**

Run:
```bash
git add src/diagnose.py tests/test_diagnose.py run_daily.py
git commit -m "feat(diagnose): add per-source diagnostic harness

Wraps a single source's fetch → parse → filter → dedup → ingest pipeline
with structured per-stage instrumentation. Emits JSON reports to
data/reports/diagnose_<source>_<ts>.json so operators can see which
pipeline stage drops rows without grepping logs.

New CLI flags in run_daily.py:
  --diagnose SOURCE   run single source with diagnostics and exit
  --no-ingest         dry-run: skip storage writes

Covered by tests/test_diagnose.py (6 tests, no network).
"
```

---

## Task 3: Run `--diagnose` across top-8 sources

**Goal:** Capture one JSON diagnostic report per top-priority source. These reports drive every fix in Task 4. **No commits in this task — reports go to gitignored `data/reports/`.**

**Files:** none modified. Output lands in `data/reports/diagnose_*.json` (gitignored).

**Top-8 sources to diagnose (per spec DS2):** `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `workday`, `icims`, `usajobs`, `adzuna`.

- [ ] **Step 1: Run diagnostic against each top-8 source, in order**

For each source, run:

```bash
cd "C:\Users\Administrator\OneDrive\Projects\scraper-rehabilitation"
python run_daily.py --diagnose greenhouse --target 50 --no-ingest
python run_daily.py --diagnose lever --target 50 --no-ingest
python run_daily.py --diagnose ashby --target 50 --no-ingest
python run_daily.py --diagnose smartrecruiters --target 50 --no-ingest
python run_daily.py --diagnose workday --target 50 --no-ingest
python run_daily.py --diagnose icims --target 50 --no-ingest
python run_daily.py --diagnose usajobs --target 50 --no-ingest
python run_daily.py --diagnose adzuna --target 50 --no-ingest
```

If any hangs past 2 minutes, ^C and move on — record that source as `needs-rewrite: timeout` in your notes.

- [ ] **Step 2: Read all 8 reports and classify the blocking stage per source**

For each report at `data/reports/diagnose_<source>_*.json`, read the JSON and classify:

- **"seeds empty"** — `fetch_seeds.output_count` is 0 or very small.
- **"fetch failing"** — `fetch_listings.failures[]` has entries, most with non-200 status.
- **"parse failing"** — `fetch_listings.output_count` > 0 but `parse_listings.output_count` is much smaller (e.g. 100 raw → 0 parsed).
- **"normalize drops everything"** — `normalize.output_count` is 0 when `parse_listings.output_count` > 0.
- **"recency too tight"** — `recency_filter` drops >90%.
- **"dedup drops everything"** — `dedup_check` drops >90%.
- **"ingest failing"** — non-empty ingest input but `rows_written` is 0 AND `ingest.notes` shows an error.
- **"healthy"** — `rows_written > 0`.

- [ ] **Step 3: Record classifications in a scratch markdown file**

Write (do not commit) a table at `docs/superpowers/plans/_task3-notes.md`:

```markdown
# Task 3 diagnostic classifications

| Source          | Blocking stage      | Drop count / stage | Report filename |
|-----------------|---------------------|--------------------|-----------------|
| greenhouse      | <classification>    | <stage>: <input→output> | diagnose_greenhouse_*.json |
| lever           | <classification>    | ... | ... |
| ashby           | ...                 | ... | ... |
| smartrecruiters | ...                 | ... | ... |
| workday         | ...                 | ... | ... |
| icims           | ...                 | ... | ... |
| usajobs         | ...                 | ... | ... |
| adzuna          | ...                 | ... | ... |
```

This table drives Task 4. It is intentionally NOT committed — it's scratch work.

- [ ] **Step 4: No commit for this task**

Reports are gitignored. Proceed to Task 4.

---

## Task 4: Per-source fix protocol (iterative, up to 8 iterations)

**Goal:** For each top-8 source with a fixable issue, apply a targeted fix, verify the fix via re-diagnose, commit. One commit per source.

**Files:** up to 8 under `src/sources/*.py`; possibly `data/companies/<source>.txt` for seed issues; tests under `tests/test_<source>.py` if the source has one.

**This task is a protocol, not 8 separate pre-written code listings.** The exact fix depends on what Task 3 revealed. The subagent executes this protocol once per source with a real finding.

### Protocol (repeat per source)

- [ ] **Step 1: Open the diagnostic report + source file**

```bash
cat data/reports/diagnose_<source>_<ts>.json | python -m json.tool | head -60
code src/sources/<source>.py          # or your editor
```

- [ ] **Step 2: Identify the root cause from the blocking stage**

Decision tree, by blocking classification from Task 3:

| Blocking stage | Likely root cause | Where to look |
|---|---|---|
| `seeds empty` | Discovery never ran / seed file not loaded. | Check `data/companies/<source>.txt` exists and has entries. If empty, this source moves to Task 6. Skip the fix loop for it. |
| `fetch failing` | URL schema changed, auth required, rate-limited, or API removed. | `<source>.py` `fetch_listings()`. Check `resp.status_code` values in report `failures[]`. |
| `parse failing` | Response JSON shape changed — key names differ. | `<source>.py` `parse_listing()`. Diff `raw` fields in report against what `parse_listing` reads. |
| `normalize drops everything` | Title filter is too strict, or location not US. | `src/normalizer.py post_filter` — but do NOT modify for one source; investigate whether the source's `parse_listing` returns non-IT titles. |
| `recency too tight` | 24h default is too aggressive. | Do NOT fix here — Task 5 loosens recency globally. Skip this source, note "blocked by recency, see Task 5". |
| `dedup drops everything` | All rows already in DB — run is idempotent. | Confirm via Supabase query. This is HEALTHY behavior after first run; not a fix target. Skip. |
| `ingest failing` | Supabase schema rejects the row (column missing, type mismatch). | Read `ingest.notes` for error. Fix in `src/supabase_storage.py` if a column mapping is wrong — but only if you're certain. |
| `healthy` | No fix needed. | Skip. |

- [ ] **Step 3: Write a failing test that encodes the bug**

Place the test in `tests/test_<source>.py` (create if missing — there are existing patterns like `tests/test_paylocity.py`).

Example template (adapt the assertion to the actual bug):

```python
# tests/test_<source>.py
from __future__ import annotations

from src.sources.<source> import <SourceClass>


def test_<source>_parses_sample_response():
    """Regression: <describe the specific diagnostic finding>.

    Report: data/reports/diagnose_<source>_<ts>.json
    Blocking stage: <stage> — <N> input, <M> output.
    """
    sample = {
        # realistic raw record from the failing source.
        # Copy a real one from the diagnostic's fetch_listings output if possible.
    }
    scraper = <SourceClass>()
    job = scraper.parse_listing(sample)
    assert job is not None
    assert job.job_title == "<expected>"
    assert job.company_name == "<expected>"
```

- [ ] **Step 4: Run the failing test to confirm it fails**

```bash
python -m pytest tests/test_<source>.py::test_<source>_parses_sample_response -v
```

Expected: FAIL.

- [ ] **Step 5: Apply the targeted fix to `src/sources/<source>.py`**

Make the minimum change that fixes the identified root cause. Common patterns:

- Key rename: `raw.get("old_key")` → `raw.get("new_key")`
- New location path: `self.BASE = "https://new.host/api/v2/..."`
- Added auth header: `self.http.get(url, headers={"Authorization": f"Bearer {token}"})`
- Fallback field: `title = raw.get("title") or raw.get("jobTitle")`

Do NOT refactor unrelated code. One bug, one commit.

- [ ] **Step 6: Run the test to confirm fix**

```bash
python -m pytest tests/test_<source>.py -v
```

Expected: PASS.

- [ ] **Step 7: Re-diagnose to verify real-world impact**

```bash
python run_daily.py --diagnose <source> --target 50 --no-ingest
cat data/reports/diagnose_<source>_<latest-ts>.json | python -m json.tool | grep -A1 '"summary"'
```

Expected: `rows_written` increases from the pre-fix report, OR a downstream stage now becomes the new blocker (acceptable — it means this fix worked, something else is also wrong).

- [ ] **Step 8: Commit with the report filename in the body**

```bash
git add src/sources/<source>.py tests/test_<source>.py
git commit -m "fix(sources/<source>): <one-line summary>

Pre-fix diagnostic: data/reports/diagnose_<source>_<pre-ts>.json
  Blocking stage: <stage> (input=<N>, output=<M>)

Post-fix diagnostic: data/reports/diagnose_<source>_<post-ts>.json
  rows_written: <before> → <after>

<Brief explanation of the root cause and what the fix does.>
"
```

- [ ] **Step 9: Move to next source OR escalate**

Time-box: 1 hour per source. If stuck past 1 hour:

- Do NOT commit a half-fix.
- Add an entry for this source to the running list for Task 9's rehabilitation report: `needs-rewrite: <source> — <what we learned, what's still broken>`.
- Move to the next source.

### Exit criteria for Task 4

All 8 top sources have been through the protocol. Each has either:
- A commit landing a targeted fix, OR
- An entry noted for Task 9 explaining why it was deferred (e.g. `blocked by recency → Task 5`, `needs API key`, `needs-rewrite`).

---

## Task 5: Per-source recency config

**Goal:** Loosen the global 24h recency to 7d, and add per-source overrides so aggregators (remoteok) stay tight while enterprise ATSes (workday) get more runway.

**Files:**
- Create: `tests/test_recency_overrides.py`
- Modify: `src/recency.py` (new `recency_for_source` function)
- Modify: `config.py` (new `recency_overrides` field on `Settings`)
- Modify: `.env.example` (update RECENCY_HOURS + new per-source entries)

- [ ] **Step 1: Call Context7 for `python-dotenv` + `dataclass field factory` patterns**

Run:
```
mcp__context7__resolve-library-id(libraryName="python-dotenv")
mcp__context7__query-docs(library_id=<id>, topic="dataclass field default_factory environment variable")
```

Purpose: confirm `dataclass(frozen=True)` + `field(default_factory=...)` reads env AT import time. This is relevant because `config.py` uses `@dataclass(frozen=True)` with `default_factory` for all the existing list fields. Our new `recency_overrides` dict must work the same way.

- [ ] **Step 2: Write failing tests for `recency_for_source`**

Create `tests/test_recency_overrides.py`:

```python
"""Tests for per-source recency overrides.

recency_for_source(name) must:
  1. return the RECENCY_HOURS_<SOURCE_UPPER> env override if present
  2. fall back to the RECENCY_HOURS global
  3. finally default to 168 (7 days) if neither is set
"""
from __future__ import annotations

import os

import pytest


def test_returns_source_specific_override(monkeypatch):
    monkeypatch.setenv("RECENCY_HOURS", "168")
    monkeypatch.setenv("RECENCY_HOURS_REMOTEOK", "24")
    # Force config module to re-read by reloading:
    import importlib
    import config
    importlib.reload(config)
    from src import recency
    importlib.reload(recency)

    assert recency.recency_for_source("remoteok") == 24


def test_falls_back_to_global_when_no_override(monkeypatch):
    monkeypatch.setenv("RECENCY_HOURS", "168")
    monkeypatch.delenv("RECENCY_HOURS_GREENHOUSE", raising=False)
    import importlib
    import config
    importlib.reload(config)
    from src import recency
    importlib.reload(recency)

    assert recency.recency_for_source("greenhouse") == 168


def test_defaults_to_168_when_nothing_set(monkeypatch):
    monkeypatch.delenv("RECENCY_HOURS", raising=False)
    monkeypatch.delenv("RECENCY_HOURS_LEVER", raising=False)
    import importlib
    import config
    importlib.reload(config)
    from src import recency
    importlib.reload(recency)

    assert recency.recency_for_source("lever") == 168


def test_source_name_is_case_insensitive_lookup(monkeypatch):
    """RECENCY_HOURS_USAJOBS matches source name "usajobs"."""
    monkeypatch.setenv("RECENCY_HOURS", "168")
    monkeypatch.setenv("RECENCY_HOURS_USAJOBS", "720")
    import importlib
    import config
    importlib.reload(config)
    from src import recency
    importlib.reload(recency)

    assert recency.recency_for_source("usajobs") == 720
```

- [ ] **Step 3: Run failing tests**

```bash
python -m pytest tests/test_recency_overrides.py -v
```

Expected: 4 failures with `AttributeError: module 'src.recency' has no attribute 'recency_for_source'`.

- [ ] **Step 4: Add `recency_overrides` to `config.py`**

Edit `config.py`. Find the existing `recency_hours: int = _int("RECENCY_HOURS", 24)` line in the `Settings` dataclass (should be near the top of that class). Below it, change default from 24 to 168, then add the overrides field:

```python
    recency_hours: int = _int("RECENCY_HOURS", 168)

    recency_overrides: dict[str, int] = field(default_factory=lambda: {
        k.removeprefix("RECENCY_HOURS_").lower(): int(v)
        for k, v in os.environ.items()
        if k.startswith("RECENCY_HOURS_") and v.strip().isdigit()
    })
```

- [ ] **Step 5: Add `recency_for_source` to `src/recency.py`**

Edit `src/recency.py`. Add this function at the bottom of the file:

```python
def recency_for_source(name: str) -> int:
    """Return the recency window in hours for this source.

    Lookup order:
      1. RECENCY_HOURS_<SOURCE_UPPER> env var (via settings.recency_overrides)
      2. RECENCY_HOURS env var (settings.recency_hours)
      3. 168 (7 days)
    """
    # Late import: config reads env at import time, and tests reload it.
    from config import settings
    override = settings.recency_overrides.get(name.lower())
    if override is not None:
        return override
    return settings.recency_hours or 168
```

- [ ] **Step 6: Run tests**

```bash
python -m pytest tests/test_recency_overrides.py -v
```

Expected: all 4 pass.

- [ ] **Step 7: Update `.env.example`**

Edit `.env.example`. Change:

```
RECENCY_HOURS=24
```

to:

```
RECENCY_HOURS=168

# Optional per-source recency overrides (hours). Format: RECENCY_HOURS_<SOURCE_NAME_UPPER>.
# Source names match the `name` attribute of each scraper (see src/sources/).
RECENCY_HOURS_REMOTEOK=24
RECENCY_HOURS_ADZUNA=72
RECENCY_HOURS_USAJOBS=720
RECENCY_HOURS_WORKDAY=336
```

- [ ] **Step 8: Update `.env` (local, not committed)**

Edit `.env` — same changes as `.env.example`. Do NOT `git add .env` (it's gitignored).

Confirm:
```bash
git check-ignore .env        # should print ".env"
```

- [ ] **Step 9: Smoke-test the config round-trip**

```bash
python -c "from config import settings; from src.recency import recency_for_source; print('global:', settings.recency_hours); print('overrides:', settings.recency_overrides); print('remoteok:', recency_for_source('remoteok')); print('greenhouse:', recency_for_source('greenhouse'))"
```

Expected:
```
global: 168
overrides: {'remoteok': 24, 'adzuna': 72, 'usajobs': 720, 'workday': 336}
remoteok: 24
greenhouse: 168
```

- [ ] **Step 10: Commit**

```bash
git add src/recency.py config.py .env.example tests/test_recency_overrides.py
git commit -m "feat(recency): per-source recency window with env overrides

Loosens the global recency default from 24h to 168h (7d) and introduces
RECENCY_HOURS_<SOURCE>=N environment variables for per-source tuning.

  remoteok: 24h  (aggregator churns daily)
  adzuna:   72h  (aggregator, reduce duplicate ingests)
  usajobs:  720h (government postings stay open longer)
  workday:  336h (enterprise hiring cadence slower)

New API: src.recency.recency_for_source(name) -> int.
Falls back to RECENCY_HOURS global, then to 168.

Cannot introduce duplicates — dedup check in src/diagnose.py and
the existing storage ingest both fingerprint against Supabase first.
"
```

---

## Task 6: Hand-curate 5 ATS seed files

**Goal:** Replace empty-or-tiny seed files for 5 opaque-ATS connectors with 10-15 verified customers each. One commit per ATS.

**Files:**
- Modify: `data/companies/dayforce.txt`
- Modify: `data/companies/paylocity.txt`
- Modify: `data/companies/ukg.txt`
- Modify: `data/companies/eightfold.txt`
- Modify: `data/companies/oracle_rc.txt` (augment; don't wholesale replace)

**Per-ATS source URLs for customer research:**

| ATS | Customer-list URL(s) | Seed format |
|---|---|---|
| Dayforce | https://www.dayforce.com/en/customers, https://www.ceridian.com/our-customers | bare slug `acme` → uses `acme.dayforcehcm.com`. Optional `shard:slug` like `us58:acme`. |
| Paylocity | https://www.paylocity.com/our-customers | tenant UUID from `recruiting.paylocity.com/Recruiting/Jobs/All/<UUID>` iframe. |
| UKG | https://www.ukg.com/about-us/customers, https://www.ukg.com/customers | composite `TENANT/UUID` (optionally `SHARD\|TENANT/UUID`). |
| Eightfold | https://eightfold.ai/customers/ | subdomain slug of `<slug>.eightfold.ai`. |
| Oracle RC | https://www.oracle.com/human-capital-management/recruiting/customers/ | composite `host/region/site`, e.g. `ecqj/us2/CX`. |

### Per-ATS protocol (repeat 5 times, once per ATS)

- [ ] **Step 1: Fetch the vendor's public customer page**

Use `WebFetch` for the primary URL. If the page is lazy-loaded or JS-only, fall back to `WebSearch` with a query like `"Dayforce customers" site:dayforce.com`.

Record the fetch timestamp — you'll cite it in the commit body.

- [ ] **Step 2: Extract 15-20 candidate enterprise names**

From the fetched page, pull recognisable brand names. Prefer large public companies (Fortune 500, well-known SaaS) over small private ones because their careers pages are more likely to be actively posting and their ATS tenant is more likely to be discoverable.

- [ ] **Step 3: Resolve each candidate to the ATS seed format**

For each brand:
- **Dayforce:** try `https://<brand-slug>.dayforcehcm.com` in a `WebFetch`. If it returns a Dayforce landing page (not a 404 or redirect to marketing), the slug works. Otherwise try `us58:<brand-slug>` or the brand's careers page directly to sniff the shard.
- **Paylocity:** search the brand's `/careers` page for an iframe with `recruiting.paylocity.com/Recruiting/Jobs/All/<UUID>`. Extract the UUID.
- **UKG:** search `<brand>.onhire.com` or the brand's careers page for a link to a UKG-hosted job board. Extract `TENANT/UUID` from the URL.
- **Eightfold:** try `https://<brand-slug>.eightfold.ai`. If it loads, the slug works.
- **Oracle RC:** search the brand's careers page for a URL matching `https://<host>.fa.<region>.oraclecloud.com/hcmUI/CandidateExperience/...?siteNumber=<site>`. Extract `<host>/<region>/<site>`.

For each candidate that doesn't cleanly resolve, skip it. Target **10 good seeds, not 15 mediocre ones.**

- [ ] **Step 4: Write the seed file**

Replace the file contents with one seed per line, alphabetised, no blank lines, no comments. Example for `data/companies/dayforce.txt`:

```
acme
brick-and-mortar-co
macys
starbucks
target
us58:nationalbank
whole-foods
```

For Oracle RC which augments (not replaces):

```bash
# Append, then re-sort + dedupe:
cat data/companies/oracle_rc.txt <(cat <<'EOF'
newhost1/us2/CX
newhost2/em3/HR
EOF
) | sort -u > data/companies/oracle_rc.txt.new
mv data/companies/oracle_rc.txt.new data/companies/oracle_rc.txt
```

- [ ] **Step 5: Sanity-check the file**

Run:
```bash
wc -l data/companies/<ats>.txt             # 10-15 lines (or more for oracle_rc)
head data/companies/<ats>.txt              # visual check
grep -c '^$' data/companies/<ats>.txt      # should be 0 (no blank lines)
sort data/companies/<ats>.txt | uniq -d    # should be empty (no duplicates)
```

- [ ] **Step 6: Smoke-test the scraper picks up the new seeds**

```bash
python run_daily.py --diagnose <ats> --target 20 --no-ingest
# inspect the latest report
ls -lt data/reports/diagnose_<ats>_*.json | head -1
```

Expected: `fetch_seeds.output_count` equals the number of lines in the seed file. `fetch_listings.output_count` is non-zero (unless all tenants 404, in which case at least one `failures[]` entry should appear).

- [ ] **Step 7: Commit**

```bash
git add data/companies/<ats>.txt
git commit -m "data(seeds/<ats>): hand-curate N verified customers

Source: <customer-page-URL> (fetched <YYYY-MM-DD>).
N seeds, alphabetised, one per line.

Previous state: <empty | N-line stub | augmented from N → N+M>.

Each seed resolved to <format description: bare slug | UUID | host/region/site>
and verified by HEAD request before inclusion.
"
```

### Exit criteria for Task 6

All 5 ATS seed files committed. Each commit stands on its own.

---

## Task 7: Final validation run

**Goal:** Run the full sequential pass across all 24 sources and capture a final snapshot report. **No commit — reports gitignored.**

**Files:** none modified. Output: `data/reports/sequential_run_<ts>.json`.

- [ ] **Step 1: Check Supabase baseline row count**

Run:
```bash
python -c "from src.supabase_storage import SupabaseStorage; print('baseline:', SupabaseStorage().count_clean())"
```

Record the baseline number.

- [ ] **Step 2: Run the sequential runner**

```bash
cd "C:\Users\Administrator\OneDrive\Projects\scraper-rehabilitation"
python scripts/run_sources_sequentially.py --target 100
```

Expected runtime: 15-30 minutes for 24 sources. The runner prints per-source progress with `[N/24] source rc=0 elapsed=Ns before=X after=Y delta=+Z`.

- [ ] **Step 3: Read the sequential-run report**

```bash
ls -lt data/reports/sequential_run_*.json | head -1
cat $(ls -t data/reports/sequential_run_*.json | head -1) | python -m json.tool
```

- [ ] **Step 4: Validate hard-pass criteria**

Check:
- [ ] ≥10 sources have `delta > 0` in the sequential report.
- [ ] Total row count (post-run) ≥ 200.
- [ ] Each of `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `workday`, `icims`, `usajobs`, `adzuna` either has `delta > 0` OR is documented as deferred in Task 4's notes.
- [ ] Script exited with `rc=0` for every source OR the failure is documented.

If any hard-pass criterion fails, escalate:
- If 8-9 sources produced rows but not 10: go back to Task 4 and attempt one more fix on the top non-producing source.
- If total is <200 but ≥10 sources produced: accept — the target was a proxy for variety, and we have it.
- If Supabase count didn't go up at all: storage write is broken. Stop and investigate `src/supabase_storage.py`; this is outside the scope of this plan.

- [ ] **Step 5: No commit for this task**

Proceed to Task 8.

---

## Task 8: Operator wrappers

**Goal:** Give the operator two one-command entry points for the lifecycle: refresh data, diagnose a specific source.

**Files:**
- Create: `scripts/refresh.sh`, `scripts/refresh.ps1`
- Create: `scripts/diagnose.sh`, `scripts/diagnose.ps1`

- [ ] **Step 1: Write `scripts/refresh.sh`**

Create `scripts/refresh.sh`:

```bash
#!/usr/bin/env bash
# Refresh all scraper sources in sequence, printing a summary at the end.
# Usage: ./scripts/refresh.sh [--target 100]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

TARGET="${1:-100}"
echo "[refresh] starting sequential scraper run (target=$TARGET per source)"
python scripts/run_sources_sequentially.py --target "$TARGET"

REPORT=$(ls -t data/reports/sequential_run_*.json | head -1)
echo ""
echo "[refresh] latest report: $REPORT"
python -c "
import json, sys
data = json.load(open('$REPORT'))
print(f\"baseline={data.get('baseline')} sources={len(data['results'])}\")
producers = [r for r in data['results'] if r.get('delta') and r['delta'] > 0]
print(f\"producing sources: {len(producers)}\")
for r in sorted(data['results'], key=lambda r: -(r.get('delta') or 0))[:10]:
    d = r.get('delta')
    print(f\"  {r['source']:20s} delta={d}\")
"
```

Make it executable:

```bash
chmod +x scripts/refresh.sh
```

- [ ] **Step 2: Write `scripts/refresh.ps1`**

Create `scripts/refresh.ps1`:

```powershell
# Refresh all scraper sources in sequence, printing a summary at the end.
# Usage: .\scripts\refresh.ps1 [-Target 100]
param([int]$Target = 100)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Host "[refresh] starting sequential scraper run (target=$Target per source)"
python scripts/run_sources_sequentially.py --target $Target

$report = Get-ChildItem data/reports/sequential_run_*.json | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host ""
Write-Host "[refresh] latest report: $($report.Name)"
$data = Get-Content $report.FullName | ConvertFrom-Json
Write-Host "baseline=$($data.baseline) sources=$($data.results.Count)"
$producers = $data.results | Where-Object { $_.delta -gt 0 }
Write-Host "producing sources: $($producers.Count)"
$data.results | Sort-Object { -($_.delta -as [int]) } | Select-Object -First 10 | ForEach-Object {
    Write-Host ("  {0,-20} delta={1}" -f $_.source, $_.delta)
}
```

- [ ] **Step 3: Write `scripts/diagnose.sh`**

Create `scripts/diagnose.sh`:

```bash
#!/usr/bin/env bash
# Run the per-source diagnostic harness.
# Usage: ./scripts/diagnose.sh <source> [--no-ingest]
set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <source> [--no-ingest]" >&2
    echo "Example: $0 greenhouse" >&2
    exit 2
fi

SOURCE="$1"
shift
EXTRA_ARGS=("$@")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

python run_daily.py --diagnose "$SOURCE" --target 50 "${EXTRA_ARGS[@]}"

REPORT=$(ls -t "data/reports/diagnose_${SOURCE}"_*.json 2>/dev/null | head -1)
if [[ -n "$REPORT" ]]; then
    echo ""
    echo "[diagnose] report written to: $REPORT"
fi
```

Make it executable:

```bash
chmod +x scripts/diagnose.sh
```

- [ ] **Step 4: Write `scripts/diagnose.ps1`**

Create `scripts/diagnose.ps1`:

```powershell
# Run the per-source diagnostic harness.
# Usage: .\scripts\diagnose.ps1 <source> [-NoIngest]
param(
    [Parameter(Mandatory=$true, Position=0)][string]$Source,
    [switch]$NoIngest
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$extraArgs = @()
if ($NoIngest) { $extraArgs += "--no-ingest" }

python run_daily.py --diagnose $Source --target 50 @extraArgs

$report = Get-ChildItem "data/reports/diagnose_${Source}_*.json" -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($report) {
    Write-Host ""
    Write-Host "[diagnose] report written to: $($report.FullName)"
}
```

- [ ] **Step 5: Smoke-test both wrappers**

```bash
# Bash
./scripts/diagnose.sh remoteok --no-ingest

# PowerShell (from PowerShell terminal)
.\scripts\diagnose.ps1 remoteok -NoIngest
```

Expected: both exit with `rc=0` and print "report written to: data/reports/diagnose_remoteok_*.json".

Skip smoke-testing `refresh.sh` / `refresh.ps1` in this task — Task 7 already did a full run.

- [ ] **Step 6: Commit**

```bash
git add scripts/refresh.sh scripts/refresh.ps1 scripts/diagnose.sh scripts/diagnose.ps1
git commit -m "feat(scripts): operator wrappers for refresh + diagnose

scripts/refresh.sh + refresh.ps1:
  Run scripts/run_sources_sequentially.py across all sources,
  print per-source delta summary at end.

scripts/diagnose.sh + diagnose.ps1:
  Thin wrapper around run_daily.py --diagnose <source>,
  points operator at the emitted report.

POSIX shell for Git Bash/WSL, PowerShell for native Windows.
"
```

---

## Task 9: Rehabilitation report

**Goal:** Write the before/after summary document that captures what was fixed, what was deferred, and how to rerun.

**Files:**
- Create: `docs/scraper-rehabilitation-report.md`

- [ ] **Step 1: Gather the data points**

Read:
- Pre-run state from memory/spec: "1 of 24 sources producing rows, 3 rows total in Supabase."
- Post-run state from the latest `data/reports/sequential_run_*.json` (Task 7).
- Per-source verdicts from Task 4's scratch notes + Task 6's commits.

- [ ] **Step 2: Write `docs/scraper-rehabilitation-report.md`**

Use this template. Fill in the placeholders with real values:

```markdown
# Scraper Rehabilitation Report

**Date:** <YYYY-MM-DD>
**Spec:** `docs/superpowers/specs/2026-04-19-scraper-rehabilitation-design.md`
**Branch:** `scraper-rehabilitation`

## Summary

| Metric | Before | After |
|---|---|---|
| Sources producing rows | 1 / 24 (remoteok) | <N> / 24 |
| Total rows in `scraper_jobs_clean` | 3 | <M> |
| Distinct posting dates | 1 | <K> |
| Global recency window | 24h | 168h (+ per-source overrides) |
| Diagnostic harness | none | `python run_daily.py --diagnose <source>` |
| Opaque-ATS seeds | 4 of 5 near-empty | all 5 populated |

## Per-source verdict table

| Source          | Status       | Rows landed | Notes |
|-----------------|--------------|-------------|-------|
| remoteok        | healthy      | <N>         | baseline. |
| greenhouse      | <verdict>    | <N>         | <note>|
| lever           | <verdict>    | <N>         | <note>|
| ashby           | <verdict>    | <N>         | <note>|
| smartrecruiters | <verdict>    | <N>         | <note>|
| workday         | <verdict>    | <N>         | <note>|
| icims           | <verdict>    | <N>         | <note>|
| usajobs         | <verdict>    | <N>         | <note>|
| adzuna          | <verdict>    | <N>         | <note>|
| workable        | post-A       | <N>         | not in top-8 diagnostic scope. |
| recruitee       | post-A       | <N>         | not in top-8 diagnostic scope. |
| personio        | post-A       | <N>         | not in top-8 diagnostic scope. |
| jobvite         | post-A       | <N>         | not in top-8 diagnostic scope. |
| jazzhr          | post-A       | <N>         | not in top-8 diagnostic scope. |
| eightfold       | post-A       | <N>         | seeds added Task 6; diagnostic recommended. |
| rippling        | post-A       | <N>         | not in top-8 diagnostic scope. |
| teamtailor      | post-A       | <N>         | not in top-8 diagnostic scope. |
| successfactors  | post-A       | <N>         | not in top-8 diagnostic scope. |
| bamboohr        | post-A       | <N>         | not in top-8 diagnostic scope. |
| paylocity       | post-A       | <N>         | seeds added Task 6; diagnostic recommended. |
| ukg             | post-A       | <N>         | seeds added Task 6; diagnostic recommended. |
| oracle_rc       | post-A       | <N>         | seeds augmented Task 6. |
| dayforce        | post-A       | <N>         | seeds added Task 6; diagnostic recommended. |
| custom_jsonld   | post-A       | <N>         | depends on employer discovery. |

Status values:
- `healthy` — producing rows as expected.
- `fixed` — had a specific bug in Task 4, now resolved.
- `needs-rewrite` — connector needs more than a tweak; deferred.
- `needs-api-key` — requires an API key the operator has not obtained.
- `post-A` — not diagnosed in this pass; may be healthy or not.

## What changed

- **New:** `src/diagnose.py` + `--diagnose` CLI flag emitting per-stage JSON reports.
- **New:** `src.recency.recency_for_source(name)` helper + per-source env overrides.
- **Loosened:** global `RECENCY_HOURS` default 24h → 168h.
- **Populated:** 5 opaque-ATS seed files (`dayforce`, `paylocity`, `ukg`, `eightfold`, augmented `oracle_rc`).
- **Fixed:** <list of per-source fixes from Task 4>.
- **New:** `scripts/refresh.sh` / `.ps1` and `scripts/diagnose.sh` / `.ps1`.

## How to rerun

### One-off refresh

```bash
./scripts/refresh.sh              # POSIX shell / Git Bash
.\scripts\refresh.ps1             # PowerShell
```

### Diagnose a single source

```bash
./scripts/diagnose.sh greenhouse
.\scripts\diagnose.ps1 greenhouse
```

The per-source report is written to `data/reports/diagnose_<source>_<ts>.json`.

## Known remaining issues (post-A follow-ups)

- <Source X: needs-rewrite — API endpoint moved, connector uses deprecated path.>
- <Source Y: needs-api-key — requires ADZUNA_APP_ID + ADZUNA_APP_KEY.>
- <Sources Z1..Zn: post-A — not diagnosed; unknown state. Run `./scripts/diagnose.sh <name>` to check.>
- Long-tail ATS connectors (workable, jobvite, teamtailor, etc.) may still need seed curation or recency tuning.

## Success criteria vs. actual

From the spec:
- **Hard pass — 10+ of 24 sources producing rows:** <met / not met: <N> / 24>.
- **Hard pass — top-8 each have rows or documented reason:** <met / not met>.
- **Hard pass — total rows ≥ 200:** <met / not met: <M>>.
- **Hard pass — `scripts/refresh.sh` exits cleanly:** <yes / no>.
- **Soft indicators — ≥14 distinct posting dates:** <yes / no>.
- **Soft indicators — ≥3 remote_type values:** <yes / no>.
- **Soft indicators — ≥20 distinct company_name values:** <yes / no>.
```

- [ ] **Step 3: Fill in every placeholder**

Every `<...>` placeholder must be replaced with a real value. No `<...>` may remain in the committed file.

- [ ] **Step 4: Commit**

```bash
git add docs/scraper-rehabilitation-report.md
git commit -m "docs: scraper rehabilitation report

Before/after summary + per-source verdicts + rerun instructions.
Captures the outcome of the sub-project A rehabilitation work and
flags the remaining post-A follow-ups for future passes.
"
```

---

## Plan self-review

Ran against spec sections:

- **Goal (10+/24 sources):** covered by Task 4 (fixes) + Task 5 (recency) + Task 6 (seeds). Validated in Task 7.
- **S2 Standard Recovery:** Task 4 diagnostic deep-dive = S2 "diagnostic deep-dive on top sources". Task 5 = "per-source recency tuning". Task 6 = "light seed curation for Dayforce/Paylocity/UKG" (plus eightfold, oracle_rc for completeness).
- **C2 Manual daily:** Task 8 = `scripts/refresh.sh`. No cron.
- **SC1 Hand-curate:** Task 6 step 1 fetches vendor customer pages.
- **DS2 Top-8:** Task 3 covers exactly `greenhouse, lever, ashby, smartrecruiters, workday, icims, usajobs, adzuna`.
- **Approach A (instrumented-first):** Tasks 2-3-4 sequence builds harness → runs → fixes.
- **Validation criteria:** Task 7 step 4 enforces.
- **Deliverables (1) healthier Supabase:** Task 7. **(2) refresh.sh:** Task 8. **(3) diagnose.sh:** Task 8. **(4) rehabilitation report:** Task 9. **(5) clean git log:** every task commits once per fix/feature.
- **Out of scope confirmations:** no scraper-web changes, no migrations, no cron, no integration-test suite, no per-tenant validation — confirmed in file-structure header.
- **Context7 rule:** called out at top; referenced in Task 2 Step 1 (structlog) and Task 5 Step 1 (python-dotenv).

Type-consistency check:
- `diagnose_source(name, target, no_ingest) -> dict` — matches between Task 2 implementation, Task 3 CLI invocations, and spec.
- `recency_for_source(name: str) -> int` — matches between Task 2 usage, Task 5 definition, spec.
- `settings.recency_overrides: dict[str, int]` — matches between Task 5 config and Task 5 test expectations.
- Stage name list `["fetch_seeds", "fetch_listings", "parse_listings", "normalize", "recency_filter", "dedup_check", "ingest"]` — matches across Task 2 implementation, Task 2 test expectations, Task 3 classification, spec.

No placeholders detected. Every code block is complete. Every test has assertions. Every commit has a written message.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-19-scraper-rehabilitation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) after each, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

**Which approach?**
