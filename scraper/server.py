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
    years_min: float | None = None
    years_max: float | None = None
    first_run: bool = False
    location: str | None = None
    remote: str | None = None  # 'remote' | 'hybrid' | 'onsite'
    keyword: str | None = None

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
    args = ["python", str(SCRIPT), resume_path, "--no-ingest", "--max-per-source", str(req.max_per_source), "--profile-id", req.profile_id]
    if req.years_min is not None:
        args += ["--years-min", str(req.years_min)]
    if req.years_max is not None:
        args += ["--years-max", str(req.years_max)]
    if req.first_run:
        args += ["--first-run"]

    env = os.environ.copy()
    if req.location: env["RESUME_SCRAPE_LOCATION"] = req.location
    if req.remote: env["RESUME_SCRAPE_REMOTE"] = req.remote

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

    return {"success": True, "result": data, "stderr_tail": proc.stderr[-2000:]}

@app.get("/health")
def health():
    return {"ok": True}
