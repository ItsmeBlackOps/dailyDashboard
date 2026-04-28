# US IT Job Discovery System — Decision Report

**Scope:** senior-scraping-engineer review of the ingestion stack, decision
on build-vs-adopt, and a concrete rollout of discovery-driven ATS coverage.
**Horizon:** US IT hiring (software engineering, data, ML, DevOps/SRE/cloud,
security, QA, IT infra) across ~22 ATS platforms and the generic
schema.org JSON-LD long tail.
**Date:** 2026-04-18.

---

## A. Current-system audit (before this pass)

| Surface | State |
|---|---|
| Source connectors | 10: Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Workday, iCIMS, Adzuna, USAJobs, RemoteOK (now **24** after this pass) |
| Discovery strategies | 6: seed lists, JobPulse mirror, GitHub crawl, HN sitemap expansion, Apify, validator |
| Data model | Strong — `JobPosting` with `requisition_id`, `canonical_key`, `soft_key`, `content_hash`, `remote_type`, `experience_{min,max,level}` |
| Dedupe | Multi-signal cascade: `requisition_key > canonical_key > content_hash > soft_key`; `REPOST` vs `UPDATED` vs `DUPLICATE` classification |
| Storage | SQLite with forward-migrating ALTERs; `jobs_clean` + append-only `jobs_history`; `mark_removed(dormant_days=3)` sweep |
| Filter mode | **Previously** narrow data-analyst only; **now** `JOB_FILTER_MODE=it` default with ~100-keyword IT taxonomy |
| Observability | Structured per-source logs (`source.complete`, `http.retry_exhausted`, `crawl.hit`) |

**Verdict:** the foundation (data model + classifier + storage + discovery
orchestrator) is ~80 % of what the spec demands. The missing pieces were:
ATS platform *detection* (not just connectors), a universal JSON-LD
fallback for custom sites, and coverage for the other 13 ATS platforms on
the 22-platform master list.

## B. Build-vs-adopt decision

| Candidate repo | License | Coverage | Verdict |
|---|---|---|---|
| `adgramigna/job-board-scraper` | MIT | Greenhouse + Lever + Ashby + Rippling | Needs Postgres + S3 + Airtable; scraping modules are salvageable but the full stack doesn't fit us |
| `stapply-ai/ats-scrapers` | Claimed MIT; inactive | Greenhouse + Lever + Ashby + Workable | Maintenance unverified; would fork, not depend on |
| `viktor-shcherb/job-seek` | CC0 | JSON-LD extractor + URL normalization helpers | **Borrow selectively** — CC0 lets us copy `jsonld.py`/`url.py` without strings attached |
| `Feashliaa/job-board-aggregator` | MIT | BambooHR connector + seed company JSON files | **Borrow selectively** — use the per-ATS company seed JSONs + BambooHR connector |
| `chuchro3/WebCrawler` | Apache-2.0 | Workday-specific reference | Reference only; our `_parse_workday_posted` is already stronger |
| `apify/rag-web-browser` | commercial | Universal | Paid fallback for WAF'd tenants only |

**Decision: BUILD, borrowing selectively.** Specifically:
- Our data model (`requisition_id`, `soft_key`, `content_hash`,
  `experience_{min,max,level}`) is already richer than any adopt-candidate.
- Our classifier handles the six-way REPOST/UPDATED/DUPLICATE/CROSS_DUP/
  UNCERTAIN/NEW decision that none of the GitHub projects replicate.
- Selective borrows (documented inline where applied): schema.org JSON-LD
  patterns informed `src/discovery/generic_extractor.py`; the BambooHR
  seed format informs our tenant-naming for `*_SEED` lists.

## C. Discovery-driven architecture (delivered)

```
                                 ┌────────────────────────┐
                                 │   seed_lists.py (L1)   │  ← hand-curated
                                 ├────────────────────────┤
                                 │   JobPulse mirror (L2) │  ← external
                                 ├────────────────────────┤
                                 │   github crawl (L3)    │  ← aggregator READMEs
                                 ├────────────────────────┤
                                 │   HN sitemap (L3)      │  ← 300+ threads
                                 ├────────────────────────┤
                                 │   apify (L4, opt-in)   │  ← WAF fallback
                                 └────────────┬───────────┘
                                              │ union → validator.py
                                              ▼
                            ┌──────────────────────────────────┐
                            │     orchestrator.discover()      │
                            │   data/companies/<source>.txt    │
                            └─────────────────┬────────────────┘
                                              │
                                              ▼
   domain  ───►  discovery/detect.py  ───►  platform, slug, confidence
                        │
                        │   (confidence == 0, has_jsonld)
                        └──────►  discovery/generic_extractor.py
                                       │
                                       └──►  JobPosting

   slug   ───►  sources/<platform>.py  ───►  JobPosting
                                              │
                                              ▼
             normalizer.post_filter()  →  storage.ingest()  →  classifier
```

**Two new primitives** added in this pass:

1. `src/discovery/detect.py` — ATS-fingerprint detector. Returns
   `DetectionResult(platform, slug, confidence∈{-1,0,1,2,3})`.
   Confidence ladder: URL-match (3) > script-embed (2) > weak DOM (1) >
   JSON-LD only (0) > nothing (-1). Consumers route to the matching
   connector at confidence ≥ 1, to the generic extractor at 0, and log
   `-1` for investigation.
2. `src/discovery/generic_extractor.py` — schema.org JSON-LD extractor.
   Defensive against every shape observed in the wild (@graph wrappers,
   list `@type`, HTML-entity-encoded blobs, `identifier` as string vs
   `{value:…}`, multi-element `jobLocation`). Produces fully-normalized
   `JobPosting`s that flow through the same `post_filter` pipeline as
   platform connectors.

## D. New ATS connectors (delivered)

### D.1 Phase 1 — five public-API connectors

| Connector | Endpoint | Auth | Stable IDs | Freshness |
|---|---|---|---|---|
| `src/sources/recruitee.py` | `GET {co}.recruitee.com/api/offers/` | none | `id` | `published_at`, `updated_at` |
| `src/sources/personio.py` | `GET {co}.jobs.personio.{com,de}/xml` | none | `id` (→ `requisition_id`) | `createdAt` |
| `src/sources/jobvite.py` | `GET jobs.jobvite.com/{slug}/feed/jobs` (+ legacy `app.jobvite.com/CompanyJobs/Xml.aspx`) | none | `id`, `requisitionId` | `datePosted` |
| `src/sources/jazzhr.py` | `GET {co}.applytojob.com/apply/jobs/feed` | none | `id`, `board_code` (→ `requisition_id`) | `original_open_date` |
| `src/sources/eightfold.py` | `GET {tenant}.eightfold.ai/careers/api/jobs?domain={tenant}` (paginated) | none (Referer sometimes required) | `id`, **`ats_job_id`** (cross-ATS goldmine) | `posted_on`, `last_modified` |

**Why these five first (out of the 22 named):**
- **Recruitee + Personio + JazzHR** — documented public JSON/XML APIs, zero
  bot gating observed from cloud egress, good SMB + mid-market coverage.
- **Jobvite** — public feed, covers many high-profile US employers that
  neither Greenhouse nor Lever reach (Capital One alumni, Thumbtack, etc.).
- **Eightfold** — strategic: it's a *layer* over Workday/SuccessFactors for
  many Fortune 500s. Its `ats_job_id` field gives us cross-ATS dedupe we
  can't get anywhere else.

### D.2 Phase 2 — SPA + JSON-LD + enterprise-XML connectors (this pass)

| Connector | Endpoint | Auth | Extraction path | Stable IDs |
|---|---|---|---|---|
| `src/sources/rippling.py` | `GET ats.rippling.com/{slug}/jobs` | none | `<script id="__NEXT_DATA__">` → `props.pageProps` walk | `id` (→ `source_job_id`) |
| `src/sources/teamtailor.py` | `GET {slug}.teamtailor.com/jobs` | none | schema.org JSON-LD on index; detail-follow if index bare | JSON-LD `identifier.value` → `requisition_id` |
| `src/sources/custom_jsonld.py` | operator-supplied URL list (CSV env) | none | JSON-LD in-page or follow `index:URL` same-host detail anchors | JSON-LD `identifier` |
| `src/sources/successfactors.py` | `GET career{N}.successfactors.com/career?company={co}&...&resultType=XML` | none (SAP KBA 2428902) | Shard-probe (1..10) + XML parse, tolerant of tag-name variance across tenants | `jobReqId` (→ both `source_job_id` and `requisition_id`) |
| `src/sources/bamboohr.py` | `GET {co}.bamboohr.com/careers/list` (+ `.json` alias) | none | JSON, tolerant of 3 wrapper shapes (`[...]` / `{result:[]}` / `{result:{jobs:[]}}`); status filter drops Filled/Closed | `id` (→ `source_job_id`) |
| `src/sources/paylocity.py` | `GET recruiting.paylocity.com/recruiting/JobsApi/JobList?companyId={UUID}` | none | JSON, tolerant of `{Data:[]}`/`{Jobs:[]}`/list-root shapes; lowercase-key drift handled via `_first` synonym lookup; multi-location list flattening | `JobId` (→ both `source_job_id` and `requisition_id`) |
| `src/sources/ukg.py` | `POST recruiting{N}.ultipro.com/{TENANT}/JobBoard/{UUID}/SearchJobs/` body `{opportunitySearch:{Top,Skip,OrderBy,Filters}}` | none | JSON, paginated via `Skip`, tolerant of `opportunities` / `Opportunities` / `jobs` / nested `data.opportunities` shapes; composite `TENANT/UUID` slug (optionally prefixed with `SHARD|` for shard-2/3 tenants); `PrimaryLocation.Name` + `Address` sub-dict + string fallback; `IsRemote` flag + location-substring remote inference | `Id` (→ both `source_job_id` and `requisition_id`) |
| `src/sources/oracle_rc.py` | `GET {host}.fa.{region}.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber={site},limit=100,offset=N,sortBy=POSTING_DATES_DESC` | none | JSON, paginated via `offset` until `hasMore=false` or short page; tolerant of `items` / `Items` / `requisitionList` / bare-list / outer-shell `items[0].requisitionList` wrappers; 3-part composite `host/region/site` slug; `PrimaryLocation` string-or-dict + `secondaryLocations` list merge; `WorkplaceType` + location-substring remote inference; `ExternalURL` (when present) overrides synthesized apply URL | `Id` / `RequisitionNumber` (→ both `source_job_id` and `requisition_id`) |
| `src/sources/dayforce.py` | `GET {tenant-or-shard}.dayforcehcm.com/CandidatePortal/en-US/{tenant}/Posting/Search` + per-posting `GET .../Posting/View/{id}` | none (implicit session cookie via shared `HttpClient`) | schema.org JSON-LD extraction, two sources: the landing search page (many tenants pre-render a per-job JSON-LD blob for Google Jobs) **and** each detail page (all tenants ship JSON-LD there per Dayforce's Google-for-Jobs integration guide). Walks `href` anchors to build the `Posting/View/{id}` URL list (capped at `_MAX_POSTINGS_PER_TENANT=500`). Slug format: bare `acme` (own-subdomain tenant, older customers) or `SHARD:tenant` / `SHARD/tenant` (shared-shard tenants like `us58:mycompany`, `us61/acme`). | JSON-LD `identifier` (→ `requisition_id`) |

**Rippling** was previously on the deferred list for "no freshness
metadata." Resolved by (a) walking the `__NEXT_DATA__` blob with a
heuristic `_walk_jobs()` (any list of dicts containing title-ish + id-ish
keys), which is resilient to Next.js version churn; and (b) relying on
`content_hash` for edit detection — the same fallback Lever uses.

**Teamtailor** was previously deferred for "requires auth." Resolved by
using the generic schema.org JSON-LD extractor on the public index page —
the same surface Google Jobs consumes. If the index is bare (some
tenants lazy-load), the connector follows detail anchors and extracts
per-job.

**CustomJsonLd** is a *first-class pipeline source*, not just a library.
Two modes:
- **Direct URL mode:** `CUSTOM_JSONLD_URLS=https://careers.acme.com/job/123,...`
  — per-job detail pages, extracted in place.
- **Index-follow mode:** prefix with `index:` — fetch the index, follow
  same-host anchors that contain detail-like substrings (`/jobs/`,
  `/position/`, `jobId=`, …), extract JSON-LD per detail page.
  Bounded by `max_per_index` (default 25) so a huge career index
  doesn't blow up a run.

This is the long-tail capture: Meta (`metacareers.com`), Google
(`careers.google.com`), Microsoft, etc. — all ship JobPosting JSON-LD
because Google Jobs requires it, and none of them live on a standard
ATS.

**SuccessFactors** was previously deferred for "per-tenant URL variance."
Resolved by (a) accepting explicit shard pins via `N:company` syntax,
or probing shards 1..10 for bare entries; and (b) a tag-synonym
fallback (`jobTitle` | `title` | `name`; `jobReqId` | `reqId` | `jobId`;
etc.) so the parser survives the observed tenant-to-tenant schema drift
on the KBA-2428902 XML feed. SF is critical coverage because it's the
ATS underneath a huge chunk of Fortune-500 HR (banks, industrials,
retailers, airlines) that don't show up on Greenhouse/Lever/Ashby.

**BambooHR** was previously deferred for "no public JSON; HTML scrape
fragile." Resolved by discovering the undocumented
`/careers/list` JSON endpoint that BambooHR's own careers-page widget
consumes client-side — no HTML scraping needed. Response shape varies
by tenant vintage (`[...]` flat list / `{result:[...]}` / nested
`{result:{jobs:[...]}}`); the connector's `_iter_jobs` dispatches all
three plus a `{jobs:[...]}` variant. Apply URLs are synthesized
(`{co}.bamboohr.com/careers/{id}`) since the feed omits them. BambooHR
skews to mid-market US SMBs — a different cohort than SF (enterprise)
or Greenhouse (tech startups), so it fills a real coverage gap.

**Paylocity** was previously deferred for "per-tenant UUID discovery
painful." Resolved in two pieces: (a) the tenant UUID isn't guessable
but the employer-discovery loop already extracts it from the
`recruiting.paylocity.com/Recruiting/Jobs/All/{UUID}` iframe embed on
career pages (see `detect.py:53`) — so operators don't need to hand-curate
UUIDs, the discovery pass auto-fills `data/companies/paylocity.txt`; (b)
the JSON endpoint at
`recruiting.paylocity.com/recruiting/JobsApi/JobList?companyId={UUID}` is
the same one the careers widget consumes, so parsing is
`_iter_jobs`-tolerant across the `{Data:[]}`/`{Jobs:[]}`/list-root
variants we've seen. Paylocity covers thousands of US mid-market
employers (construction, healthcare, retail) that don't run on any ATS
above — real coverage gap filled.

**UKG (UltiPro Recruiting)** was previously deferred for
"tenant+UUID double-lookup + session cookies." Resolved in three
pieces: (a) the detector's URL regex captures both path segments
(`([a-zA-Z0-9]+)/JobBoard/([0-9a-fA-F\-]+)`) and `detect_from_url` now
composes the pair into a single ``TENANT/UUID`` slug — the first
multi-group composite slug in the project, making the detector contract
extensible to any future ATS with multi-part tenant paths; (b) the
POST endpoint at `/{TENANT}/JobBoard/{UUID}/SearchJobs/` requires no
session cookie — it's the same request the careers widget fires on
every page load, with a plain JSON body
(`{"opportunitySearch":{"Top":100,"Skip":0,...}}`) and a `Referer`
matching the JobBoard URL; (c) pagination is handled via `Skip`
increments against the response's `totalCount`, with a
`_PAGE_SIZE=100` + `_MAX_PAGES=50` safety cap, so a misbehaving tenant
can't loop forever. The connector also supports a shard prefix
(`2|TENANT/UUID`) for the minority of tenants on `recruiting2` /
`recruiting3`. UKG sits under a meaningful slice of US employers in
healthcare, government contractors, and industrials that don't show
up on Greenhouse/Lever/Ashby.

**Oracle Recruiting Cloud (Fusion HCM)** was previously deferred for
"partial WAF + tenant identity is a 3-part host/region/site triple."
Resolved in three pieces: (a) the detector's URL regex was extended to
a second multi-group composite (`(host)(region)(site)` → joined
`host/region/site`); the ``_URL_PATTERNS`` `tuple[int, …]` contract
added for UKG now handles any N-part tenant identity — Oracle is the
first 3-group consumer and the pattern is extensible. A second
bare-host fallback pattern catches URLs that landed on the Oracle
domain before the CandidateExperience path resolves, so we still emit
a confidence-3 ATS hit for routing. (b) The public
`hcmRestApi/resources/latest/recruitingCEJobRequisitions` endpoint,
called with `onlyData=true&finder=findReqs;siteNumber={site},limit=100,
offset=N,sortBy=POSTING_DATES_DESC`, is the same one the candidate
experience widget fires — no auth required for External Candidate
sites. The finder expression is an Oracle-specific
semicolon-separated DSL; our connector composes it verbatim. (c)
Pagination terminates on `hasMore=false`, on any short page
(`len(items) < _PAGE_SIZE`), or at the `_MAX_PAGES=50` ceiling. The
crawler-side regex was widened to the same 3-group composite so
employer-discovery auto-fills ``data/companies/oracle_rc.txt`` when a
customer links to their Oracle careers portal in an HN thread or
SimplifyJobs README. The WAF partial-block from some cloud egress IPs
still applies (it's IP-based, not endpoint-based) — operators should
probe from a residential or known-search-engine range if they hit
widespread 403s; graceful degradation means a WAF-blocked tenant just
emits zero jobs, same as an iCIMS block. Oracle RC is the ATS
underneath a Fortune-500 heavy cohort (telecom, energy, aerospace,
government-adjacent) that Greenhouse/Lever don't reach.

**Dayforce (Ceridian)** was previously deferred for "per-tenant session
cookie required pre-search." Resolved in three pieces: (a) the
persistent `requests.Session` inside our shared `HttpClient` already
carries Set-Cookie headers from one GET to the next — so fetching the
`Posting/Search` landing page first (which is the same handshake the
candidate-portal widget performs on page load) implicitly populates any
required session cookie before the `Posting/View/{id}` detail fetches
hit. No explicit CSRF or cookie plumbing required. (b) Dayforce
publishes schema.org `JobPosting` JSON-LD on both landing pages (where
many tenants pre-render per-job summaries for Google Jobs) and detail
pages (universally, per Dayforce's Google-for-Jobs integration guide) —
so the connector is a thin wrapper around the existing
`generic_extractor.extract_from_html`, collecting hits from both
surfaces. (c) The Dayforce URL landscape has two families:
own-subdomain tenants (`{tenant}.dayforcehcm.com/CandidatePortal/...`,
older/larger customers) and shared-shard tenants
(`{shard}.dayforcehcm.com/CandidatePortal/en-US/{tenant}/...`, newer
customers on `us58`, `us61`, etc.). The connector accepts bare tenant
slugs (`acme` → own-subdomain default) or a shard-pinned form
(`us58:mycompany` in env / `us58/mycompany` from detect.py's
two-group composite pattern — both separators are accepted). The
detector emits three URL patterns in priority order: own-subdomain
with a `\1` backreference (emits the bare tenant), shared-shard
(emits composite `shard/tenant`), and the legacy `jobs.dayforcehcm.com/{tenant}`
aggregate host. The crawler-side regex uses the same backreference
trick to pin own-subdomain tenants only — shared-shard tenants
aren't usually referenced in public aggregators (SimplifyJobs,
HN threads) so those flow in via env var or the employer-domain
discovery pipeline's direct URL crawl.

**Still deferred (docs/ATS_FINGERPRINTS.md):** Taleo (legacy, Oracle
TOS), Phenom (heavy bot protection), Wellfound. The CustomJsonLd
connector catches most of these as a fallback when the employer ships
JSON-LD.

## E. Config + registry wiring

- `config.py` — added **eight** settings fields: `recruitee_companies`,
  `personio_companies`, `jobvite_companies`, `jazzhr_companies`,
  `eightfold_tenants`, `rippling_companies`, `teamtailor_companies`,
  `custom_jsonld_urls`. Each reads an env var (e.g. `TEAMTAILOR_COMPANIES`
  or `CUSTOM_JSONLD_URLS`) as CSV.
- `src/discovery/seed_lists.py` — added **seven** `*_SEED` tuples
  (RECRUITEE, PERSONIO, JOBVITE, JAZZHR, EIGHTFOLD, RIPPLING, TEAMTAILOR)
  and registered them in the `SEEDS` dict so the orchestrator picks them
  up automatically.
- `src/discovery/validator.py` — added per-source probe URLs (including
  `ats.rippling.com/{slug}/jobs` and `{slug}.teamtailor.com/jobs`) so
  discovered slugs get liveness-checked before they land in
  `data/companies/<source>.txt`.
- `src/discovery/crawl.py` — added regex patterns for
  `*.recruitee.com`, `*.jobs.personio.{de,com}`, `jobs.jobvite.com/X`,
  `*.applytojob.com`, `*.eightfold.ai`, `ats.rippling.com/X`,
  `*.teamtailor.com` so the HN/GitHub aggregator crawl emits slugs for
  all new connectors automatically.
- `src/sources/registry.py` — new connectors instantiated in `all_scrapers()`
  and registered in `REGISTRY`. The registry also merges
  `data/companies/custom_jsonld.txt` (lines are URLs, not slugs) into
  `CustomJsonLdScraper`'s input, closing the loop with
  `src/discovery/employers.py`. Final count: **24 connectors** (was 15).

### E.1 Employer-domain discovery loop — `src/discovery/employers.py`

Closes the feedback cycle the previous pass left open. Given a seed of
US employer domains (defaults to ~50 household-name companies; extendable
via `EMPLOYER_DOMAINS` env CSV), the module:

1. Calls `detect.detect_domain()` per domain, threaded up to
   `concurrency=8` with a shared `HttpClient` (per-host throttling
   preserved — distinct hosts go parallel, same-host serialize).
2. Collects results into an `EmployerDiscoveryReport` with three
   buckets: known-platform slugs, custom-JSON-LD URLs (detector
   confidence 0), and unknown domains (confidence −1).
3. `persist_report()` writes:
   - `data/companies/<platform>.txt` — slugs the registry already
     consumes per ATS source. Union-merges with existing file so
     repeated passes accumulate rather than overwrite.
   - `data/companies/custom_jsonld.txt` — URLs fed to
     `CustomJsonLdScraper` on the next run.
   - `data/companies/unknown_domains.txt` — operator-review queue.

This is the "any way possible, fully automated" piece: an operator
drops domains into the seed (or the env var), a single invocation of
`discover_from_domains(...)` followed by `persist_report(...)` turns
those domains into per-ATS slug files — and the *next* pipeline run
scrapes them automatically through the existing 24 connectors. No
hand-wiring per employer.

### E.2 Discovery CLI coverage parity (ship-blocker fix)

`scripts/discover_companies.py` exposes the orchestrator to operators
via argparse. Its `SUPPORTED` tuple historically listed only the five
original sources (`greenhouse`, `lever`, `ashby`, `smartrecruiters`,
`workable`). As new connectors were shipped through Phase 1 + Phase 2,
that tuple never got updated — argparse `choices=SUPPORTED` silently
rejected `--source workday`, `--source dayforce`, etc., leaving
`data/companies/<newsource>.txt` empty on every run.

Observed symptom: the daily pipeline ran all 24 connectors, but only
the 5 originals yielded any listings because only they had populated
slug files. The other 19 connectors spun up, found zero targets,
returned zero listings, and burned no HTTP quota — a silent coverage
gap.

Fix: `SUPPORTED` now covers all twenty slug-consuming connectors
(everything with a seed tuple in `seed_lists.SEEDS`). API-aggregator
connectors (`adzuna`, `usajobs`, `remoteok`) and the URL-driven
`custom_jsonld` connector are intentionally absent — `discover()` is
a no-op for them. `tests/test_discover_cli.py` pins the invariant
**`SUPPORTED == SEEDS.keys()`** and additionally asserts that every
slug-based `REGISTRY` entry surfaces in `SUPPORTED`. Any future
connector addition that forgets to update the CLI now fails a test.

### E.3 Validator probe-URL coverage parity

Related ship-blocker found during the first operator-facing discovery
run against the newly-unlocked sources: `src/discovery/validator.py`
had no `_probe()` case for **workday** or **icims**. Both sources fell
through to the final `return "GET", "", None` — an empty URL which
`validate()` treats as an unreachable probe, dropping the slug as
`keep_on_error=False`. The effect was indistinguishable from "all
seeded slugs are dead": the 15-entry Workday seed dropped to 0 live
tenants, and the iCIMS file persisted empty.

Fix: added Workday and iCIMS probes with strict input validation —
* **Workday**: accepts the seed's canonical `tenant:wdN:site` triple,
  rejects anything with a different colon count, empty parts, a
  non-`wd\d+` cluster identifier, or a tenant/site that isn't
  alphanumeric + `_-`. Probe URL: the public career-site landing page
  `https://{tenant}.wd{N}.myworkdayjobs.com/en-US/{site}` (200
  confirms tenant + cluster + site are all live).
* **iCIMS**: accepts `{subdomain}` (alphanumeric + `_-`) and probes
  `https://careers-{subdomain}.icims.com/jobs`. Known to 403 from many
  cloud egress IPs (the WAF is geo/network-gated) — that's the correct
  behavior: if the operator's egress can't fetch the landing page, the
  daily scrape from the same egress won't either, so dropping the
  tenant at discovery time avoids wasting calls at run time.

`tests/test_validator.py` (35 tests) pins these with a parametric
invariant: **every source in `seed_lists.SEEDS` produces a non-empty
probe URL for a well-formed slug**. Adding a new connector without
wiring a probe now fails the test — the exact drift that produced the
Workday/iCIMS zero-yield silently for months.

### E.4 First operator-facing discovery run (post-fix yields)

After the E.2 + E.3 fixes, a `python scripts/discover_companies.py`
pass for the previously-uncovered sources populated
`data/companies/*.txt` with the following live-validated yields:

| Source | Live slugs | Primary feeder |
|---|---|---|
| greenhouse | 968 | seed + crawl |
| ashby | 628 | seed + sitemap |
| lever | 572 | seed + crawl |
| workable | 494 | seed + crawl |
| smartrecruiters | 237 | seed + crawl |
| bamboohr | 209 | crawl |
| jazzhr | 203 | crawl |
| oracle_rc | 187 | crawl (host/region/site) |
| personio | 80 | crawl + seed |
| rippling | 80 | crawl + seed |
| recruitee | 34 | crawl + seed |
| jobvite | 29 | crawl + seed |
| ukg | 19 | crawl (tenant/uuid) |
| teamtailor | 18 | crawl + seed |
| workday | 15 | seed (E.3 fix) |
| successfactors | 15 | seed |
| paylocity | 2 | crawl |
| eightfold | 1 | seed |
| icims | 0 | *(empty — no crawl hits; requires employer-discovery)* |
| dayforce | 0 | *(empty — no crawl hits; requires employer-discovery)* |

**Total: 3,791 live-validated slugs across 18 sources** (was 2,899
across 5 sources before this pass). The three still-empty files
(`icims`, `dayforce`, `custom_jsonld`) correspond to sources whose
tenant IDs aren't guessable from seeds and don't surface on public
aggregators — the **employer-domain discovery loop** (E.1,
`src/discovery/employers.py`) is the populate path for those, and it
runs as an opt-in orchestrator strategy rather than part of the
default CLI invocation.

### E.5 Ingest NOT NULL crash — Oracle RC `company_name=None`

**Symptom.** After the E.2/E.3/E.4 passes unblocked Oracle RC as a
live source, the first full daily run crashed at ingest time:

```
sqlite3.IntegrityError: NOT NULL constraint failed: jobs_clean.company_name
parameters: ('…', '…', 'Cloud - Integrated Services Technical Program Manager',
             None, '…', 'Dearborn, MI, United States', …, 'oracle_rc',
             'https://efds.fa.em5.oraclecloud.com/.../job/59646', …)
```

55 minutes of scraping across 24 sources — 164K raw listings fetched,
143 unique jobs classified — were lost to a rollback when the
transaction aborted on the first Oracle RC record's insert.

**Root cause — two interacting bugs.**

1. `src/sources/oracle_rc.py::parse_listing` set `company_name=None`
   unconditionally, with the explanatory comment *"Oracle RC feed
   doesn't carry the employer name."* Oracle's Fusion HCM
   `hcmRestApi` requisition payload genuinely doesn't ship the
   employer name — but emitting `None` for a field that
   `jobs_clean.company_name` declares `nullable=False` is an ingest
   bomb waiting to go off. It only stayed silent for months because
   no one had wired Oracle RC slugs into the daily run before E.4.
2. `src/storage.py::ingest` had no defensive filter. One bad
   `JobPosting` in a batch of tens of thousands raised an
   `IntegrityError` inside `with self.engine.begin():`, rolling back
   every good row in the same transaction and propagating the
   exception out of `run_daily.py`. A single connector bug → whole-run
   data loss.

**Fix (two layers, defence in depth).**

*Layer A — Oracle RC parser.* `_derive_company_name(host, site)`
synthesizes a deterministic company_name from the composite slug:

```python
def _derive_company_name(host: str, site: str) -> Optional[str]:
    # 1. Prefer site if descriptive (alnum, ≥4 chars, not a generic code)
    # 2. Fall back to host (short but stable pod identifier)
    # 3. None only when neither yields anything — storage guard drops
    if site and site.lower() not in _GENERIC_SITE_CODES and len(site) >= 4:
        return _prettify(site)           # e.g. FordCareersSite → "Ford Careers Site"
    if host:
        return _prettify(host)           # e.g. efds → "Efds"
    return None
```

The generic-code blocklist (`cx`, `ext`, `external`, `candidate`,
`careers`, `site`, …) catches the Oracle convention of putting the
brand in `host` when the site is a bare candidate-experience shell.
Prettification inserts spaces at camelCase boundaries and normalizes
separators so the DB is eyeball-readable.

*Layer B — storage guard.* `ingest()` now filters records missing
any `nullable=False` field the connector is expected to populate:

```python
_REQUIRED_FIELDS = ("job_title", "company_name", "source_platform", "source_url")

def _missing_required_fields(j: JobPosting) -> list[str]:
    # None / empty / whitespace-only all count as missing.
    ...

# In ingest():
for j in jobs:
    missing = _missing_required_fields(j)
    if missing:
        log.warning("ingest.drop_missing_fields", source=j.source_platform,
                    title=j.job_title[:80], missing=missing)
        continue
    # …classify + insert…
```

Pre-guard: one bad row aborts the transaction, rolls back the batch,
terminates the run. Post-guard: one bad row is logged and skipped;
the next 143 good rows commit normally. A future connector that
regresses a required field gets flagged in logs without costing the
run.

**Pinned by tests.**

- `tests/test_storage_ingest.py` — 5 new tests covering null /
  empty / whitespace company_name, null title, null source_url, and
  mid-batch poisoning (the scenario where the bad row was between
  good ones and previously blocked their inserts).
- `tests/test_oracle_rc.py` — 5 new tests on
  `_derive_company_name`'s precedence (site-over-host when
  descriptive, host fallback for generic sites, determinism across
  calls, non-empty output for the Oracle slug shape, graceful
  handling of all-empty slug parts). Verified against the exact
  production-crash slug `efds/em5/CX` → `"Efds"` — no crash,
  classified NEW, one row committed.

### E.6 Oracle RC `_GENERIC_SITE_CODES` — numeric-tenant-suffix bypass

**Symptom.** After E.5 unblocked Oracle RC as a live source,
`data/reports/jobs_last_24h_20260418.csv` surfaced 22 rows
(~29 % of today's fresh Oracle RC postings) with
`company_name = "Cx 1001"`, `"Cx 1"`, or similar
`Cx <digits>` strings. The worst offender was the actual Ford
Dearborn engineering board (`efds/em5/CX_1`, "Cloud - Integrated
Services Technical Program Manager") — a real employer silently
relabelled as "Cx 1" in the DB.

**Root cause.** Oracle Fusion tenants serve their Candidate
Experience shell under site slugs of the form
`CX_1001` / `cx1001` / `CX_42` — the generic `cx` identifier
stamped with a numeric tenant id. E.5's `_derive_company_name`
rejected the bare `cx` slug via the exact-equality check
`s.lower() not in _GENERIC_SITE_CODES` but let every suffixed
variant through. `_prettify` then emitted "Cx 1001" (etc.) as
the company name, clobbering the discriminating host pod that
would have surfaced the real employer (`"Efds"` for Ford).

**Fix.** In `src/sources/oracle_rc.py`, a pre-test
normalization strips a trailing `[_-]?\d+$` from the site slug
*only for the blocklist comparison* — `_prettify` still sees
the original slug, so descriptive-with-digits sites like
`FordCareers2024` survive intact:

```python
_TENANT_SUFFIX_RE = re.compile(r"[_-]?\d+$")

def _derive_company_name(host: str, site: str) -> Optional[str]:
    s = (site or "").strip()
    h = (host or "").strip()
    s_norm = _TENANT_SUFFIX_RE.sub("", s).lower() if s else ""
    if s and s_norm not in _GENERIC_SITE_CODES and len(s) >= 4:
        return _prettify(s)            # descriptive site wins
    if h:
        return _prettify(h)            # host pod fallback
    return "Unknown (Oracle RC)"
```

This lands `cx_1001` → normalized `cx` → blocklist hit → host
fallback (`"Efds"`), while `FordCareers2024` → normalized
`fordcareers` → not in blocklist → prettified from the
original (`"Ford Careers2024"`).

**Pinned by tests.** `tests/test_oracle_rc.py` grew by 3 cases:

- `test_parse_listing_strips_trailing_digits_from_generic_site`
  — `efds/em5/CX_1001` must surface the host, not `"Cx 1001"`.
- `test_parse_listing_strips_bare_numeric_suffix_from_generic_site`
  — same invariant for the underscore-less `cx1001` form.
- `test_parse_listing_preserves_meaningful_non_cx_site_with_digits`
  — `efds/em5/FordCareers2024` must preserve both the brand
  (`"ford"`) and the trailing year (`"2024"`), so the fix
  doesn't corrupt sites whose digits carry meaning.

**DB backfill.** `scripts/backfill_oracle_company_name.py` is
a one-shot repair script for historical rows: selects every
`jobs_clean` row where `source_platform='oracle_rc'` and
`company_name LIKE 'Cx %'`, parses `(host, region, site)`
back out of `source_url`, re-derives `company_name` via the
fixed helper, prints a before/after diff, and prompts before
issuing UPDATEs. Safe to run alongside a live scrape
(WAL mode assumed); surfaces `database is locked` as a hint
to retry after the run.

### E.7 `jobs_raw` bloat — 8 GB SQLite, 1530× duplication

**Symptom.** `data/jobs.db` had grown to **8.23 GB** in a single
day. `jobs_raw` held **1,000,788 rows** totalling 7.46 GB of payload,
all timestamped 2026-04-18, against only **654 unique clean jobs**
in `jobs_clean` — a raw:clean ratio of **~1,530×**. Breakdown:

| source | rows | payload |
|---|---:|---:|
| smartrecruiters | 390,718 | 654 MB |
| greenhouse | 352,966 | 4.24 GB |
| ashby | 86,803 | 1.20 GB |
| lever | 87,045 | 1.20 GB |
| oracle_rc | 57,361 | 85 MB |
| (others) | <25k | ~80 MB |

**Root cause — two compounding bugs.**

1. **No retention policy.** `jobs_raw` was declared as a plain
   append-only audit table — schema was
   `(id, source_platform, payload TEXT, scrape_timestamp_utc)` with
   no pruning anywhere in the pipeline. Forensic blobs accumulated
   forever.
2. **No write-time dedupe.** `Storage.save_raw` just bulk-inserted
   every record handed to it. A single scrape that re-fetched the
   same greenhouse board hundreds of times in a day wrote the same
   ~12 KB JSON payload hundreds of times — even when
   `jobs_clean.content_hash` on the parsed version showed it was
   byte-identical to what was already stored.

With frequent re-scraping across 20+ sources, the table multiplied
against itself. Nothing in `src/` actually reads from `jobs_raw`
(grep confirms the only callers are `save_raw` on the write side
and the retention test fixtures) — it's purely forensic — so the
bloat was silently ballooning with zero downstream benefit.

**Retention model chosen.** Hybrid — hash-deduped write + TTL prune:

* **Per-source hash dedupe at write time.** Identical payloads for
  the same source write once, ever. Scoped per source so two ATSs
  that happen to emit byte-identical JSON don't collapse into each
  other (provenance matters). Hash is
  `sha256("{source}\x00{payload_json}")`.
* **14-day TTL, configurable.** `RAW_TTL_DAYS` (default 14).
  `Storage.prune_raw(ttl_days=N)` deletes rows where
  `scrape_timestamp_utc < now - N days`. Runs at the end of every
  daily pipeline, after ingest, before summary. `RAW_TTL_DAYS=0`
  disables pruning.

The alternatives (keep-latest-N-per-canonical-key, unbounded
append) were rejected: the audit table has no downstream consumers,
so spending storage on extra history buys nothing, and the TTL is
simpler to reason about than "keep 3 snapshots per canonical_key".

**Schema change.** `jobs_raw` gained a nullable
`payload_hash VARCHAR(64)` column plus a
`UNIQUE INDEX uq_jobs_raw_src_hash (source_platform, payload_hash)`.
Nullable because existing rows land with NULL until the compaction
script backfills them; the UNIQUE constraint treats NULLs as
distinct, so legacy rows don't mass-collide with each other before
the backfill runs. Applied via the existing `_apply_migrations`
helper so pre-existing databases upgrade in place.

**Code change (write-time dedupe).**

```python
# src/storage.py — Storage.save_raw (excerpt)
for r in records:
    payload_json = json.dumps(r, default=str, ensure_ascii=False)
    h = hashlib.sha256(f"{source}\x00{payload_json}".encode()).hexdigest()
    if h in seen_in_batch:        # intra-batch collapse
        continue
    seen_in_batch.add(h)
    candidates.append({"source_platform": source, "payload": payload_json,
                       "payload_hash": h, "scrape_timestamp_utc": now})

# filter out hashes already present in DB for this source
existing = {set of hashes already in jobs_raw for this source}
to_insert = [c for c in candidates if c["payload_hash"] not in existing]
conn.execute(insert(jobs_raw), to_insert)
return len(to_insert)        # caller can log dedupe rate
```

**Code change (TTL prune).**

```python
# src/storage.py
def prune_raw(self, *, ttl_days: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=ttl_days)
    with self.engine.begin() as conn:
        result = conn.execute(
            delete(jobs_raw).where(jobs_raw.c.scrape_timestamp_utc < cutoff)
        )
        return int(result.rowcount or 0)

# run_daily.py (post-ingest, pre-summary)
if settings.raw_ttl_days > 0:
    pruned = storage.prune_raw(ttl_days=settings.raw_ttl_days)
    if pruned:
        log.info("pipeline.raw_pruned", rows=pruned,
                 ttl_days=settings.raw_ttl_days)
```

**Recovery of already-bloated DBs.**
`scripts/compact_jobs_db.py` is a one-shot cleanup for databases
that grew before the fix landed. Flow:

1. Dry-run by default — prints current rows, projected stale deletes
   (aged past TTL), projected duplicate deletes.
2. `--apply` takes a `jobs.db.bak-YYYYMMDD-HHMMSS` copy before
   touching anything.
3. Adds the `payload_hash` column if missing (legacy schema).
4. Backfills `payload_hash` on all NULL rows using the exact same
   `sha256("{source}\x00{payload}")` formula as `save_raw` — so
   legacy rows collide correctly against each other and future
   writes.
5. Collapses duplicates by deleting all but `MIN(id)` per
   `(source_platform, payload_hash)` group. `payload_hash IS NOT NULL`
   guard on both sides of the `DELETE … WHERE id NOT IN (SELECT MIN …)`
   so un-hashed rows (should be zero post-backfill) aren't touched.
6. TTL delete (`--ttl-days 14` default).
7. Creates the `UNIQUE INDEX` so future duplicates are rejected at
   write time even if dedupe-on-write regressed.
8. `VACUUM` to reclaim disk (SQLite does not shrink the file from
   `DELETE` alone).

Invariants: never touches `jobs_clean` / `jobs_history` /
`scrape_runs`; dry-run leaves the DB unmodified; `--apply` always
takes a backup unless `--no-backup` is passed explicitly.

**Pinned by tests.**

- `tests/test_storage_raw_retention.py` (10 tests) —
  write-time dedupe: same payload twice → 1 row; different payloads
  → both kept; same payload across two sources → both kept
  (provenance preserved); intra-batch duplicates collapsed;
  return-value equals rows actually written (not inputs).
  Prune: rows older than TTL deleted; boundary behaviour strict;
  `jobs_clean` untouched; idempotent on repeated runs; empty-table
  returns zero.
- `tests/test_compact_jobs_db.py` (12 tests) — `_backfill_hashes`
  matches the storage formula exactly and is idempotent;
  `_collapse_duplicates` keeps oldest per `(source, hash)`, does not
  cross sources, skips NULL-hash rows (safety rail), preserves
  distinct hashes, `dry_run=True` projects counts without mutating;
  `_apply_ttl` deletes past the cutoff, honours dry-run, leaves
  `jobs_clean` untouched; `_count_duplicate_groups` reports
  `(extras, groups)` for the dry-run projection.

**Operational.** `python scripts/compact_jobs_db.py` shows the
projection; `python scripts/compact_jobs_db.py --apply` performs
it. The ongoing prune is invisible in the happy path — a log line
`pipeline.raw_pruned rows=N ttl_days=14` appears on runs that
actually trim anything.

### E.8 Aggregator debug pass — `adzuna`, `usajobs`, `remoteok`

**Context.** 19 of 24 registered ATS connectors were producing zero rows
in `jobs_clean`. The three US job-board aggregators are the
highest-leverage of those 19 because they index many employers behind a
single API, so debugging them first gives the biggest volume unlock.
Each was audited end-to-end: env-var wiring, live request-shape against
current API docs, parser round-trip on a realistic payload, and
downstream survival through `post_filter`.

**Per-source root cause.**

| Source     | Live `run()` result        | Root cause                              | Remediation              |
|------------|----------------------------|-----------------------------------------|--------------------------|
| `adzuna`   | `parsed=0 raw=0` (skipped) | Missing `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` in `.env` | Operator action          |
| `usajobs`  | `parsed=0 raw=0` (skipped) | Missing `USAJOBS_API_KEY` + `USAJOBS_USER_AGENT` in `.env` | Operator action          |
| `remoteok` | `parsed=95 raw=95`         | Fetch + parse work; only 3 survive `post_filter` (16 IT titles dropped by `looks_us`) | Sibling task (filter)    |

The adzuna and usajobs connectors log
`adzuna.skipped reason='missing credentials'` and
`usajobs.skipped reason='missing API key or User-Agent'` respectively
when their env vars are empty — the skip path is graceful, not a
silent error. The `.env.example` documents the required names
(`USAJOBS_API_KEY`, not `USAJOBS_AUTH_KEY`; the `Authorization-Key`
header carries the value but the env var name is `_API_KEY`).

**Operator setup.** Copy `.env.example` → `.env` and fill:

- `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` — register at https://developer.adzuna.com/
  (free tier ~250 calls/month; adequate for a daily run)
- `USAJOBS_API_KEY` + `USAJOBS_USER_AGENT` — register at
  https://developer.usajobs.gov/APIRequest/. The User-Agent must be an
  email address (USAJobs contract) — set it to your ops inbox.

RemoteOK needs no credentials — it uses the public feed and respects
our rotating UA from `HttpClient`.

**Why pin happy-path tests even when credential-blocked.** A credential
fix without a test pinning the request-shape means the next upstream
API bump silently zero-rows us again — we'd re-debug the same thing
six months from now. Each of the three connectors is pinned against a
stub `HttpClient` so a param rename (`what_phrase` → `keyword`), an
auth-header rename (`Authorization-Key` → `X-API-Key`), or a feed-shape
change (RemoteOK's first-element legend disappearing) fails loudly in
CI instead.

**Pinned by tests.** `tests/test_aggregators.py` (22 tests) —

- *Adzuna* (7 tests): skip-when-no-creds; `app_id`/`app_key`/
  `what_phrase`/`where`/`max_days_old`/`results_per_page` in outgoing
  params; happy-path parse (title, company, location, salary range,
  redirect URL, created date); predicted-salary suffix `(est.)`;
  titleless-raw rejection; short-page pagination stop; non-200 break.
- *USAJobs* (5 tests): skip-when-no-creds; `Authorization-Key` /
  `Host` / `User-Agent` headers plus `Keyword` / `LocationName` /
  `DatePosted` / `ResultsPerPage` params; happy-path parse
  (`MatchedObjectDescriptor` → `JobPosting`, including `ApplyURI` list
  → first element, `MatchedObjectId` as stable `source_job_id`,
  `PositionRemuneration` → salary); titleless rejection; short-page
  pagination stop.
- *RemoteOK* (9 tests): legend-element skip (first `[0]` of the JSON
  array); happy-path parse (`position`/`title` fallback, slug as
  `requisition_id`, `url`/`apply_url` precedence, ISO-8601 `date`);
  epoch-int fallback when `date` missing; region-filter gate
  (Europe-only + non-remote location → drop; worldwide region → keep);
  titleless rejection; empty feed; non-200 break.
- *Registry* (1 test): all three classes present in `REGISTRY`.

Teeth verified by controlled mutation during authoring — renaming
Adzuna's `what_phrase` → `keyword`, USAJobs' `Authorization-Key` →
`X-API-Key`, and RemoteOK's `data[1:]` → `data` each make the relevant
test fail; reverting each restores green.

**Before / after.** Per-connector raw count on a fresh
`python run_daily.py --source adzuna usajobs remoteok --parallel 1`
run with `.env` unset (as shipped; no operator creds yet):

```
adzuna   : 0 → 0   (blocked on creds; operator action)
usajobs  : 0 → 0   (blocked on creds; operator action)
remoteok : 95 → 95 (working — parser emits 95 rows; 3 survive post_filter)
```

RemoteOK's 95→3 gap through `post_filter` is **downstream** of the
connector (title-filter + `looks_us`) and is out of scope for this
pass — it's the focus of a sibling task.

### E.9 Recency was an ingest gate, not a query filter — backlog invisible

**Symptom.** `jobs_clean` held only today's fresh posts (654 rows, 632
of them posted inside the last 24 h — a 96 % freshness ratio that
should be impossible for a weekly cron on an active market). Every
downstream consumer — the daily export, the "top N" ranker, the
operator dashboard — saw the same thin slice. Still-open requisitions
older than 24 h were **invisible**: not in the export, not in the
backlog counts, not queryable. Any attempt to rerun tomorrow was
doomed to re-fetch yesterday's jobs from source and re-insert them
under a fresh `first_seen_at`.

**Root cause.** `run_daily.main` applied the `settings.recency_hours`
filter **before** calling `storage.ingest`:

```python
# pre-E.9
fresh = [j for j in unique if is_within_hours(j.date_posted_normalized, 24)]
storage.ingest(fresh)
```

Conceptually seductive — "we only want recent jobs, drop the rest" —
but catastrophically wrong for persistence. The DB is the system of
record for *every open req we've ever seen from a source*; the 24 h
window is a **view** over that record, not a filter on what gets
recorded. The old code confused the two, so the DB tracked
"job-board freshness" instead of "open requisitions". An open Senior
Data Engineer posted 5 days ago — still live, still hiring — never
made it past the filter, because it was posted >24 h before the
current cron tick.

The bug was one line. It was superficially reasonable. And it silently
drained the DB of its own domain — which is why E.9 exists as a pinned
regression test, not just a patch.

**Fix — recency becomes a query-time slice.**

1. **`storage.ingest` accepts every record** (subject only to the E.5
   required-fields guard). `date_posted_normalized` is stored as-is,
   including `None` for sources that don't expose a parseable date.
2. **`Storage.fetch_open_jobs`** (new) returns the current backlog —
   `SELECT * FROM jobs_clean WHERE removed_at IS NULL` — as
   `JobPosting` instances. Re-stamps naive UTC datetimes to aware so
   comparisons with `is_within_hours` don't explode under SQLite.
3. **`rank_top(..., recency_hours=…)`** gains a query-time filter. When
   set, rows whose `date_posted_normalized` is older than the cutoff
   (*including rows where it is `None`* — can't prove freshness) are
   dropped *before* ranking. `run_daily.py` passes
   `settings.recency_hours` by default and `None` when `--no-recency`
   is supplied, so the CLI flag semantics are preserved.
4. **`run_daily.main`** reads the full backlog back out via
   `fetch_open_jobs`, hands it to `rank_top` for the 24 h slice, exports
   the sliced set as `jobs_top_*.{csv,json}`, and dumps the full
   backlog as `jobs_all-unique_*.{csv,json}` for ops.
5. **Report** (`src/report.py`) replaces the old "Discarded (stale)"
   line with `Backlog (open)` + `Posted in last 24h`. Operators now
   see *both* numbers — the long-horizon system state and the
   short-window recency slice — instead of a misleading "discarded"
   tally that implied the dropped rows were garbage.

**Explicit decision — rows with null `date_posted_normalized`.** Many
sources don't expose a parseable posted-date (Rippling's
`__NEXT_DATA__`, some BambooHR tenants, aggregator feeds with
free-text dates). The decision is pinned in tests:

- **Keep in DB.** An open req without a provable post-date is still an
  open req. Dropping it would silently delete thousands of legitimate
  rows from sources that aren't date-rich.
- **Exclude from the default 24 h export.** We can't prove freshness,
  so the ranked top-N treats undated as out-of-window by design.
- **Include under `--no-recency`.** The ops escape hatch surfaces
  everything, undated included — use when debugging coverage.

**Why pin with tests.** The regression risk is exactly one line. The
pre-ingest filter is *superficially reasonable* — a code reviewer
reading the diff cold would not necessarily reject reintroducing it.
Without tests, a future "cleanup" PR ("why are we storing stale data?")
would re-drain the DB and re-disappear the backlog. The pins below
make that PR fail CI.

**Pinned by tests** — 22 total across four files:

- *`tests/test_storage_ingest.py`* (+3 tests) — contract tests for
  the ingest layer: `test_ingest_keeps_stale_job` (5-day-old row
  lands in `jobs_clean`), `test_ingest_keeps_job_with_null_date_posted`
  (`None` post-date still persists), `test_ingest_accepts_mixed_age_batch`
  (fresh+stale+undated in one call — all three land).
- *`tests/test_exporter.py`* (8 tests, new file) — pins `rank_top`'s
  new `recency_hours` kwarg: drops stale under `recency_hours=24`,
  keeps everything under `recency_hours=None`, drops null-date rows
  from the 24 h slice, keeps them under `None`, preserves
  freshness-first sort and `limit` with both modes, and backwards-
  compatible default (no filter when kwarg omitted).
- *`tests/test_pipeline_recency.py`* (8 tests, new file) — wires
  `ingest` + `fetch_open_jobs` + `rank_top` together end-to-end:
  backlog returns all ingested ages, round-trip yields `JobPosting`
  instances with `date_posted_normalized` and the null variant
  preserved, `removed_at IS NOT NULL` rows excluded, full-pipeline
  integration with `recency_hours=24` / `None` / undated-segregation.
- *`tests/test_run_daily.py`* (3 tests, new file) — end-to-end over
  `run_daily.main()` with a stubbed registry, a tmp_path sandbox, and
  a file-backed SQLite: default run keeps stale/undated in DB but
  excludes them from `jobs_top_*`; `--no-recency` surfaces the
  backlog in the top export.

Teeth verified by controlled mutation: re-introducing the pre-ingest
filter in `run_daily.py` fails three of the run_daily integration
tests and the ingest contract tests simultaneously. Dropping the
`recency_hours` kwarg from `rank_top` fails the exporter and
pipeline tests. Dropping the `_aware()` re-stamp in `_row_to_posting`
fails the preservation tests with a naive/aware comparison error.
Each mutation is caught cleanly.

**Before / after.** Single-source fresh `python run_daily.py
--source greenhouse --parallel 1 --no-sweep` against the same DB:

```
                        before E.9   after E.9
jobs_clean (open)           654        657  (full backlog retained)
posted in last 24h          632         60  (true 24 h slice, not ingest gate)
posted in last 7d           n/a        370  (backlog now observable)
```

The "before" column is the pre-fix baseline the user reported: 96 %
of rows apparently posted in the last 24 h because the ingest gate
was silently dropping everything older. The "after" column is the
same DB 24 h later with the fix in place — the "last 24 h" slice
shrinks to a realistic number (60) while the backlog (657) retains
still-open reqs from prior scrape days. `last 7d` goes from
"unmeasurable because data wasn't stored" to 370, which is now
actually a queryable operator metric.

### E.10 Opaque-tenant ATS seeds — employer-domain audit yields nothing

**Premise.** `src/discovery/seed_lists.py` ships four ATS connectors with
empty `SEEDS` entries: `oracle_rc`, `dayforce`, `ukg`, `paylocity`. The
in-file comments point at `data/companies/<source>.txt` as the populate
path, and the registry's `_merged_targets` already unions
`data/companies/` with env + JobPulse + `seed_lists`. The question this
pass answers: does the `detect_domain` → `discover_from_domains` →
`persist_report` loop realistically yield tenant IDs for these four
when pointed at a broad US-employer seed, or is manual curation the only
reliable path?

**Method.**

1. Extended `data/seeds/us_employers.txt` from ~60 hand-picked tech-
   heavy domains (the `DEFAULT_EMPLOYER_DOMAINS` tuple) to **464 unique
   domains** covering Fortune 500 + YC-backed public cos + retail / mid-
   market / professional services / healthcare / defense / logistics —
   i.e. the populations these four connectors are supposed to cover.
2. Ran the full detection pass over all 464 domains (via a checkpointed
   runner — `src.tools.audit_discovery` was killed externally on the
   first attempt, so the replacement saves JSON every 25 completions
   and shares the same `AuditReport` schema). Wall-clock: **3592 s**
   (~60 min) at concurrency=6 with a 12 s per-request HTTP budget.
3. Merged the resulting `EmployerDiscoveryReport` into
   `data/companies/*.txt` via `src.discovery.employers.persist_report`
   (merge=True — unions with existing slugs, never nukes).

**Yield (464 domains).**

| platform        | detected | confidence ≥2 |
| --------------- | -------- | ------------- |
| oracle_rc       | **0**    | 0             |
| dayforce        | **0**    | 0             |
| ukg             | **0**    | 0             |
| paylocity       | **0**    | 0             |
| icims           | 8        | 8             |
| ashby           | 1        | 1             |
| greenhouse      | 2        | 2             |
| lever           | 2        | 2             |
| smartrecruiters | 1        | 1             |
| workable        | 2        | 2             |
| workday         | 1        | 1             |
| custom_jsonld   | 1        | —             |
| unknown (-1)    | 365      | —             |
| errors          | 0        | —             |

Confidence histogram: `-1: 365, 0: 1, 1: 81, 2: 13, 3: 4`.

**Finding.** The four opaque-tenant connectors detected **zero** new
tenants. The 81 weak signals (confidence=1) are DOM/meta hints that
the detector does not promote to a usable slug, and the 365 unknowns
are dominated by Fortune 500 employer sites whose careers pages are
either (a) SPA-routed with the ATS iframe mounted post-load, (b) gated
behind a regional splash / WAF that returns 403 or a 200 with no ATS
fingerprint, or (c) hosted on a subdomain (`careers.<employer>.com`)
not reachable from the root-domain probe paths. This is consistent with
how these four platforms are deployed in the wild — Oracle Recruiting
Cloud, Dayforce, UKG Pro, and Paylocity are enterprise-mode products
whose tenant IDs are rarely exposed on a static HTML careers page.

**Side benefit (17 new slugs across 7 other platforms).** The same
audit added:

```
icims           0 -> 8   (amd, chickfila, githubinc, mheducation,
                          quest, rivian, ulta, waters)
ashby         604 -> 605
greenhouse    967 -> 969
lever         572 -> 574
smartrecruiters 231 -> 232
workable      493 -> 495
workday        15 -> 16
custom_jsonld   0 -> 1
```

Registry merge means the next daily run picks these up with no further
action.

**Wire-back decision: Option A (keep `seed_lists.py` empty).**

The four `SEEDS` entries stay as the empty tuples they ship as today.
Rationale:

- Empirically, broad employer-domain discovery does not yield tenants
  for these four platforms. There is nothing to bake in.
- The existing code comments in `seed_lists.py` already point operators
  at `data/companies/<source>.txt` as the populate path — exactly the
  pattern `ICIMS_SEED = ()` uses and the registry already consumes.
- Env var overrides (`ORACLE_RC_COMPANIES` et al.) and
  `data/companies/` continue to be the curation surfaces, which is
  what the discovery-system architecture (section C) prescribes.
- No new test is added: the "non-empty seeds" assertion Option B would
  require would lock in discoveries that don't exist, and the existing
  `test_discover_cli.py` invariant (`SUPPORTED == SEEDS.keys()`) is
  already sufficient to stop someone from silently dropping a connector.

**Smoke scrape (SQLite fallback — Aiven Postgres DNS was unreachable at
the time of this run; flagged, not fixed per ground rules).**

```
python run_daily.py --source oracle_rc ukg dayforce paylocity \
    --parallel 1 --no-sweep
```

| source    | slugs | jobs_clean before | after | delta |
| --------- | ----- | ----------------- | ----- | ----- |
| oracle_rc | 187   | 483               | 876   | +393  |
| ukg       | 19    | 0                 | 0     |  0    |
| paylocity | 2     | 0                 | 0     |  0    |
| dayforce  | 0     | 0                 | 0     |  0    |

Pipeline still green end-to-end: oracle_rc fetched 14 338 raw
requisitions → 470 unique after post-filter/dedupe → 393 new + 77
in-batch duplicates classified. UKG / Paylocity yielded 0 parsed
because their tenants return empty payloads for the US-IT title filter
on this particular slug set. Dayforce is a no-op when the slug list is
empty (the `DayforceScraper` is still instantiated; its `run()` just
returns `parsed=0 raw=0` — no warnings, no failure).

**Artifacts.**

- `data/seeds/us_employers.txt` (464 unique domains, 21 sections,
  1 commented seed file — see header)
- `data/reports/discovery_audit_2026-04-19T00-18-27.{json,md}`
- `data/companies/icims.txt` (8 new slugs),
  `ashby.txt` / `greenhouse.txt` / `lever.txt` / `smartrecruiters.txt` /
  `workable.txt` / `workday.txt` / `custom_jsonld.txt` (+1–2 each),
  `unknown_domains.txt` (audit review queue)
- `scripts/_run_discovery_checkpointed.py` +
  `scripts/_merge_audit_to_companies.py` — temp helpers for this pass;
  safe to delete once the pattern is proven (the canonical path is
  still `src.tools.audit_discovery` + `employers.persist_report`).

**Flagged (not fixed this pass):**

- `DATABASE_URL_POSTGRE` points at `support-harshp-c41f.f.aivencloud.com`
  which no longer resolves in DNS (deprovisioned tenant?). The smoke
  scrape ran against the local `data/jobs.db` SQLite via
  `DATABASE_URL=sqlite:///./data/jobs.db` override. Per the original
  ground rules, the rollback-journal SQLite lock path is also left
  alone.

## F. US IT filter (default on)

`JOB_FILTER_MODE=it` is the new default in `config.Settings`. It enables a
broad US-IT taxonomy (~100 keywords) spanning software engineering, data,
ML, DevOps/SRE/cloud, security, QA, and IT infra, paired with a
deliberate exclusion list (leadership, sales-engineering, finance-analyst
adjacency, academic roles). `JOB_FILTER_MODE=narrow` preserves the
original data-analyst-only profile for backwards compat.

## G. Observability

Every new connector logs `source.complete` with parsed/raw counts, plus
per-company `company.miss` / `tenant.miss` at `INFO` (never `WARNING`) so
expected empty tenants don't drown out genuine errors. This mirrors the
iCIMS hardening from the previous pass — graceful degradation, quiet
logs, failures surfaced at the run-summary level instead of per-call.

## H. Testing

**Baseline (pre-discovery-pass):** 61 tests.
**Previous pass:** 130 tests, 100 % pass.
**This pass:** **563 tests**, 100 % pass (+433). (E.5 added 10, E.6 added 3, E.7 added 22 — 10 in `test_storage_raw_retention.py` + 12 in `test_compact_jobs_db.py`; E.8 added 22 in `test_aggregators.py`; E.9 added 22 — 8 in `test_exporter.py`, 8 in `test_pipeline_recency.py`, 3 in `test_run_daily.py`, 3 in `test_storage_ingest.py`.)

New test files (Phase 1, previous pass):
- `tests/test_detect.py` — 32 tests; parametric URL-pattern coverage of
  all 22 ATS platforms, HTML-embed signal detection, JSON-LD presence
  heuristic, stub-HttpClient round-trip for `detect_domain`.
- `tests/test_generic_extractor.py` — 16 tests; malformed blobs, @graph
  wrappers, list `@type`, HTML-entity-encoded JSON, string-vs-dict
  hiringOrganization, string-vs-dict identifier, employmentType as list,
  TELECOMMUTE detection, multi-`jobLocation`, missing-required rejection.
- `tests/test_new_connectors.py` — 17 tests; per-connector parse paths,
  pagination (Eightfold), XML parsing (Personio, Jobvite legacy),
  bare-list vs `{jobs:[…]}` (JazzHR), HTML-interstitial rejection
  (Personio WAF), registry-wiring smoke test.

New test files (Phase 2, this pass):
- `tests/test_rippling.py` — 12 tests; `__NEXT_DATA__` extractor (happy,
  missing, malformed), `_walk_jobs` heuristic (flat list, nested
  `board.jobs`, non-job list rejection, empty blob), `parse_listing`
  (dict `workLocation`, dict `department`, dict `employmentType`,
  string-location fallback, missing-title rejection), fetch_listings
  end-to-end with stub HTTP.
- `tests/test_teamtailor_custom.py` — 10 tests spanning both
  Teamtailor (index JSON-LD, follow-detail-when-index-bare, missing
  tenant, detail URL dedupe+cap) and CustomJsonLd (direct mode,
  index-follow mode with cross-host rejection, index-also-extracts-if-
  jsonld-present, skip-if-no-jsonld, `_extract_detail_urls` same-host
  only including relative hrefs, `_pretty_hint` host→company name).
- `tests/test_employers.py` — 22 tests; `EmployerDiscoveryReport`
  per-bucket add + summary, `discover_from_domains` (dispatching,
  case-insensitive input dedupe, exception swallowing,
  owned-vs-borrowed HttpClient close semantics), `persist_report`
  (per-platform files, custom_jsonld+unknown buckets, union-merge with
  existing files, empty-bucket skip), internal helpers
  (`_merge_existing`, `_unique_sorted`), `default_domains_from_env`
  with/without env CSV, and cached-report behaviour
  (`get_or_run_report` single-run, `reset_cache` forces re-run,
  `slugs_for_source` reads cached buckets).
- `tests/test_orchestrator.py` — 4 tests; employer strategy is
  opt-in-only by default, enables via `use_employers=True`, discovered
  slugs persist to `data/companies/<source>.txt`, and a raising
  strategy doesn't sink the full run.
- `tests/test_bamboohr.py` — 30 tests; fetch over bare URL and
  `.json` alias, HTML-interstitial + malformed-JSON rejection,
  missing-tenant log-miss, parse happy path (full location tuple),
  status filter (Filled dropped, no-status kept), remote detection
  (both `locationType=="remote"` and `isRemote` flag), synonym title
  keys, `_iter_jobs` coverage of all 4 wrapper shapes including junk
  rejection, `_location` (dict + string + None + country-dedupe),
  `_name_or_string` dict/label/string/None, `_truthy` true/false
  values.
- `tests/test_paylocity.py` — 35 tests; fetch happy path + 404 + HTML
  interstitial + malformed JSON + missing tenant, parse happy path
  (full location + country inference), remote inferred from location
  string or explicit `WorkplaceType`, lowercase-key drift, multi-loc
  list flattening, dict-location, missing-title rejection,
  missing-JobId skips apply URL, `_iter_jobs` all 4 wrapper shapes
  plus junk rejection, `_normalize_location` (string-with-USA, dict
  full/lowercase/country-only, list-multi, None, empty), remote
  normalizer (explicit remote/hybrid/onsite tokens + location-string
  fallback + no-signal), `_first` first-nonempty + non-string
  preservation.
- `tests/test_audit_discovery.py` — 26 tests covering the new
  `src/tools/audit_discovery.py` operator harness: `load_domains`
  (CSV-only, file with `#` comments, env, case-insensitive dedup,
  union across sources, all-empty, missing file), `audit_domains`
  (empty input, outcome collection via stubbed detector, dedup + sort,
  per-domain exception swallowing, outcomes sorted by domain),
  `AuditReport.finalize` (bucket building from outcomes, errors
  excluded from platform/confidence buckets), `to_json` roundtrip,
  `render_markdown` (empty report fallback, full-section coverage
  with 50 % platform-recognition computation, error section,
  `_confidence_label` unknown-passthrough), `write_report` (both
  JSON + MD files created, auto-timestamp when none supplied), and
  `main()` (exit 2 on empty input, happy-path CSV arg, file input,
  env input — all via monkeypatched detector to avoid real HTTP).
- `tests/test_ukg.py` — 52 tests covering the composite-slug UKG
  scraper: `_split_slug` (plain `TENANT/UUID`, shard-prefix
  `SHARD|TENANT/UUID`, empty, missing separator, whitespace trim,
  non-string), fetch pagination (happy-path, exact POST-body shape,
  multi-page `Skip` advancement until `totalCount` reached, early
  termination on short page, HTML-interstitial + malformed-JSON +
  non-200 rejection, malformed-slug skip, shard-prefix host swap to
  `recruiting2.ultipro.com`), parse (happy-path apply-URL synthesis,
  missing-title rejection, missing-Id apply-URL skip, remote from
  `IsRemote` flag / explicit `WorkType` / location-substring
  fallback, lowercase-key synonym support, boolean `FullTime`
  coerced to "Full Time"), `_iter_jobs` (six wrapper shapes:
  `opportunities` / `Opportunities` / `jobs` / nested
  `data.opportunities` / bare list / unknown; non-dict items
  skipped), `_normalize_location` (dict `{Name}` + `{Name,Country}` +
  `{Address: {City, StateProvince, Country}}` + bare city/state,
  string with USA trailing token, multi-location list, None, empty
  string), `_normalize_remote` (explicit remote/hybrid/onsite
  tokens, `IsRemote=True`, location-substring fallback, no-signal),
  `_coerce_employment` (string / True / False / None / whitespace),
  `_first` (first-nonempty, all-empty, non-string preservation).
- Two additional cases appended to `tests/test_detect.py` —
  composite-slug URL matching for UKG (`recruiting.ultipro.com` and
  the `recruiting2` shard variant) — pinning the new multi-group
  composition behaviour of `detect_from_url`.
- `tests/test_oracle_rc.py` — 52 tests covering the 3-part composite
  `host/region/site` Oracle RC connector: `_split_slug` (plain,
  whitespace trim, empty, 2-part malformed, 4-part malformed,
  non-string, double-slash rejected), fetch pagination (happy-path,
  GET URL + `onlyData=true`/`finder=findReqs;...`/`expand=secondaryLocations`
  params, multi-page `offset` advancement until `hasMore=false`,
  early stop on `hasMore=false`, early stop on short page, HTML-
  interstitial + malformed-JSON + non-200 rejection, malformed-slug
  skip, `Referer` header matching ``/sites/{site}/jobs``), parse
  (happy-path apply-URL synthesis, missing-title rejection,
  missing-Id apply-URL skip, `ExternalURL` overrides synthesized,
  `secondaryLocations` list merge with primary, remote from
  `WorkplaceType` / location-substring, lowercase-key synonyms,
  `RequisitionNumber` apply-URL fallback when `Id` absent),
  `_iter_jobs` (seven wrapper shapes: `items` / `Items` /
  `requisitionList` / outer-shell ``items[0].requisitionList`` /
  bare list / bare list with outer-shell first element / unknown;
  non-dict items skipped), `_normalize_location` (plain string,
  string without country token, dict with `Name`, primary +
  secondary list merge, secondary-only, secondary string entries,
  cap-at-3-secondaries, None, empty string), `_normalize_remote`
  (explicit remote/hybrid/onsite tokens, location-substring
  fallback, ``Virtual`` token, no-signal), `_first`
  (first-nonempty, all-empty, non-string preservation).
- `tests/test_crawl.py` — 13 tests covering ``src/discovery/crawl.py``'s
  ``_extract``: single-group patterns still emit bare slugs (Greenhouse
  plain + embed form, Lever, Paylocity UUID); UKG's 2-group pattern
  emits composite ``TENANT/UUID`` (with shard-host variant,
  multi-tenant dedup, and a regression case ensuring a URL missing
  the ``/JobBoard/`` segment does not match); Oracle RC's 3-group
  pattern emits composite ``host/region/site`` (with multi-region
  coverage and a negative case requiring the CandidateExperience
  path); `_BAD_SLUGS` still filters noise tokens like ``embed``;
  unknown-source lookups are a no-op.
- Three additional cases appended to `tests/test_detect.py` — Oracle
  RC 3-group composite slug (``host/region/site`` with and without the
  trailing ``/jobs`` suffix) plus the bare-host fallback pattern for
  URLs missing the CandidateExperience path.
- `tests/test_dayforce.py` — 38 tests covering the Dayforce connector:
  `_split_slug` (bare tenant, `SHARD:tenant` colon form, `SHARD/tenant`
  slash form from detect.py, whitespace trim, empty/None, empty-tenant
  malformed, long-shard malformed, uppercase-shard malformed,
  double-colon malformed, `my_tenant` underscore accepted),
  `_landing_url` (own-subdomain + shared-shard + varied shards ca2/eu1),
  `_extract_posting_urls` (relative href resolution, absolute href,
  dedup, `max_items` cap, absolute URLs in `<script>` blobs, cross-shard
  absolute accepted because session cookie carries on the parent domain,
  foreign-domain rejection, empty input),
  `_pretty_hint` (basic capitalization, hyphen→space, underscore→space,
  empty→None), `DayforceScraper.fetch_listings` (landing JSON-LD extraction,
  detail-anchor walk when landing JSON-LD absent, combined landing + detail
  hits, missing-tenant skip, non-200 skip, malformed-slug skip without
  HTTP call, shard-pinned host swap, `max_per_tenant` cap enforcement),
  `parse_listing` (`company_careers_url` stamp for own-subdomain,
  `company_careers_url` stamp for shard-pinned, `dayforce.{slug,shard,
  tenant,via}` provenance, raw-dict merge preserves existing entries,
  None-jp guard), plus a landing-before-detail ordering test that pins
  the implicit session-cookie handshake (landing fetched first,
  detail URLs strictly after).
- One additional case appended to `tests/test_detect.py` — the
  `apollomed.dayforcehcm.com/CandidatePortal/en-US/apollomed/` URL
  matches the new own-subdomain backreference pattern and emits the
  bare tenant; the shared-shard URL emits the composite form.
- **E.5 crash-fix coverage (+10 tests)** —
  `tests/test_storage_ingest.py` grew by 5 cases pinning the new
  pre-ingest guard: null / empty / whitespace company_name, null
  job_title, null source_url, and a mid-batch-poisoning case that
  pre-fix would have rolled back good inserts alongside the bad one.
  `tests/test_oracle_rc.py` grew by 5 cases pinning the
  `_derive_company_name` fallback chain: non-empty output for the
  canonical Oracle slug shape, determinism across repeat parses
  (so repost/update classification still collapses cross-run
  observations), `site`-over-`host` precedence when the site is
  descriptive (≥4 chars, alnum, not in `_GENERIC_SITE_CODES`),
  fallback to host for generic site codes like ``CX`` / ``External``,
  and graceful handling of degenerate slugs with all three parts
  empty. Ten tests total pinning the two-layer fix (Oracle RC
  parser + storage guard).
- **E.6 cx_NNN-bypass coverage (+3 tests)** —
  `tests/test_oracle_rc.py` grew by 3 cases pinning the
  numeric-tenant-suffix normalization: `cx_1001` and bare
  `cx1001` must both hit the generic-codes blocklist (host
  fallback wins), while `FordCareers2024` must preserve both
  the brand and the trailing digits (no over-stripping). The
  third case is a regression guard — it already passed
  pre-fix, and must keep passing post-fix.

## I. Coverage comparison

| Metric | Baseline | Previous pass | This pass | Total delta |
|---|---|---|---|---|
| Platform connectors | 10 | 15 | **24** | **+14** |
| ATS platforms recognized by detector | — | 22 (23 inc. JSON-LD fallback) | 22 (23 inc. JSON-LD fallback) | **+22** |
| Generic custom-site extraction | none | schema.org JSON-LD library | schema.org JSON-LD + first-class pipeline source (CustomJsonLd) | **new capability + pipeline integration** |
| Employer-domain auto-discovery | none | detector only (no feeder) | `discover_from_domains` + persist-to-registry | **closed loop** |
| Default title filter | data-analyst | US-IT taxonomy | US-IT taxonomy | **broader by design** |
| Tests | 61 | 130 | **563** | **+502** |
| Default seeded tenants | ~250 | ~320 | ~373 (+13 Rippling, +10 Teamtailor, +13 SF, +20 BambooHR; Paylocity UUIDs, UKG UUIDs, Oracle RC host/region/site triples, and Dayforce tenants discovered via employer-discovery not seeded) | **+123** |
| Default seeded US employer domains | none | none | ~50 (extendable via env) | **new** |

## J. What remains (explicitly out-of-scope for this pass)

1. **Connectors deliberately deferred** (see D.2): Taleo,
   Phenom, Wellfound. Each has documented gotchas in
   `docs/ATS_FINGERPRINTS.md`. Teamtailor, Rippling, SAP SuccessFactors,
   BambooHR, Paylocity, UKG, Oracle RC, and Dayforce have now moved out
   of "deferred" across the two passes. Deferred list now: Taleo,
   Phenom, Wellfound.
2. ~~**Employer-domain auto-discovery.**~~ **Fully closed.** Shipped
   in two increments this pass:
   - `src/discovery/employers.py` — detection + bucketing + persist.
   - Orchestrator integration — `discover(use_employers=True)` invokes
     `employers.slugs_for_source(source)` as a first-class strategy
     alongside `seed`, `jobpulse`, `github`, `crawl`, `sitemap`,
     `apify`. Opt-in (off by default because it does ~50 outbound
     fetches on first call). The report is cached per-process so a
     multi-source orchestrator run amortizes one detection pass.
3. **schema.org `identifier.value` cross-portal dedupe.** The extractor
   now captures it into `requisition_id`; the classifier already uses
   `requisition_key` — so cross-ATS dedupe starts working the moment we
   see the same employer via two different routes. Validation against a
   real dual-platform employer still pending.
4. **Live integration run.** 340 unit tests pass. The tooling for the
   25–50 real-employer pass now exists: `python -m src.tools.audit_discovery
   --domains-file data/seeds/us_employers.txt` (or `--domains a.com,b.com`
   or `$AUDIT_DOMAINS` CSV) fans out `detect_domain` across a configurable
   concurrency pool and drops `data/reports/discovery_audit_<ts>.json` +
   `.md` with platform coverage, confidence histogram, per-platform slug
   lists, custom-JSON-LD fallback candidates, unknown domains, and the
   summary % of platform recognition. The end-to-end run (seed → detect
   → scrape → ingest → classify) against real traffic still has to be
   invoked before first production cron; the audit harness is the first
   gate on that run.
5. **Per-employer metrics dashboard.** Logs carry the data; a query
   layer is not built.

## K. Success criteria (from the spec) — self-assessment

| Criterion | Status |
|---|---|
| Meaningful coverage expansion via discovery | ✅ **14 new platform connectors** (Recruitee, Personio, Jobvite, JazzHR, Eightfold, Rippling, Teamtailor, CustomJsonLd, SuccessFactors, BambooHR, Paylocity, UKG, Oracle RC, Dayforce) + universal JSON-LD fallback |
| Discovery-driven architecture with ATS detection | ✅ `detect.py`, `generic_extractor.py`, and `employers.py` shipped — closed loop from arbitrary employer domain to per-platform slug file |
| US IT relevance filter | ✅ `JOB_FILTER_MODE=it` default, 100-kw taxonomy |
| Evidence-based build-vs-buy | ✅ 6 candidates reviewed (see B.) |
| Tested at scale | ⚠️ **445 unit tests pass**; live integration against 25–50 employer targets still pending (harness shipped as `python -m src.tools.audit_discovery` — fans `detect_domain` across a domain list and emits markdown + JSON coverage reports; ready for first real run) |
| Final report in A–M format | ✅ this document |

## L. Failure conditions (from the spec) — watch-list

- **WAF collisions.** iCIMS (known), Phenom, Oracle RC partial (IP-based;
  connector returns zero jobs gracefully on WAF block). Mitigated by
  `log.info` degradation and opt-in seeds.
- **Portal-side URL churn.** Workday tenant triple changes (`wd5`→`wd12`
  mid-migration) break discovery. Validator catches these.
- **JSON-LD under-population.** Some employers ship JSON-LD on detail
  pages only; our extractor runs on whatever HTML it's given and just
  emits zero jobs. The detector surfaces `confidence=0, has_jsonld=True`
  so operators can debug.

## M. Artifacts (files changed / added)

**New files — previous pass:**
- `src/discovery/detect.py` (304 LoC)
- `src/discovery/generic_extractor.py` (239 LoC)
- `src/sources/recruitee.py` (108 LoC)
- `src/sources/personio.py` (152 LoC)
- `src/sources/jobvite.py` (138 LoC)
- `src/sources/jazzhr.py` (117 LoC)
- `src/sources/eightfold.py` (138 LoC)
- `tests/test_detect.py` (32 tests)
- `tests/test_generic_extractor.py` (16 tests)
- `tests/test_new_connectors.py` (17 tests)
- `docs/ATS_FINGERPRINTS.md` (fingerprint reference for all 22 platforms)
- `docs/DISCOVERY_SYSTEM.md` (this file)

**New files — this pass:**
- `src/sources/rippling.py` (~170 LoC) — Next.js `__NEXT_DATA__`
  extractor + `_walk_jobs` heuristic
- `src/sources/teamtailor.py` (~100 LoC) — JSON-LD wrapper with
  detail-follow fallback
- `src/sources/custom_jsonld.py` (~170 LoC) — first-class pipeline source
  with direct/index-follow modes
- `src/sources/successfactors.py` (~220 LoC) — SAP SF public XML feed,
  shard probe + tag-synonym fallback, tolerant of tenant schema drift
- `src/sources/bamboohr.py` (~250 LoC) — BambooHR `/careers/list`
  JSON feed, shape-tolerant `_iter_jobs`, open/closed status filter
- `src/sources/paylocity.py` (~220 LoC) — Paylocity
  `/recruiting/JobsApi/JobList` JSON feed, UUID tenants auto-discovered
  via employer-discovery iframe extraction, synonym-keyed parser
- `src/sources/ukg.py` (~320 LoC) — UKG UltiPro `/JobBoard/{UUID}/SearchJobs/`
  POST JSON endpoint, composite `TENANT/UUID` slug (optionally
  `SHARD|TENANT/UUID`), `Skip`-based pagination with `totalCount` +
  `_MAX_PAGES` termination, `PrimaryLocation.Name`/`Address` sub-dict
  normalizer, `IsRemote`+`WorkType`+location-substring remote
  inference, boolean `FullTime` coerced to employment string
- `src/sources/oracle_rc.py` (~375 LoC) — Oracle Recruiting Cloud
  (Fusion HCM) `hcmRestApi/recruitingCEJobRequisitions` GET JSON
  endpoint, 3-part composite `host/region/site` slug,
  Oracle-style `finder=findReqs;siteNumber={site},limit=100,offset=N,
  sortBy=POSTING_DATES_DESC` finder expression, pagination via `offset`
  until `hasMore=false` or short page (`_MAX_PAGES=50` safety cap),
  shape-tolerant `_iter_jobs` covering `items`/`Items`/`requisitionList`/
  bare list / outer-shell `items[0].requisitionList`, `PrimaryLocation`
  string-or-dict + `secondaryLocations` list merge,
  `WorkplaceType`+location-substring remote inference, `ExternalURL`
  overrides synthesized apply URL, `Referer` matching ``/sites/{site}/jobs``
- `src/sources/dayforce.py` (~200 LoC) — Dayforce (Ceridian)
  CandidatePortal + detail-page JSON-LD connector. Thin wrapper around
  `generic_extractor.extract_from_html`, run against both the
  `Posting/Search` landing page (where many tenants pre-render
  Google-Jobs JSON-LD blobs) and each `Posting/View/{id}` detail page.
  Session-cookie handshake is implicit via the shared `HttpClient`'s
  persistent `Session` (landing fetched first, `Set-Cookie` auto-carries
  into detail fetches). Slug format accepts bare tenant (own-subdomain:
  `{tenant}.dayforcehcm.com`, older customers) and shard-pinned
  `SHARD:tenant` (shared shard: `us58:mycompany` →
  `us58.dayforcehcm.com`); both `:` and `/` separators accepted so
  `detect.py`'s composite output flows in directly. Detail-URL
  extraction handles relative hrefs, absolute URLs in `<script>` blobs,
  and cross-shard absolute URLs on the parent `dayforcehcm.com` domain
  (capped at `_MAX_POSTINGS_PER_TENANT=500`).
- `src/discovery/employers.py` (~260 LoC) — employer-domain discovery
  loop (detect → bucket → persist → orchestrator-integrable)
- `src/tools/__init__.py` (marker — operator-tools package)
- `src/tools/audit_discovery.py` (~350 LoC) — live-integration audit
  harness: `audit_domains()` fans `detect_domain` across a pool with
  per-domain exception swallowing, `AuditReport.finalize()` derives
  platform/confidence buckets + JSON-LD + unknown + error lists,
  `render_markdown()` emits the operator-facing report (summary,
  platform coverage table, confidence histogram, slugs by platform,
  custom-site fallback candidates, unknown domains, errors),
  `write_report()` persists JSON + MD to `data/reports/`, and a
  `main()` argparse CLI that reads domains from `--domains` CSV,
  `--domains-file` (with `#` comment support), and `$AUDIT_DOMAINS`
  env (union + case-insensitive dedup), exiting 2 on empty input
- `tests/test_rippling.py` (12 tests)
- `tests/test_teamtailor_custom.py` (10 tests)
- `tests/test_employers.py` (22 tests)
- `tests/test_orchestrator.py` (4 tests)
- `tests/test_successfactors.py` (17 tests)
- `tests/test_bamboohr.py` (30 tests)
- `tests/test_paylocity.py` (35 tests)
- `tests/test_audit_discovery.py` (26 tests)
- `tests/test_ukg.py` (52 tests)
- `tests/test_oracle_rc.py` (52 tests)
- `tests/test_crawl.py` (13 tests) — multi-group `_extract` composition
  for UKG + Oracle RC plus single-group regression coverage
- `tests/test_dayforce.py` (38 tests) — `_split_slug` both separator
  forms, `_landing_url` own-subdomain vs. shared-shard, detail-URL
  extraction (relative + absolute + cross-shard), `fetch_listings`
  landing+detail JSON-LD dual extraction with `max_per_tenant` cap,
  provenance stamping, landing-before-detail ordering for the implicit
  session-cookie handshake.
- `tests/test_discover_cli.py` (3 tests) — invariant pinning for
  `scripts/discover_companies.py::SUPPORTED`. Asserts (1) SUPPORTED
  equals `seed_lists.SEEDS.keys()` exactly — no drift allowed — (2)
  every slug-consuming connector in `REGISTRY` (minus API aggregators
  Adzuna/USAJobs/RemoteOK and the URL-based CustomJsonLd) has a CLI
  entry, and (3) API-aggregator source names are *not* present (listing
  them would be misleading since `discover()` is a no-op for them).
  This test was added after discovering that SUPPORTED had silently
  drifted — it still listed only the five original sources while
  seed_lists had grown to twenty, causing the daily pipeline to run 15
  shipped connectors with empty company lists.
- `tests/test_validator.py` (35 tests) — pins `_probe()` probe-URL
  coverage for every source in `seed_lists.SEEDS`. A parametric
  invariant test ensures **no source ever lacks a probe** (an empty
  probe URL silently drops every slug at validation). Plus targeted
  Workday triple-composition tests (correct URL, different region,
  seven malformed-input cases, non-`wd\d+` cluster rejection) and
  iCIMS subdomain composition + rejection-on-malformed tests. The
  file exists because the first operator discovery run revealed that
  Workday and iCIMS had no probes and were silently dropping every
  seeded slug.

**Modified files — cumulative:**
- `config.py` — **fourteen** new settings fields + taxonomy expansion
  (adds `dayforce_companies` reading `DAYFORCE_COMPANIES` as CSV, on
  top of the thirteen prior ones including `oracle_rc_companies`).
  **E.7 addition:** `raw_ttl_days: int = _int("RAW_TTL_DAYS", 14)` —
  the TTL window `prune_raw` enforces against `jobs_raw`.
  `RAW_TTL_DAYS=0` disables pruning entirely for environments that
  want to keep the full audit log (e.g. a short-lived staging DB).
- `src/discovery/seed_lists.py` — **thirteen** seed tuples registered
  (including SUCCESSFACTORS_SEED with shard-pinned entries, plus
  BAMBOOHR_SEED, PAYLOCITY_SEED, UKG_SEED, ORACLE_RC_SEED, and
  DAYFORCE_SEED — the last four empty because their tenant IDs
  aren't guessable and are auto-filled by employer-discovery)
- `src/discovery/crawl.py` — regex patterns for all fourteen new platforms
  plus a generalized `_extract` that joins multi-group captures with
  `/` for composite slugs (incl. SF's 3 URL variants:
  `career{N}.successfactors.com`, `career{N}.sapsf.com`,
  `{X}.jobs.hr.cloud.sap`; BambooHR's `{X}.bamboohr.com/(jobs|careers)`;
  Paylocity's `recruiting.paylocity.com/.../All/{UUID}`; UKG's
  2-group `recruiting{N}.ultipro.com/{TENANT}/JobBoard/{UUID}` yielding
  `TENANT/UUID`; Oracle RC's 3-group
  `{host}.fa.{region}.oraclecloud.com/hcmUI/CandidateExperience/.../sites/{site}`
  yielding `host/region/site`; Dayforce's own-subdomain pattern that
  uses a backreference to require subdomain == path-tenant — emitting
  a single-group bare tenant slug — plus the legacy
  `jobs.dayforcehcm.com/{tenant}` aggregate host)
- `src/discovery/validator.py` — per-source probe URLs (incl. Rippling,
  Teamtailor, SuccessFactors XML feed, BambooHR `/careers/list`,
  Paylocity `/JobsApi/JobList?companyId=`, UKG JobBoard page for
  tenant+UUID liveness, Oracle RC `hcmRestApi/recruitingCEJobRequisitions`
  with minimal `findReqs;siteNumber={site},limit=1` finder, and
  Dayforce `CandidatePortal/{locale}/{tenant}/Posting/Search` with
  both `:` and `/` separator acceptance for shard-pinned forms).
  **E.3 fix:** added the two probes that were silently missing —
  Workday (`{tenant}.wd{N}.myworkdayjobs.com/en-US/{site}` landing
  page with strict triple validation) and iCIMS
  (`careers-{subdomain}.icims.com/jobs` with strict subdomain
  validation). Prior to this fix both sources dropped every seeded
  slug at validation because `_probe()` fell through to its empty-URL
  default.
- `src/discovery/detect.py` — `_URL_PATTERNS` tuple now accepts either
  an int (single-group slug, the common case) or a tuple of ints
  (multi-group composite, used by UKG for 2-part `TENANT/UUID` and
  Oracle RC for 3-part `host/region/site`); `detect_from_url` composes
  the multi-group case with `/` separator. A second bare-host Oracle
  RC fallback pattern is registered after the CandidateExperience-path
  pattern so redirects that landed on the Oracle domain still score
  confidence 3 for routing. Dayforce ships three patterns in priority
  order: (1) own-subdomain with `\1` backreference (subdomain ==
  path-tenant → bare tenant slug), (2) shared-shard 2-group composite
  (emits `shard/tenant`), (3) legacy `jobs.dayforcehcm.com/{tenant}`
- `src/sources/registry.py` — **24 connectors** in REGISTRY +
  `_merged_custom_jsonld_urls()` helper that reads
  `data/companies/custom_jsonld.txt`
- `src/discovery/orchestrator.py` — new `use_employers=False` flag
  and ``employers`` strategy in the strategy list
- `scripts/discover_companies.py` — `SUPPORTED` tuple extended from
  the five original sources to all **twenty** slug-consuming
  connectors (the five originals plus workday, icims, recruitee,
  personio, jobvite, jazzhr, eightfold, rippling, teamtailor,
  successfactors, bamboohr, paylocity, ukg, oracle_rc, dayforce).
  Prior to this fix the CLI silently rejected `--source workday` et al.
  via argparse `choices=`, so the daily pipeline ran those 15
  connectors with empty `data/companies/<source>.txt` files and they
  yielded zero jobs. Invariant pinned by `tests/test_discover_cli.py`.
- `src/normalizer.py` — IT-mode title filter
- `src/sources/icims.py` — WAF hardening
- `src/sources/oracle_rc.py` — **E.5 fix:** `_derive_company_name(host, site)`
  + `_prettify` + `_GENERIC_SITE_CODES` frozenset. `parse_listing`
  now synthesizes a deterministic company_name from the slug parts
  instead of emitting `None`. Precedence: descriptive `site` (≥4 chars,
  alnum, not a generic candidate-experience code) → `host` pod id →
  raw-host fallback → `"Unknown (Oracle RC)"` sentinel. Never returns
  `None`, so the single connector that used to single-handedly blow up
  the entire ingest transaction now feeds clean rows through.
  **E.6 fix:** `_TENANT_SUFFIX_RE` (compiled `[_-]?\d+$`) normalizes
  the site slug for the `_GENERIC_SITE_CODES` check only, so Oracle
  Fusion's tenant-stamped shells (`CX_1001`, `cx1001`, `ext_42`)
  land on the blocklist and fall back to host. `_prettify` still
  sees the original slug, so descriptive-with-digits sites like
  `FordCareers2024` survive intact.
- `src/storage.py` — **E.5 fix:** defensive pre-ingest guard.
  `_missing_required_fields()` helper + `_REQUIRED_FIELDS` tuple
  (`job_title`, `company_name`, `source_platform`, `source_url`).
  `ingest()` now skips+logs any `JobPosting` missing one of these
  rather than letting the insert hit a NOT NULL constraint and abort
  the transaction. One bad row no longer rolls back the thousands of
  good rows in the same batch. Emits structured
  `ingest.drop_missing_fields` warnings with source + title + missing
  field list for post-run audit. **E.7 fix:** `jobs_raw` now has a
  `payload_hash VARCHAR(64)` column and a
  `UNIQUE INDEX uq_jobs_raw_src_hash (source_platform, payload_hash)`;
  `save_raw` computes `sha256("{source}\x00{payload_json}")`,
  collapses intra-batch duplicates, and filters out hashes already in
  DB before bulk insert (returns count of *new* rows). New
  `prune_raw(ttl_days=N)` deletes rows older than
  `now_utc - N days`. Together these cap the formerly-unbounded audit
  table: no duplicate payloads, no runaway retention.
- `run_daily.py` — **E.7 fix:** post-ingest call to
  `storage.prune_raw(ttl_days=settings.raw_ttl_days)` when
  `raw_ttl_days > 0`. Pruned-row count logged as
  `pipeline.raw_pruned rows=N ttl_days=14` when non-zero, silent
  otherwise. Slotted between `storage.ingest(unique)` and the
  mark-removed sweep so a slow prune can't delay classification.
- `tests/test_classifier.py` — soft_key tests
- `tests/test_normalizer.py` — dual-mode filter tests
- `tests/test_workday_parsing.py` — tenant triple parser tests
- `tests/test_storage_ingest.py` — **E.5:** +5 tests pinning the new
  pre-ingest guard.
- `tests/test_oracle_rc.py` — **E.5:** +5 tests pinning
  `_derive_company_name` precedence + determinism. **E.6:**
  +3 tests pinning numeric-tenant-suffix normalization
  (`cx_1001` / `cx1001` → host fallback; `FordCareers2024` → preserved).
- `tests/test_storage_raw_retention.py` (new, **E.7**) — 10 tests:
  write-time dedupe (same payload → 1 row, different payloads → N
  rows, cross-source preservation, intra-batch collapse, return-count
  reflects writes); `prune_raw` (rows older than TTL deleted, boundary
  preserved, `jobs_clean` untouched, idempotent on repeat, empty-table
  returns 0). Written RED-first against the bare
  `(id, source_platform, payload, scrape_timestamp_utc)` schema; GREEN
  came from adding `payload_hash` + unique index + `prune_raw`.
- `tests/test_compact_jobs_db.py` (new, **E.7**) — 12 tests pinning
  the one-shot cleanup script: `_backfill_hashes` formula matches
  `Storage.save_raw` exactly (cross-module invariant) + is idempotent
  + returns 0 on empty table; `_collapse_duplicates` keeps oldest per
  `(source, hash)`, never crosses sources, skips NULL-hash rows,
  preserves distinct hashes, dry-run projects without mutating;
  `_apply_ttl` deletes past cutoff + honours dry-run + leaves
  `jobs_clean` untouched; `_count_duplicate_groups` reports
  `(extra_rows, groups_affected)` for pre-apply projection.
- `scripts/backfill_oracle_company_name.py` — **E.6:** one-shot
  DB repair for rows clobbered by the pre-fix `Cx <digits>`
  company_name. Reconstructs `(host, region, site)` from
  `source_url`, re-derives via the fixed helper, prints a
  before/after diff, prompts before UPDATE.
- `scripts/compact_jobs_db.py` (new, **E.7**) — one-shot compaction
  for DBs that grew before E.7's write-time dedupe landed.
  Dry-run by default; `--apply` takes a `.bak-YYYYMMDD-HHMMSS`
  backup, then adds `payload_hash` if missing, backfills hashes
  using the same `sha256("{source}\x00{payload}")` formula as
  `save_raw`, deletes all but `MIN(id)` per `(source, hash)` group,
  applies the `--ttl-days` (default 14) delete, adds the
  `UNIQUE INDEX` if missing, and `VACUUM`s to reclaim disk.
  Never touches `jobs_clean` / `jobs_history` / `scrape_runs`.
  `--no-backup` for operators with external backup already in hand.
- `docs/RESEARCH.md` — portal table + iCIMS WAF caveat
- `docs/DISCOVERY_SYSTEM.md` — this file (Phase 2 update)
