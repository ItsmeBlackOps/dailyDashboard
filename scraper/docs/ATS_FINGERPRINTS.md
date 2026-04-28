# ATS Careers-Page Fingerprinting Reference

Goal: given an employer's domain (e.g. `stripe.com`), determine which ATS
powers their careers page so we can pick the right connector — or fall back
to schema.org JSON-LD extraction for custom sites.

Prioritization of signals (high-confidence to low):

1. **URL pattern** — final host of `{domain}/careers` redirect chain
2. **Script / iframe src** — ATS-owned hostnames in `<script>` or `<iframe>`
3. **DOM marker** — known element IDs / class prefixes
4. **JS global** — `window.*` injected by the ATS SDK
5. **Response header** — rare; `Set-Cookie` names are occasionally distinctive
6. **`<meta name="generator">`** — some ATS ship it, most don't

---

## 1. Greenhouse
- **URL:** `boards.greenhouse.io/{slug}`, `job-boards.greenhouse.io/{slug}`, `boards.eu.greenhouse.io/{slug}`
- **Embed:** `<script src="https://boards.greenhouse.io/embed/job_board.js?for={slug}"></script>` + `<div id="grnhse_app">`
- **JS global:** `window.Grnhse`
- **Public JSON API:** `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` (CORS-open, no auth)

## 2. Lever
- **URL:** `jobs.lever.co/{slug}`, `jobs.eu.lever.co/{slug}`
- **Embed:** iframe `src="https://jobs.lever.co/{slug}?embedded-in=..."`; `<div class="lever-jobs-container">` with `data-lever-*` attrs
- **Public JSON API:** `https://api.lever.co/v0/postings/{slug}?mode=json` (no auth; `?mode=json` is required)

## 3. Ashby
- **URL:** `jobs.ashbyhq.com/{slug}`
- **Embed:** script served from `jobs.ashbyhq.com/{slug}/embed?version=2`; `<div id="ashby_embed">`
- **Hydration:** `window.__NEXT_DATA__.props.pageProps` contains `jobBoard`/`organization` with slug
- **Public JSON API:** `https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`

## 4. Workday
- **URL:** `{tenant}.wd{N}.myworkdayjobs.com/{locale}/{site}` where N∈1..12 (shard)
- **Internal JSON:** XHR `POST {tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` (this is the clearest fingerprint)
- **Public API (de facto):** same path, `POST JSON {"limit":20,"offset":0,"searchText":""}`. No auth.
- **Gotcha:** tenant triple `(tenant, wdN, site)` must be read from redirect, not guessed; Akamai WAF on some tenants.

## 5. SmartRecruiters
- **URL:** `careers.smartrecruiters.com/{Company}` or `jobs.smartrecruiters.com/{Company}`
- **DOM:** `<div id="sr-jobs">`, class `sr-careers`
- **Public JSON API:** `https://api.smartrecruiters.com/v1/companies/{id}/postings` (no auth, PascalCase ID)

## 6. Workable
- **URL:** `apply.workable.com/{slug}` (candidate-facing)
- **Embed:** `<div class="workable-widget" data-id="{slug}">`; `window.Workable`
- **Public JSON API:** `https://apply.workable.com/api/v3/accounts/{slug}/jobs`

## 7. iCIMS
- **URL:** `careers-{tenant}.icims.com` or `{tenant}.icims.com`
- **DOM:** `<body class="iCIMS_PageFoundation">`; `?in_iframe=1` quirk
- **No JSON API** — scrape `/sitemap.xml` + HTML; iCIMS WAFs most cloud IPs
- **Gotcha:** untrusted egress IPs get 403/405 "Your IP is not on a trusted network"

## 8. Taleo (Oracle legacy)
- **URL:** `{tenant}.taleo.net/careersection/...` with `.ftl` endings
- **DOM:** `<div id="requisitionListInterface">`
- **API:** none public; XML feed `?portal=...&rfl=...` variable
- **Harvest:** HTML parse

## 9. Oracle Recruiting Cloud (Fusion HCM)
- **URL:** `{host}.fa.{region}.oraclecloud.com/hcmUI/CandidateExperience/{lang}/sites/{site}/jobs` (regions: `us2`, `em2`, `ocs`, …)
- **Internal JSON:** XHR to `/hcmRestApi/resources/latest/recruitingCEJobRequisitions`
- **Public API (de facto):** `GET {host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=...&finder=findReqs;siteNumber={site}` (no auth for public sites)

## 10. SAP SuccessFactors
- **URL patterns (all in active use):**
  - `career{N}.successfactors.com/career?company={companyId}` (legacy)
  - `career{N}.sapsf.com/career?company={companyId}`
  - `{company}.jobs.hr.cloud.sap/` (new hosted career site builder)
- **Public XML feed:** `career{N}.successfactors.com/career?company={companyId}&career_ns=job_listing_summary&resultType=XML` (SAP KBA 2428902, no auth)

## 11. Phenom
- **URL:** `{company}.phenompeople.com` or `careers.{company}.com` served by Phenom CDN; `careers.phenom.com/{company}/...`
- **DOM:** `window.phApp` global (verify per tenant); paths `/tgp/` or `/rest/TGWebHost/`
- **Internal JSON:** `/api/rest/TGWebHost/jobs` per tenant — undocumented, heavy bot protection
- **Harvest:** often needs headless browser

## 12. Eightfold
- **URL:** `{tenant}.eightfold.ai/careers`
- **DOM:** `<div id="pcs-body-container">`; `window.EIGHTFOLD_*` globals
- **Internal JSON (de facto):** `GET {tenant}.eightfold.ai/careers/api/jobs?domain={tenant}&start=0&num=100&sort_by=relevance`
- **Gotcha:** some tenants require `Referer` header matching careers URL

## 13. Jobvite
- **URL:** `jobs.jobvite.com/{slug}`; legacy `app.jobvite.com/CompanyJobs/Careers.aspx?c={code}`
- **Public feed:** `jobs.jobvite.com/{slug}/feed/jobs` (JSON/RSS variants). Older tenants use `app.jobvite.com/CompanyJobs/Xml.aspx?c={code}`.

## 14. BambooHR
- **URL:** `{company}.bamboohr.com/jobs/` or `{company}.bamboohr.com/careers/`
- **Embed:** `<iframe src="https://{company}.bamboohr.com/jobs/embed.php">`; body class `BambooHR-ATS`
- **No public JSON API without auth** — scrape `careers/list` HTML; `/jobs/embed2.php?departmentId=0` returns HTML fragments

## 15. Paylocity
- **URL:** `recruiting.paylocity.com/recruiting/jobs/All/{uuid}/{Page}`; numeric-prefix shards `{NNNN}recruiting.paylocity.com`
- **No JSON API** — HTML scrape; some tenants expose RSS at `/recruiting/jobs/RSS/{uuid}`

## 16. JazzHR
- **URL:** `{company}.applytojob.com` (canonical since 2020); legacy `{company}.jazz.co`, `{company}.theresumator.com`
- **Widget:** `https://{company}.applytojob.com/widget/jobs.js`
- **Public feed:** `{company}.applytojob.com/apply/jobs/feed` (JSON); XML variant at `/apply/jobs.xml`

## 17. Recruitee (Tellent)
- **URL:** `{company}.recruitee.com`; custom domains CNAME to `secure.recruitee.com`
- **Public JSON API:** `https://{company}.recruitee.com/api/offers/` (no auth)

## 18. Teamtailor
- **URL:** `{company}.teamtailor.com`; custom domains CNAME to `ext.teamtailor.com`
- **Meta:** `<meta name="generator" content="Teamtailor">` is commonly set
- **Public API:** requires `Authorization: Token token=` (not no-auth) — use HTML + JSON-LD for public scraping
- **Gotcha:** CNAME to `ext.teamtailor.com` is the cleanest out-of-band detection

## 19. Personio
- **URL:** `{company}.jobs.personio.de` / `.personio.com`
- **Embed:** iframe with `?iframe=true`
- **Public XML feed:** `https://{company}.jobs.personio.de/xml` (no auth)

## 20. UKG / Ultimate (UltiPro Recruiting)
- **URL:** `recruiting.ultipro.com/{tenant}/JobBoard/{uuid}` (tenant = e.g. `usg1006`); `recruiting2.ultipro.com`; newer UKG Pro on `apply.ukg.com`
- **Internal JSON:** `POST recruiting.ultipro.com/{tenant}/JobBoard/{uuid}/SearchJobs/` with body `{"opportunitySearch":{"Top":100,"Skip":0,…}}`
- **Gotcha:** tenant + uuid must both be extracted from job-board URL

## 21. Dayforce (Ceridian)
- **URL:** `jobs.dayforcehcm.com/{companyId}/CANDIDATEPORTAL/...`
- **Internal JSON:** `/{companyId}/CANDIDATEPORTAL/api/v1/jobs` style endpoints (undocumented)
- **Gotcha:** some tenants require session cookie from prior HTML load

## 22. Rippling ATS
- **URL:** `ats.rippling.com/{slug}/jobs`
- **Extraction:** parse `<script id="__NEXT_DATA__">` JSON blob — contains full jobs array under `props.pageProps`
- **Internal API:** `/api/ats/v1/...` used by SPA, reachable without auth on most tenants but undocumented

## 23. Wellfound (AngelList Talent)
- **URL:** `wellfound.com/company/{slug}/jobs`; also aggregator at `wellfound.com/jobs`
- **No public API** — GraphQL endpoint is rate-limited + fingerprinted
- **Treat as aggregator, not an ATS** — employers don't embed it on their own career pages

---

## schema.org JobPosting (JSON-LD) fallback

Google requires `<script type="application/ld+json">` with `"@type": "JobPosting"` for Google Jobs indexing — so most large employers (including custom career sites) ship it on per-job pages. Reliably present fields: `title`, `hiringOrganization`, `datePosted`, `jobLocation`, `employmentType`, `description`, `validThrough`; often `baseSalary`, `identifier`.

**This is the single most portable signal and is the default fallback for custom career sites.** Every ATS listed above also ships JSON-LD on its hosted pages, so the fallback doubles as a universal verifier.

Gotchas:
- Some employers put JSON-LD on list pages but not detail pages (or vice versa)
- Handle both single-object and array forms; `@graph` wrappers are common
- `validThrough` is often missing

---

## Detector algorithm

1. Resolve `{domain}/careers`, `/jobs`, `/careers/jobs`, `/about/careers`, `/company/careers` with HEAD+GET, following redirects.
2. If final host matches a known ATS regex (see table above) → classify with high confidence.
3. Fetch HTML, scan `<script src>`, `<iframe src>`, `<link href>` for ATS-owned hostnames.
4. Scan inline JS for known globals (`window.Grnhse`, `window.__NEXT_DATA__` Ashby/Rippling shape, `window.phApp`).
5. Scan `<meta name="generator">`.
6. Fall back to JSON-LD JobPosting parsing for custom sites.

Confidence order: URL match > script-src > window-global > meta-generator > weak HTML class matches. Emit top-2 candidates per domain for ambiguous cases.

Verified 2026-04-18 via live probing + vendor documentation; see original research sources below.

## Sources

- [Ashby Embedding Docs](https://docs.ashbyhq.com/embedding-ashby-job-boards-in-an-external-careers-page)
- [Ashby Public Job Posting API](https://developers.ashbyhq.com/docs/public-job-posting-api)
- [SmartRecruiters Posting API](https://developers.smartrecruiters.com/docs/posting-api)
- [Teamtailor custom domain](https://support.teamtailor.com/en/articles/113671-use-a-custom-domain-for-your-career-site)
- [Personio iframe integration](https://developer.personio.de/docs/integration-via-iframe)
- [Recruitee Careers Site API](https://docs.recruitee.com/reference/intro-to-careers-site-api)
- [iCIMS Career Sites](https://community.icims.com/s/article/Getting-Started-with-iCIMS-Career-Sites)
- [JazzHR Domains](https://help.jazzhr.com/s/article/Updating-your-JazzHR-Career-Page-Domains)
- [Oracle Fusion Recruiting 23D](https://www.oracle.com/webfolder/technetwork/tutorials/tutorial/cloud/r13/wn/recruiting/releases/23D/23D-recruiting-wn.htm)
- [SAP SuccessFactors XML feed KBA 2428902](https://userapps.support.sap.com/sap/support/knowledge/en/2428902)
