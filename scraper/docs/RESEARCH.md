# US Job-Portal Research — Repost Detection, ID Stability, Experience Extraction

Synthesis of two parallel research passes (ATS platforms + aggregators) conducted
April 2026. The question was: for each major US portal, what are the stable IDs,
how do we detect fresh vs. reposted vs. deleted-and-republished listings, where
does experience data live, and which open-source repos can we stand on?

## TL;DR — how the scraper now handles repost detection

1. Each incoming posting is normalized to a `JobPosting` and run through
   `src/classifier.py`, which decides one of six buckets by cascading over
   four keys:
   1. `requisition_key` (sha1 of normalized_company + portal requisition_id) —
      highest-signal when present.
   2. `canonical_key` (portal's notion of identity — title+company+location+source_url+source_job_id).
   3. `content_hash` (title+company+location+first 2KB of description). Survives
      delete+repost because it drops churning fields.
   4. `soft_key` (content_hash's cousin on top 1.5KB) — looser backup.
2. `jobs_clean` tracks `first_seen_at`, `last_seen_at`, `removed_at`,
   `reappeared_at`, `times_seen`, `classification`. `jobs_history` is an
   append-only audit of every observation.
3. `Storage.mark_removed(source, seen_keys, dormant_days=3)` is swept at the
   end of each run, so any live row the portal stopped returning for ≥3 days
   becomes `removed_at != NULL`. The next time a match arrives it classifies
   as **REPOST** instead of DUPLICATE.
4. `src/experience.py` extracts `(min_years, max_years, level)` from title +
   description via a regex cascade (range → X+ → "at least X" → simple →
   negative patterns → level-based defaults).

## Key cross-cutting lessons from the research

- **Never trust relative "posted X days ago" strings on aggregators.** Indeed,
  ZipRecruiter, Monster, CareerBuilder, and Workday (on its listing endpoint)
  all resurface listings aggressively and reset the relative date. Treat them
  as "not unknown-age" at best; prefer absolute timestamps from the underlying
  ATS.
- **schema.org `JobPosting.identifier.value` on the employer's own ATS page is
  the cross-portal dedupe goldmine.** When Adzuna / Google Jobs / ZipRecruiter
  all quote the same underlying employer ATS URL, we can resolve tracking
  redirects (HTTP 302 → final URL) and then hash the resolved path. That's what
  the `normalize_url()` strip-tracking-params step in `src/normalizer.py` is
  for.
- **Stable IDs ≠ repost-proof IDs.** Greenhouse `id` and Ashby `id` survive
  edits but are regenerated on delete+repost. `internal_job_id` (Greenhouse)
  and `jobPostingId` (Workday) are more stable because they are client-side
  requisition numbers, but they can still be reused across unposting cycles
  (unverified). That's exactly why the classifier falls through to
  `content_hash` and `soft_key` — they deliberately don't depend on any portal
  id.
- **Lever has no `updatedAt`.** You must rely on content-hash diffing alone to
  detect edits. The classifier handles this: canonical_key match + different
  content_hash → `UPDATED`; same content_hash → `DUPLICATE`.
- **Workday relative dates with "30+ Days Ago" are uninterpretable.** The
  Workday connector returns `None` for `date_posted_normalized` in that case
  so the 24h recency filter correctly drops them rather than falsely accepting.

## Priority-ranked portal cards

### Tier 1 — integrate first (done or in progress)

| Portal | Access | Stable IDs | Freshness signal | Status |
|---|---|---|---|---|
| **Greenhouse** | JSON, no auth. `GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | `id`, `internal_job_id`, `requisition_id` | `first_published`, `updated_at` | ✅ connector populates `requisition_id` (prefers client-assigned, falls back to `internal_job_id`), `date_updated_normalized`, `department`, `apply_url`. |
| **Lever** | JSON, no auth. `GET api.lever.co/v0/postings/{company}?mode=json` | `id` (UUID) | `createdAt` (epoch ms). **No `updatedAt`** | ✅ connector populates `department` (from `categories.team`), `apply_url`. Edit detection relies on content_hash. |
| **Ashby** | JSON, no auth. `GET api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true` | `id` (UUID) | `publishedAt`. **No `updatedAt`** | ✅ connector populates `department`, `apply_url`, compensation summary → `salary`. |
| **Workday CXS** | POST `{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` | `jobPostingId` (e.g. R-12345), `externalPath` slug | Relative "Posted X Days Ago" — **"30+" is discarded** | ✅ new `src/sources/workday.py`. 15-tenant seed. Treats `jobPostingId` as `requisition_id`. |
| **SmartRecruiters** | JSON, no auth. `GET api.smartrecruiters.com/v1/companies/{id}/postings` | `id` (UUID), `refNumber` | `releasedDate` (first publish), `lastPublishedDate` (edit) | ✅ connector populates `requisition_id` (refNumber), `date_updated_normalized`, `department`, description. **Empirical caveat:** research agent could not verify live responses for 3 tenants — needs field validation. |

### Tier 2 — medium priority (on the backlog, not yet connected)

| Portal | Access | Stable IDs | Freshness | Notes |
|---|---|---|---|---|
| **Workable** | JSON. `apply.workable.com/api/v3/accounts/{sub}/jobs` | `id`, `shortcode` | `published`, `createdAt` | ✅ connector (exists) now populates `requisition_id` (shortcode), `date_updated_normalized`. |
| **iCIMS** | `sitemap.xml` → per-job HTML | numeric id in URL path | `<lastmod>` in sitemap is reliable | Connector shipped (`src/sources/icims.py`). **Caveat — WAF gating:** iCIMS returns `403/405 "Your IP is not on a trusted network"` for every tenant from most cloud egress IPs, regardless of URL or UA. Connector degrades gracefully (logs `sitemap.blocked` at INFO) and `ICIMS_SEED` ships empty by default — operators opt in via `ICIMS_COMPANIES` env var after confirming their egress IP is whitelisted (US residential / search-engine ranges). Verified 2026-04-18. |
| **Jobvite** | HTML (+ RSS feed on some tenants) | `jobvite_id` in URL | Relative strings; RSS `pubDate` when available | Shrinking market share. |
| **SAP SuccessFactors** | POST `{tenant}.jobs.hr.cloud.sap/services/recruiting/v1/jobs` | `jobReqId` (stable across edits) | `postedDate`, sometimes `lastModifiedDateTime` | Tenant-fragmented; per-tenant URL discovery painful. |
| **Oracle Recruiting Cloud** | JSON on public candidate UI | `Id`, `Number` | `PostedDate`, `ExternalPostedEndDate` | Replaces Taleo. Oracle WAF on some tenants. |
| **Phenom** | Per-tenant widget JSON | `jobId` | Tenant-variable | Akamai on enterprise tenants. |
| **Eightfold** | JSON `/api/apply/v2/jobs` | `id`, `ats_job_id`, `display_job_id` | `posted_on`, `last_modified` | **Valuable because `ats_job_id` cross-links to the upstream ATS** — when Eightfold fronts Workday/SF you get the underlying req id. |
| **Rippling ATS** | JSON `ats.rippling.com/api/v2/board/{board}/jobs` | `id` (UUID) | **None in list response** | Clean API, zero freshness metadata — edit detection via content_hash only. |

### Tier 3 — low priority / avoid

- **Oracle Taleo (Legacy)** — Oracle explicitly forbids scraping since 2017; being deprecated.
- **BambooHR** — SMB-only; HTML scrape is fragile.
- **Paylocity** — requires per-tenant `guid`; small footprint.
- **UKG Pro** — no public unauth endpoint.
- **Gem ATS** — too new, no stable shape documented.
- **LinkedIn / Indeed / ZipRecruiter / Monster / CareerBuilder / Glassdoor** —
  aggressive bot protection (Akamai, PerimeterX, Cloudflare Turnstile), ToS
  forbids scraping, relative-date churn makes repost detection noisy. Prefer
  the underlying ATS URL they redirect to.

## Aggregator-specific notes

- **USAJobs** — treat as authoritative for federal postings. `controlNumber`
  is a stable requisition. API key + User-Agent required (already supported).
- **Adzuna** — `id` is aggregator-assigned; `redirect_url` after 302
  resolution is the cross-portal join key.
- **Google Jobs / schema.org JobPosting on employer pages** — the
  `identifier.value` under the employer's schema.org `JobPosting` is the
  gold-standard cross-portal dedupe key. Not yet wired in; slated for the
  iCIMS sitemap rollout.
- **RemoteOK / Wellfound / Built In / SimplyHired** — lower volume, but
  remote-specific tags are cleaner.

## Experience extraction strategy

`src/experience.py` runs a cascade against the concatenated title + description:

1. **Range** — `"3-5 years"` / `"3 to 5 yrs"` wins if present (most specific).
2. **Plus** — `"5+ years"` → `min=5, max=None`.
3. **At least** — `"at least 3 years"` / `"minimum of 3"` → `min=3, max=None`.
4. **Simple** — `"3 years of experience"` → `min=max=3`.
5. **Negative** — `"no experience required"` / `"entry level"` → `0,0`.
6. **Level-based fallback** — if no number found, map `senior`→(5,10),
   `staff`→(8,15), `principal`→(10,20), etc.

Sanity bound: reject any match > 25 years (catches "10 years ago" false
positives).

## Recommended next empirical tests

The research agents flagged four tests that they couldn't run from their
environment but are cheap (~10 min each) and close the biggest unknowns:

1. Close-and-reopen a Greenhouse job; watch whether `internal_job_id` persists.
2. Same for Workday `jobPostingId`.
3. Probe SmartRecruiters `/companies/{X}/postings` with 5 known-good tenants
   to confirm endpoint still returns data in 2026.
4. Validate Ashby `id` survives `isListed:false → true` cycle.

Run these once against friendly tenants before trusting Tier-1 repost logic
at scale.

## Open-source repos we can stand on

- [`adgramigna/job-board-scraper`](https://github.com/adgramigna/job-board-scraper) —
  covers Greenhouse + Lever + Ashby + Rippling. Needs Postgres + S3 + Airtable
  for the full pipeline; the scraping modules are cleanly isolatable.
- [`stapply-ai/ats-scrapers`](https://github.com/stapply-ai/ats-scrapers) — claims
  coverage of Workable, plus the Tier-1 quartet. Maintenance unverified.
- [`chuchro3/WebCrawler`](https://github.com/chuchro3/WebCrawler) — Workday-specific;
  maintenance uncertain. Use as a reference for the POST payload shape.
- `apify/rag-web-browser` + actors — paid path for iCIMS and harder aggregators.
