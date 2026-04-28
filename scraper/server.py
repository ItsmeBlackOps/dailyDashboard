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
    resume_url: str
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

@app.post("/find-jobs")
async def find_jobs(req: FindJobsRequest):
    # Download resume to /tmp
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(req.resume_url)
            r.raise_for_status()
            f.write(r.content)
        resume_path = f.name

    # Build CLI args
    args = [
        "python", str(SCRIPT), resume_path,
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
