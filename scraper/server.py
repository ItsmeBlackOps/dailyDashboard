"""Tiny HTTP wrapper for scrape_with_resume.py — used by dailyDashboard backend."""
import os, subprocess, tempfile, json, uuid
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import httpx

app = FastAPI()
ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "scripts" / "scrape_with_resume.py"

class FindJobsRequest(BaseModel):
    # resume_url is now optional — when override_titles is supplied the
    # scraper skips PDF read + LLM derive and uses the dashboard's
    # gpt-4o-mini-derived plan directly.
    resume_url: str | None = None
    profile_id: str  # stable id, e.g. candidateId
    max_per_source: int = 100
    linkedin_only: bool = False  # default: search BOTH LinkedIn AND career sites
    multi_title: bool = True
    # legacy / override fields — respected when multi_title=False or overrides needed:
    keyword: str | None = None
    location: str | None = None
    remote: str | None = "remote"
    years_min: float | None = None
    years_max: float | None = None
    first_run: bool = False
    # Dashboard-derived profile overrides (set by resumeProfileService.js).
    # When provided, these bypass the scraper's internal LLM-based title/keyword
    # derivation and are forwarded as env vars to scrape_with_resume.py.
    override_titles: list[str] | None = None
    override_keywords: list[str] | None = None

@app.post("/find-jobs")
async def find_jobs(req: FindJobsRequest):
    has_overrides = bool(req.override_titles and len(req.override_titles) > 0)

    # Skip PDF download entirely when overrides are provided. The dashboard
    # already derived titles/keywords/years_min/years_max via gpt-4o-mini.
    resume_path: str | None = None
    if not has_overrides:
        if not req.resume_url:
            raise HTTPException(
                400,
                "either resume_url or override_titles must be provided",
            )
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.get(req.resume_url)
                r.raise_for_status()
                f.write(r.content)
            resume_path = f.name

    # Build CLI args. resume positional is omitted when we have overrides
    # (scrape_with_resume.py treats it as optional in that case).
    args = ["python", str(SCRIPT)]
    if resume_path:
        args.append(resume_path)
    args += [
        "--no-ingest",
        "--json-output",
        "--max-per-source", str(req.max_per_source),
        "--profile-id", req.profile_id,
    ]
    if req.linkedin_only:
        args += ["--linkedin-only"]
    if req.years_min is not None:
        args += ["--years-min", str(req.years_min)]
    if req.years_max is not None:
        args += ["--years-max", str(req.years_max)]
    if req.first_run:
        args += ["--first-run"]

    env = os.environ.copy()
    # Always pass remote=remote unless caller explicitly overrides
    env["RESUME_SCRAPE_REMOTE"] = req.remote or "remote"
    if req.location:
        env["RESUME_SCRAPE_LOCATION"] = req.location
    # When multi_title=True the LLM plan inside the script already fans out
    # across multiple titles — no extra loop needed here.
    if req.multi_title:
        env["RESUME_SCRAPE_MULTI_TITLE"] = "1"
    # Dashboard-derived profile overrides from resumeProfileService.js.
    # These env vars let the scraper script skip its own LLM derivation step
    # when titles/keywords have already been computed from the candidate's resume.
    if req.override_titles:
        env["RESUME_SCRAPE_OVERRIDE_TITLES"] = ",".join(req.override_titles)
    # Forward years range as override env vars too — the script's override
    # branch reads these instead of running the LLM derivation.
    if req.years_min is not None:
        env["RESUME_SCRAPE_OVERRIDE_YEARS_MIN"] = str(req.years_min)
    if req.years_max is not None:
        env["RESUME_SCRAPE_OVERRIDE_YEARS_MAX"] = str(req.years_max)
    if req.override_keywords:
        env["RESUME_SCRAPE_OVERRIDE_KEYWORDS"] = ",".join(req.override_keywords)

    # ── Canonical Apify actor filter defaults (per product spec) ──
    # These env vars are picked up inside scrape_with_resume.py and forwarded
    # to the Fantastic Jobs Apify actor. Host-level env wins; we only set
    # defaults the host hasn't already specified.
    spec_defaults = {
        "FANTASTIC_JOBS_REMOVE_AGENCY":         "true",
        "FANTASTIC_JOBS_INCLUDE_AI":            "true",
        "FANTASTIC_JOBS_INCLUDE_LINKEDIN":      "false",   # use the dedicated LinkedIn actor instead
        "FANTASTIC_JOBS_DESCRIPTION_TYPE":      "text",
        "FANTASTIC_JOBS_AI_EMPLOYMENT_TYPES":   "FULL_TIME,CONTRACTOR",
        "FANTASTIC_JOBS_AI_WORK_ARRANGEMENTS": "On-site,Hybrid,Remote OK,Remote Solely",
        "FANTASTIC_JOBS_COUNTRY":               "United States",
        "FANTASTIC_JOBS_TIME_RANGE":            "7d",
        # LinkedIn actor knobs
        "LINKEDIN_NO_DIRECT_APPLY":             "true",   # exclude Easy Apply
        "LINKEDIN_TIME_RANGE":                  "7d",
    }
    for k, v in spec_defaults.items():
        env.setdefault(k, v)

    try:
        proc = subprocess.run(args, env=env, capture_output=True, text=True, timeout=600, cwd=str(ROOT))
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "scraper timed out")
    finally:
        try: os.unlink(resume_path)
        except: pass

    if proc.returncode == 2:
        raise HTTPException(422, f"resume YOE missing: {proc.stderr[-500:]}")
    if proc.returncode != 0:
        raise HTTPException(500, f"scraper exit {proc.returncode}: {proc.stderr[-500:]}")

    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise HTTPException(500, f"scraper output not JSON: {e}; stdout tail: {proc.stdout[-500:]}")

    # data is the full envelope from --json-output: { jobs, discovered, ... }
    # Normalise to what the backend expects: result holds jobs, discovered is top-level.
    result = data.get("jobs", data)
    discovered = data.get("discovered", {})

    return {
        "success": True,
        "result": result,
        "discovered": discovered,
        "stderr_tail": proc.stderr[-2000:],
    }

@app.get("/health")
def health():
    return {"ok": True}
