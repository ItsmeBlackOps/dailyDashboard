# find-jobs — resume-driven Apify job scraper

Give it a resume; it produces a ranked list of relevant LinkedIn + ATS
postings as JSON, locally.

## Three ways to invoke

### 1. Claude Code (recommended for non-developers)

Open Claude Code in this repo and type:

```
/find-jobs path/to/resume.txt
```

Claude will:
1. Check your env vars
2. Show you the LLM-derived search plan and ask for approval
3. Run both Apify actors live
4. Dump parsed results to `data/samples/output_linkedin.json` and
   `output_fantastic_jobs.json`
5. Summarize the top hits inline

If you don't include a path, Claude will ask for one.

### 2. Shell wrapper (developers, macOS/Linux)

```bash
scripts/find-jobs.sh resume.txt
scripts/find-jobs.sh resume.pdf --linkedin-only --max-per-source 50
RESUME_SCRAPE_LOCATION="Remote" scripts/find-jobs.sh resume.md
```

### 3. PowerShell wrapper (Windows)

```powershell
.\scripts\find-jobs.ps1 resume.txt
.\scripts\find-jobs.ps1 resume.pdf --linkedin-only --max-per-source 50
```

### 4. Direct Python (full control)

```bash
python scripts/scrape_with_resume.py resume.txt --dry-run
python scripts/scrape_with_resume.py resume.txt --no-ingest --max-per-source 100
python scripts/scrape_with_resume.py resume.txt   # full run + Supabase ingest
```

## One-time setup

1. Install Python deps (already done if `pytest` works):
   ```bash
   pip install apify-client openai anthropic pydantic structlog httpx pypdf
   ```

2. Copy `.env.example` to `.env` and fill in:
   ```dotenv
   APIFY_TOKEN=apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   OPENAI_API_KEY=sk-...                  # OR
   ANTHROPIC_API_KEY=sk-ant-...
   RESUME_SCRAPE_LOCATION=United States   # optional default
   RESUME_SCRAPE_REMOTE=remote            # remote | hybrid | onsite | any
   ```

   - Apify token: https://console.apify.com/account/integrations
   - OpenAI key:  https://platform.openai.com/account/api-keys
   - Anthropic key: https://console.anthropic.com/

## Cost estimate

| Step | What | Approx cost |
|---|---|---|
| LLM plan | OpenAI gpt-4o (default) | $0.01 |
| LinkedIn scrape | `fantastic-jobs/advanced-linkedin-job-search-api` | ~$0.025 / 25 jobs |
| Career-site scrape | `fantastic-jobs/career-site-job-listing-api` | ~$0.025 / 25 jobs |
| **Total per resume** | 50 jobs back | **≈ $0.06**, ~30s |

## What you get

Two JSON files in `data/samples/` per run:

```jsonc
{
  "actor": "fantastic-jobs/advanced-linkedin-job-search-api",
  "parsed_count": 25,
  "samples": [
    {
      "title": "Senior Data Engineer",
      "company": "Humana",
      "location": "Louisville, Kentucky, United States",
      "remote_type": "remote",
      "employment_type": "FULL_TIME",
      "seniority": "10+",
      "ats": "linkedin",
      "url": "https://www.linkedin.com/jobs/view/...",
      "date_posted": "2026-04-26T...",
      "skills": ["python", "sql", "aws", "..."],
      "snippet": "We're looking for a Senior Data Engineer..."
    }
    // ... 24 more
  ]
}
```

Easy-apply jobs are filtered out at the LinkedIn actor level
(`noDirectApply=true`).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `APIFY_TOKEN not set` | env not loaded | check `.env` exists, key uncommented |
| `OpenAI 401 Unauthorized` | dead key | rotate at OpenAI console, update `.env` |
| LinkedIn returns 0 jobs | LinkedIn 403 (proxy bot detection) | wait 5 min, retry |
| `pypdf` ImportError on PDF resume | optional dep missing | `pip install pypdf` |
| Same job appears in both files | small overlap between actors | set `LINKEDIN_EXCLUDE_ATS_DUP=true` |
