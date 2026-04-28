# Daily Data-Analyst Job Aggregator

A production-ready Python pipeline that harvests **fresh U.S. Data-Analyst
jobs** (Data Analyst, Junior Data Analyst, Business Data Analyst, Reporting
Analyst, Product Analyst, BI Analyst, SQL Analyst, Analytics Analyst) from
compliant, public sources, normalizes and de-duplicates them, and emits a
ranked **top-100 unique jobs per day** as CSV + JSON.

Pluggable by design — adding a new source is a ~50-line adapter class.

---

## 1. Architecture

```
run_daily.py                orchestrator (entry point)
    |
    +-- src/sources/*       one adapter per platform
    |        (each subclasses BaseSourceScraper)
    |
    +-- src/http_client.py  httpx + retries + backoff + UA rotation + per-host throttle
    +-- src/normalizer.py   title match / US filter / remote/seniority inference
    +-- src/recency.py      parses "5 hours ago"/ISO/etc.; 24h gate
    +-- src/deduplicator.py canonical-key + soft-match dedup
    +-- src/storage.py      SQLAlchemy (SQLite default, Postgres compatible)
    +-- src/exporter.py     CSV + JSON; ranked top-N
    +-- src/report.py       daily summary
```

Pipeline:

```
fetch (parallel per source)
  -> save raw records
  -> parse to JobPosting
  -> post-filter (target title + US)
  -> recency filter (<=24h)
  -> dedupe (canonical + soft)
  -> persist jobs_clean
  -> rank -> top 100
  -> export CSV + JSON
  -> daily summary report
```

---

## 2. Project structure

```
scraper/
├── README.md
├── requirements.txt
├── .env.example
├── config.py
├── run_daily.py
├── scripts/
│   ├── init_db.py
│   ├── schema.sql
│   └── cron.example
├── src/
│   ├── base.py              # BaseSourceScraper
│   ├── models.py            # JobPosting dataclass
│   ├── http_client.py
│   ├── logging_config.py
│   ├── normalizer.py
│   ├── recency.py
│   ├── deduplicator.py
│   ├── storage.py
│   ├── exporter.py
│   ├── report.py
│   └── sources/
│       ├── registry.py      # plugin registry
│       ├── jobpulse_import.py
│       ├── greenhouse.py
│       ├── lever.py
│       ├── ashby.py
│       ├── smartrecruiters.py
│       ├── workable.py
│       ├── remoteok.py
│       ├── usajobs.py
│       └── adzuna.py
├── external/
│   └── JobPulse/            # cloned — source of truth for company target lists
├── tests/
├── samples/
├── data/                    # raw/, exports/, reports/, jobs.db
└── logs/
```

---

## 3. Supported sources

| Source          | Access method                                   | Auth       | Compliance |
|-----------------|-------------------------------------------------|------------|------------|
| Greenhouse      | `boards-api.greenhouse.io/v1/boards/.../jobs`   | none       | ✅ official public API |
| Lever           | `api.lever.co/v0/postings/{company}`            | none       | ✅ official public API |
| Ashby           | `api.ashbyhq.com/posting-api/job-board/{org}`   | none       | ✅ official public API |
| SmartRecruiters | `api.smartrecruiters.com/.../postings`          | none       | ✅ official public API |
| Workable        | `apply.workable.com/api/v3/accounts/{sub}/jobs` | none       | ✅ documented widget API |
| RemoteOK        | `remoteok.com/api`                              | none       | ✅ documented JSON API |
| USAJOBS         | `data.usajobs.gov/api/search`                   | free key   | ✅ official U.S. government API |
| Adzuna          | `api.adzuna.com/v1/api/jobs/us/search`          | free key   | ✅ licensed aggregator (covers Indeed-class listings) |

### JobPulse integration

This project clones [`itsmeBlackOps/JobPulse`](https://github.com/itsmeBlackOps/JobPulse)
into `external/JobPulse/` and **dynamically reads its `COMPANY_TARGETS` arrays
via AST** (see [src/sources/jobpulse_import.py](src/sources/jobpulse_import.py)).
Every company JobPulse tracks on Greenhouse / Lever / Ashby / Workable is
automatically fed into our corresponding connector.

### Company discovery layer (`src/discovery/`)

The connectors are fed by a 4-layer union (each layer de-duped against earlier ones):

1. **User-configured** env vars (`GREENHOUSE_BOARDS`, `LEVER_COMPANIES`, …)
2. **Discovery output** — `data/companies/<source>.txt`, produced by:
   ```bash
   python scripts/discover_companies.py
   ```
3. **JobPulse tenants** — AST-parsed from `external/JobPulse/`
4. **Embedded seed list** — 400+ curated well-known slugs in
   [src/discovery/seed_lists.py](src/discovery/seed_lists.py)

The discovery CLI runs 5 strategies per source, unions, then **validates every
slug live against the public API** (keeping only HTTP-200 responses):

| Strategy | How it discovers |
|----------|------------------|
| `seed_lists` | Embedded curated list (offline, always available). |
| `jobpulse`   | AST-parsed `COMPANY_TARGETS` from the cloned repo. |
| `github`     | Any URLs you list in `GITHUB_SLUG_URLS_<SOURCE>` (plain-text or JSON). |
| `sitemap`    | Parses vendor sitemaps where they exist (Lever, Ashby, Workable, Greenhouse). |
| `apify`      | Optional — runs ATS actors (`jobo.world/greenhouse-jobs-search`, `jobo.world/lever-jobs-search`) when `APIFY_TOKEN` is set, extracts unique company slugs from the results. |

Real-world numbers after one run on this box:

| Source     | Validated live boards |
|------------|-----------------------|
| Greenhouse | 211 |
| Lever      | 50  |
| Ashby      | 146 |
| **Total**  | **407** |

Adding `APIFY_TOKEN` and a few `GITHUB_SLUG_URLS_*` entries pushes this into the
thousands (the Apify actor `automation-lab/greenhouse-jobs-scraper` claims
220,000+ Greenhouse tenants; `vnx0/lever-ats-job-scraper` covers 5,000+ Lever
tenants).

### Platforms intentionally **not** scraped

| Platform     | Reason |
|--------------|--------|
| LinkedIn     | ToS §8.2 forbids automated scraping; gated behind auth + anti-bot (*hiQ v. LinkedIn* limits do not grant scraping rights against ToS). |
| Indeed       | ToS forbids scraping. Use **Adzuna** — licensed aggregator that covers Indeed-class inventory. |
| Glassdoor    | ToS forbids scraping; heavy anti-bot. |
| ZipRecruiter | ToS forbids scraping. |
| Dice         | Anti-bot / ToS. |
| Monster      | Anti-bot / ToS. |
| CareerBuilder| ToS. |
| SimplyHired  | Owned by Indeed — same restrictions. |
| Built In     | ToS; consider their partner API. |
| Wellfound (AngelList) | Requires auth. |
| Workday / iCIMS / BambooHR | Per-tenant; we include only tenants that expose a public board. |

You can add a Workday/iCIMS/BambooHR connector by writing a new `BaseSourceScraper`
subclass; we deliberately omitted them in this release because they're
per-tenant and often restrict anonymous access.

---

## 4. Setup

```bash
# 1. clone & enter
git clone <this-repo>.git scraper
cd scraper

# 2. clone JobPulse for the expanded company lists
git clone --depth 1 https://github.com/itsmeBlackOps/JobPulse.git external/JobPulse

# 3. create a virtualenv
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# 4. install deps
pip install -r requirements.txt

# 5. (optional) playwright — only needed if you add a JS-rendered source later
playwright install chromium

# 6. copy env template and fill in keys
cp .env.example .env
#    USAJOBS / Adzuna keys are optional but expand coverage.

# 7. initialize database (idempotent)
python scripts/init_db.py

# 8. (optional but recommended) discover & validate company slugs
python scripts/discover_companies.py
#    writes data/companies/<source>.txt for each source.
#    add APIFY_TOKEN in .env first if you want the Apify strategies on.
```

---

## 5. Usage

```bash
# Default run — targets 100 unique fresh jobs, all sources, 24h filter.
python run_daily.py

# Restrict to specific sources
python run_daily.py --source greenhouse lever ashby

# Pump the target
python run_daily.py --target 250

# Serialize for deterministic debugging
python run_daily.py --parallel 1

# Skip the 24h filter (debug only)
python run_daily.py --no-recency
```

Artifacts after a run:

- `data/jobs.db` — SQLite (or your Postgres)
- `data/raw/…` — raw payloads in `jobs_raw` table
- `data/exports/jobs_top_<date>.csv` — **ranked top-100**
- `data/exports/jobs_top_<date>.json` — same in JSON
- `data/exports/jobs_all-unique_<date>.{csv,json}` — full unique set
- `data/reports/report_<date>.json` — daily summary
- `logs/scraper.log` — structured JSON logs

---

## 6. Scheduling daily

### Linux / macOS (cron)

```cron
# run at 08:00 local daily
0 8 * * * cd /path/to/scraper && /path/to/scraper/.venv/bin/python run_daily.py >> logs/cron.log 2>&1
```

### Windows (Task Scheduler)

- Program/script: `C:\path\to\scraper\.venv\Scripts\python.exe`
- Arguments: `run_daily.py`
- Start in: `C:\path\to\scraper`
- Trigger: Daily @ 08:00

### Docker / Kubernetes

Wrap `run_daily.py` in a `CronJob` or `docker run --rm` invocation mounted to a
persistent data volume.

---

## 7. Database schema

Generated by SQLAlchemy at startup. The equivalent raw DDL lives in
[`scripts/schema.sql`](scripts/schema.sql):

- `jobs_raw`    — append-only raw payloads (audit trail)
- `jobs_clean`  — canonical de-duplicated postings
- `scrape_runs` — per-run summary (counts, failures, duplicates, stale)

---

## 8. Adding a new source

1. Create `src/sources/myboard.py`:

   ```python
   from src.base import BaseSourceScraper
   from src.models import JobPosting

   class MyBoardScraper(BaseSourceScraper):
       name = "myboard"
       display_name = "My Board"
       compliance_notes = "Link to the public API docs you're using."

       def fetch_listings(self):
           resp = self.http.get("https://api.myboard.example/jobs")
           for job in (resp.json() if resp else []):
               yield job

       def parse_listing(self, raw):
           return JobPosting(
               job_title=raw["title"],
               company_name=raw["company"],
               source_platform=self.name,
               source_url=raw["url"],
               # …populate the rest…
           )
   ```

2. Register it in `src/sources/registry.py`.

That's it — normalization / dedup / recency / export / reporting are all handled
for you.

---

## 9. Engineering notes

- **Retries**: `tenacity` exponential backoff (+ `httpx.HTTPTransport(retries=1)`
  for connection errors). Configurable via `.env`.
- **Politeness**: per-host throttle (750 ms min interval), rotating realistic
  user-agents, respects `Retry-After`.
- **Resilience**: per-source try/except — one bad source never breaks the run.
  Failures are recorded in `scrape_runs.failed_sources`.
- **Playwright** is installed but not used by default; reach for it only when a
  target *requires* JS rendering.
- **Audit**: every raw record is persisted in `jobs_raw` before parsing.

---

## 10. Scaling to 1,000 jobs/day

| Lever                                                            | Effect |
|-------------------------------------------------------------------|--------|
| Run `python scripts/discover_companies.py` — instant +400 boards | large  |
| Set `APIFY_TOKEN` → Apify discovery unlocks 220k+ Greenhouse / 5k+ Lever tenants | huge   |
| Add public GitHub lists via `GITHUB_SLUG_URLS_*`                 | linear |
| Add **Adzuna** + **USAJOBS** API keys                             | +200/d |
| Implement Workday / iCIMS / BambooHR per-tenant adapters          | large  |
| Scrape **Built In** RSS (US cities) as a new connector            | medium |
| Switch storage to Postgres; deploy the runner as an hourly CronJob| scale  |
| Put `run_daily.py` behind a task queue (RQ, Celery, Temporal) per-source | parallelism |
| Cache ETag / Last-Modified per source (Greenhouse + Ashby honor them) | bandwidth |
| Add a weekly back-fill from jobs_raw for late-arriving timestamps | coverage |
| Rotate egress IPs via respectful proxy pool (only where ToS allows) | reliability |

---

## 11. Testing

```bash
pytest -q
```

Covers: title matching, US location detection, remote-type inference,
seniority inference, relative-time parsing, 24h recency filter, canonical
and soft-match deduplication.

---

## 12. Legal / compliance

This project **only** uses official public APIs, documented JSON feeds, and
opt-in developer endpoints. It explicitly refuses to:

- bypass CAPTCHAs,
- impersonate authenticated users,
- defeat anti-bot protections,
- or scrape sources whose ToS forbids it (LinkedIn, Indeed direct, Glassdoor,
  ZipRecruiter, Dice, Monster).

When in doubt, remove a source and use a licensed aggregator (e.g. Adzuna)
that has the rights to redistribute that inventory.
