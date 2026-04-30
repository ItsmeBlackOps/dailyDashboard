"""Tiny HTTP wrapper for scrape_with_resume.py — used by dailyDashboard backend.

Also exposes /enrich-jd: gpt-4o-mini extracts {Years of Experience, Job Titles}
from a job description so the daily pool runner can match candidates against
real JD requirements rather than only the actor-reported title."""
import os, subprocess, tempfile, json, uuid, asyncio
import re as _re
from typing import List, Optional
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import httpx

app = FastAPI()
ROOT = Path(__file__).resolve().parent

# ── JD enrichment (gpt-4o-mini) ────────────────────────────────────────
# Lazy-initialise the OpenAI client; the openai SDK reads OPENAI_API_KEY
# from env. Returning None when the key is missing keeps the scraper
# usable for non-enrichment paths.
_oa_client = None
def _openai_client():
    global _oa_client
    if _oa_client is None:
        try:
            from openai import OpenAI
            _oa_client = OpenAI()
        except Exception as e:  # noqa: BLE001 — surface any setup failure
            raise HTTPException(503, f"OpenAI client unavailable: {e}")
    return _oa_client

# Stable system prompt — identical structure to the example shared by the
# product owner. Tweaks: enforce STRICT JSON, allow null for missing YoE,
# cap title list to keep matching tractable.
JD_ENRICH_PROMPT = (
    "Extract the minimum total years of experience required and the matching "
    "job title array from the job description.\n\n"
    "Rules:\n"
    "- Return years of experience as an integer (the floor of any range).\n"
    '- If the job says "3+ years", return 3.\n'
    '- If the job says "3-5 years" or "3 to 5 years", return 3.\n'
    "- If no years are mentioned, return null.\n"
    "- Extract only job titles, not skills, tools, or seniority adjectives in isolation.\n"
    "- Include close title variations only when they fit the same role family "
    "(e.g. \"Data Analyst\", \"BI Analyst\", \"Analytics Engineer\").\n"
    "- Cap titles at 6 entries; pick the strongest matches.\n"
    "- Return STRICT, valid JSON only. No prose, no markdown.\n\n"
    "Expected output:\n"
    "{\n"
    '  "Years of Experience": 0,\n'
    '  "Job Titles": []\n'
    "}\n\n"
    "Job Description:\n"
)

class EnrichJdRequest(BaseModel):
    description: str
    # Optional knobs the cron may want to tune later.
    max_chars: int = 8000

class EnrichJdResponse(BaseModel):
    years_of_experience: Optional[int] = None
    job_titles: List[str] = []
    raw: Optional[str] = None
    error: Optional[str] = None

def _normalise_title(t: str) -> str:
    s = (t or "").strip()
    # Strip surrounding quotes/brackets/punctuation; collapse whitespace.
    s = _re.sub(r'^[\s"\'`\[]+|[\s"\'`\]]+$', '', s)
    s = _re.sub(r"\s+", " ", s)
    return s

def _enrich_one(description: str, max_chars: int) -> EnrichJdResponse:
    if not description or not description.strip():
        return EnrichJdResponse(error="empty description")
    prompt = JD_ENRICH_PROMPT + (description[:max_chars])
    try:
        client = _openai_client()
        resp = client.responses.create(
            model="gpt-4o-mini",
            input=[{"role": "system", "content": [{"type": "input_text", "text": prompt}]}],
            text={"format": {"type": "text"}},
            reasoning={},
            tools=[],
            temperature=1,
            max_output_tokens=2048,
            top_p=1,
            store=True,
        )
        # Responses API: output is a list of message blocks; the convenience
        # accessor `output_text` flattens to plain text.
        raw = getattr(resp, "output_text", None) or ""
    except Exception as e:  # noqa: BLE001
        return EnrichJdResponse(error=f"openai call failed: {e}")
    # Parse JSON — model is told to return strict JSON but tolerate
    # accidental code-fence wrapping.
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = _re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=_re.MULTILINE).strip()
    try:
        obj = json.loads(cleaned)
    except json.JSONDecodeError as e:
        return EnrichJdResponse(error=f"non-JSON output: {e}", raw=raw)
    yoe = obj.get("Years of Experience", None)
    if isinstance(yoe, str) and yoe.isdigit():
        yoe = int(yoe)
    if yoe is not None and not isinstance(yoe, int):
        try:
            yoe = int(yoe)
        except Exception:  # noqa: BLE001
            yoe = None
    titles_raw = obj.get("Job Titles", []) or []
    titles = [_normalise_title(t) for t in titles_raw if t and isinstance(t, str)]
    titles = [t for t in titles if t]  # drop empties
    return EnrichJdResponse(years_of_experience=yoe, job_titles=titles[:8], raw=raw)

@app.post("/enrich-jd", response_model=EnrichJdResponse)
def enrich_jd(req: EnrichJdRequest):
    return _enrich_one(req.description, req.max_chars)

class EnrichJdBatchRequest(BaseModel):
    items: List[EnrichJdRequest]
    concurrency: int = 5

@app.post("/enrich-jd-batch")
async def enrich_jd_batch(req: EnrichJdBatchRequest):
    """Enrich a batch of descriptions in parallel. Used by the daily pool
    refresher so it can drain N actor-returned jobs in one round-trip."""
    sem = asyncio.Semaphore(max(1, min(req.concurrency, 10)))
    loop = asyncio.get_running_loop()
    async def _run(item: EnrichJdRequest) -> EnrichJdResponse:
        async with sem:
            return await loop.run_in_executor(None, _enrich_one, item.description, item.max_chars)
    out = await asyncio.gather(*[_run(it) for it in req.items])
    return {"count": len(out), "results": [o.dict() for o in out]}
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

    # Find the most relevant error line in stderr — script prints
    # "ERROR:" or final "<reason>" sentence right before exiting non-zero,
    # then 500-char tail as fallback context.
    def _summarise_stderr(text: str) -> str:
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        for l in reversed(lines):
            if l.startswith("ERROR") or l.startswith("APIFY_TOKEN") \
               or l.startswith("Resume file") or l.startswith("Set ANTHROPIC") \
               or l.startswith("Set OPENAI") or l.startswith("Resume path is required") \
               or l.lower().startswith("pdf resume given but pypdf"):
                return l
        return lines[-1] if lines else ""

    if proc.returncode == 2:
        reason = _summarise_stderr(proc.stderr) or "config/setup error"
        raise HTTPException(422, f"scraper config error (exit 2): {reason} | tail: {proc.stderr[-500:]}")
    if proc.returncode != 0:
        reason = _summarise_stderr(proc.stderr) or f"exit {proc.returncode}"
        raise HTTPException(500, f"scraper {reason} | tail: {proc.stderr[-500:]}")

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
