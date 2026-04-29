"""Resume-driven Apify scraping pipeline.

Reads a resume (.txt / .md / .pdf-text), asks Claude to derive search
parameters for both Apify-backed sources (LinkedIn + Fantastic Jobs),
runs both, then ingests results into Supabase via the standard pipeline.

Usage:
    python scripts/scrape_with_resume.py path/to/resume.txt
    python scripts/scrape_with_resume.py path/to/resume.txt --dry-run
    python scripts/scrape_with_resume.py path/to/resume.txt --linkedin-only
    python scripts/scrape_with_resume.py path/to/resume.txt --fantastic-only

Required env:
    APIFY_TOKEN          — Apify API token
    ANTHROPIC_API_KEY    — Anthropic API key
    SUPABASE_URL, SUPABASE_KEY (or SUPABASE_SERVICE_ROLE_KEY) — for ingest

Optional env:
    RESUME_SCRAPE_MODEL  — Claude model id (default: claude-sonnet-4-5)
    RESUME_SCRAPE_LOCATION  — geographic preference passed to LLM
    RESUME_SCRAPE_REMOTE    — "remote" | "hybrid" | "onsite" | "any"
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

# Allow running from project root: `python scripts/scrape_with_resume.py ...`
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pydantic import BaseModel, Field

from src.logging_config import configure_logging, get_logger  # noqa: E402
from src.sources.linkedin import LinkedInScraper  # noqa: E402
from src.sources.fantastic_jobs import FantasticJobsScraper  # noqa: E402


DEFAULT_MODEL_ANTHROPIC = "claude-sonnet-4-5"
DEFAULT_MODEL_OPENAI = "gpt-4o-2024-08-06"
_HAS_ANTHROPIC = bool(os.getenv("ANTHROPIC_API_KEY"))
_HAS_OPENAI = bool(os.getenv("OPENAI_API_KEY"))
DEFAULT_MODEL = os.getenv(
    "RESUME_SCRAPE_MODEL",
    DEFAULT_MODEL_ANTHROPIC if _HAS_ANTHROPIC else DEFAULT_MODEL_OPENAI,
)


class ScrapePlan(BaseModel):
    """Structured search plan Claude derives from the resume."""

    linkedin_titles: list[str] = Field(
        default_factory=list,
        description='3-8 LinkedIn job titles for titleSearch. Add ":*" suffix '
                    'for prefix match (e.g. "Senior Data Engineer:*").',
    )
    linkedin_locations: list[str] = Field(
        default_factory=list,
        description='LinkedIn locations in "City, State, Country" format. '
                    'Empty list = no location filter.',
    )
    linkedin_descriptions: list[str] = Field(
        default_factory=list,
        description="2-6 keywords (skills, tech) to require in LinkedIn "
                    "title/description.",
    )
    fantastic_titles: list[str] = Field(
        default_factory=list,
        description='4-10 job titles for Fantastic Jobs titleSearch. Use ":*" '
                    'suffix to enable prefix match (e.g. "Data Engineer:*").',
    )
    fantastic_locations: list[str] = Field(
        default_factory=list,
        description='Locations in "City, State, Country" format. '
                    'Empty list = no location filter.',
    )
    fantastic_descriptions: list[str] = Field(
        default_factory=list,
        description="2-6 keywords (skills, tech) to require in title or description.",
    )
    years_min: float = Field(
        default=0,
        description="Minimum years of experience the candidate has. Used to "
                    "build the actor's aiExperienceLevelFilter (buckets: "
                    "0-2, 2-5, 5-10, 10+). Estimate from resume.",
    )
    years_max: float = Field(
        default=0,
        description="Maximum years of experience to target (typically the "
                    "candidate's actual years + a small headroom). Same "
                    "bucket logic as years_min.",
    )
    skills: list[str] = Field(
        default_factory=list,
        description="Top 10-20 skills extracted from the resume. Used "
                    "downstream for resume↔job matching.",
    )
    rationale: str = Field(
        default="",
        description="One short paragraph explaining why these search params "
                    "fit this resume. Shown to the operator.",
    )


SYSTEM_PROMPT = """You convert a candidate's resume into search parameters
for two Apify actors:
  - fantastic-jobs/career-site-job-listing-api  (career sites / 50+ ATS)
  - fantastic-jobs/advanced-linkedin-job-search-api  (LinkedIn proper)

The output is a ScrapePlan JSON object that the scraper passes to both
actors verbatim. Both actors share the same titleSearch / locationSearch /
descriptionSearch semantics.

ACTOR BEHAVIOR (must respect):
- titleSearch is the PRIMARY filter — fast, high recall, indexed.
  Lead with it. Append ":*" for prefix matching (e.g.
  "Senior Data Engineer:*" also matches "Senior Data Engineer II").
- descriptionSearch hits both title AND body but is "VERY intensive
  and at risk of time-out" per the actor's own docs. Keep it to 2-4
  high-signal keywords and ALWAYS combine with titleSearch.
- aiExperienceLevelFilter buckets are half-open: 0-2, 2-5, 5-10, 10+.
  Pick every bucket overlapping the candidate's [years_min, years_max]
  window. The scraper handles bucket selection — you just provide
  years_min and years_max.

EXTRACTION RULES:

1. fantastic_titles / linkedin_titles  (target 6-12 entries each):
   - Lead with the candidate's exact current/target title (use ":*").
   - Add immediately-adjacent seniority variants (Senior, Staff, Lead,
     Principal — mirror their actual tier and one above).
   - Add 2-4 closely-related role names from the same job family
     (e.g. for Data Engineer: Analytics Engineer, Data Platform
     Engineer, ETL Developer, Big Data Engineer, Streaming Engineer).
   - DO NOT include: Manager/Director/VP titles, generic "Software
     Engineer" unless the resume is software-engineer-first, or
     unrelated fields the candidate has only dabbled in.
   - Default: linkedin_titles == fantastic_titles unless the
     candidate's profile clearly favors one platform.

2. fantastic_descriptions / linkedin_descriptions  (2-4 entries, NEVER more):
   - Pick the candidate's most differentiated technical tokens — the
     ones that filter out generic listings. Prioritize:
     * Specialized frameworks (dbt, Spark, Kafka, Flink, Airflow)
     * Cloud warehouses (Snowflake, BigQuery, Databricks, Redshift)
     * Architectural patterns (lakehouse, streaming, real-time)
   - DO NOT include: generic words (python, sql, etl, aws, cloud),
     soft skills, certifications. Those flood results without filtering.

3. fantastic_locations / linkedin_locations:
   - locationSearch is a LITERAL token match. Country-only entries
     ("United States") miss most jobs whose location is "City, State,
     United States" — DO NOT use country names here.
   - Use specific cities only when the candidate is geo-locked to one
     metro: "Boston, Massachusetts, United States".
   - For "anywhere in the country" / "willing to relocate" / "remote",
     leave the array EMPTY. The scraper applies a country post-filter
     on countries_derived[] (default United States) for that case.
   - Format strictly "City, State/Region, Country" when used.

4. years_min / years_max:
   - Read total years from summary OR sum experience entries.
   - years_min = total - 1  (allow stretch down)
   - years_max = total + 3  (allow stretch up to next senior tier)

5. skills (10-20):
   - Concrete ATS-matchable tokens from Skills section + experience
     bullets. Lower-case, deduplicated. Used downstream for resume↔job
     matching, NOT for filtering at the actor.

6. rationale: One paragraph explaining your title choices and why the
   description keywords were picked over the alternatives. The operator
   reads this to sanity-check before the live (paid) run."""


def derive_plan(resume_text: str, hints: dict[str, str], model: str = DEFAULT_MODEL) -> ScrapePlan:
    """Call an LLM with the resume and return a structured ScrapePlan.

    Provider auto-detected from the model name (or ANTHROPIC/OPENAI key
    presence). Both Anthropic ``messages.parse`` and OpenAI
    ``chat.completions.parse`` produce a Pydantic ScrapePlan directly.
    """
    user_msg = (
        f"OPERATOR HINTS:\n"
        f"  preferred_location: {hints.get('location') or '(none)'}\n"
        f"  remote_preference:  {hints.get('remote') or 'any'}\n\n"
        f"RESUME:\n{resume_text}"
    )
    is_anthropic = model.lower().startswith("claude")
    if is_anthropic:
        import anthropic
        client = anthropic.Anthropic()
        parsed = client.messages.parse(
            model=model,
            system=SYSTEM_PROMPT,
            max_tokens=2048,
            messages=[{"role": "user", "content": user_msg}],
            output_format=ScrapePlan,
        )
        return parsed.parsed_output
    # OpenAI path (gpt-4o, gpt-4o-mini, gpt-5, etc.)
    from openai import OpenAI
    oai = OpenAI()
    completion = oai.chat.completions.parse(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        response_format=ScrapePlan,
    )
    msg = completion.choices[0].message
    if msg.parsed is None:
        raise RuntimeError(f"OpenAI refused or failed to parse: {msg.refusal!r}")
    return msg.parsed


def load_resume(path: Path) -> str:
    """Load resume text. .txt/.md as-is; .pdf via pypdf if installed."""
    suffix = path.suffix.lower()
    if suffix in (".txt", ".md"):
        return path.read_text(encoding="utf-8")
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError:
            raise SystemExit(
                "PDF resume given but pypdf not installed. "
                "Run: pip install pypdf"
            )
        reader = PdfReader(str(path))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    raise SystemExit(f"Unsupported resume extension: {suffix}")


def run_scrapers(
    plan: ScrapePlan,
    *,
    linkedin: bool = True,
    fantastic: bool = True,
    max_per_source: int = 100,
) -> tuple[list[Any], list[dict[str, Any]]]:
    """Run both Apify scrapers per the plan. Returns (jobs, raw_records)."""
    log = get_logger("scrape_with_resume")
    parsed: list[Any] = []
    raw_records: list[dict[str, Any]] = []

    if linkedin and (plan.linkedin_titles or plan.linkedin_descriptions):
        s = LinkedInScraper(
            titles=plan.linkedin_titles,
            locations=plan.linkedin_locations,
            descriptions=plan.linkedin_descriptions,
            max_items=max_per_source,
            date_posted_after=os.getenv("LINKEDIN_DATE_POSTED_AFTER") or None,
            time_range=os.getenv("LINKEDIN_TIME_RANGE") or None,
        )
        log.info("scrape_with_resume.linkedin.run",
                 titles=plan.linkedin_titles,
                 descriptions=plan.linkedin_descriptions)
        jobs, raws = s.run()
        parsed.extend(jobs)
        raw_records.extend(raws)
        s.close()

    if fantastic and (plan.fantastic_titles or plan.fantastic_descriptions):
        s = FantasticJobsScraper(
            titles=plan.fantastic_titles,
            locations=plan.fantastic_locations,
            descriptions=plan.fantastic_descriptions,
            years_min=plan.years_min or None,
            years_max=plan.years_max or None,
            max_items=max_per_source,
            date_posted_after=os.getenv("FANTASTIC_JOBS_DATE_POSTED_AFTER") or None,
            time_range=os.getenv("FANTASTIC_JOBS_TIME_RANGE") or None,
        )
        log.info(
            "scrape_with_resume.fantastic.run",
            titles=plan.fantastic_titles, descriptions=plan.fantastic_descriptions,
        )
        jobs, raws = s.run()
        parsed.extend(jobs)
        raw_records.extend(raws)
        s.close()

    return parsed, raw_records


def ingest(jobs: list[Any]) -> dict[str, Any]:
    """Push parsed jobs into Supabase via the standard storage backend."""
    from src.supabase_storage import SupabaseStorage
    storage = SupabaseStorage()
    result = storage.ingest(jobs)
    return result


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("resume", type=Path, nargs="?", default=None,
                   help="Path to resume file (.txt/.md/.pdf). Optional when "
                        "RESUME_SCRAPE_OVERRIDE_TITLES env is set — the dashboard "
                        "already derived the plan and the script bypasses LLM.")
    p.add_argument("--dry-run", action="store_true",
                   help="Derive plan + print, but do not call Apify")
    p.add_argument("--linkedin-only", action="store_true")
    p.add_argument("--fantastic-only", action="store_true")
    p.add_argument("--max-per-source", type=int, default=100)
    p.add_argument("--no-ingest", action="store_true",
                   help="Run scrapers but skip Supabase ingest")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--min-quality-score", type=int, default=50,
                   help="Drop jobs whose resume-fit score is below this (0-100).")
    p.add_argument("--no-quality-filter", action="store_true",
                   help="Disable the resume-fit quality filter (return raw scrape).")
    p.add_argument("--high-recall", action="store_true",
                   help="Maximize candidate pool: time_range=7d, drop "
                        "descriptionSearch, drop removeAgency, max_items=500. "
                        "Quality filter still applied — only the funnel widens.")
    p.add_argument("--time-range", default="",
                   help="Override actor timeRange (1h|24h|7d|6m). Defaults: "
                        "first run = 7d, later runs = incremental since last_run.")
    p.add_argument("--years-min", type=float, default=None,
                   help="Required: candidate's minimum years of experience. "
                        "Drives aiExperienceLevelFilter buckets and the YOE gate.")
    p.add_argument("--years-max", type=float, default=None,
                   help="Required: candidate's maximum years of experience.")
    p.add_argument("--profile-id", default="",
                   help="Stable identifier for incremental state (default: "
                        "sha1 of resume path). Reuse across runs to get only "
                        "jobs posted since the last run.")
    p.add_argument("--first-run", action="store_true",
                   help="Force time_range=7d and reset incremental state.")
    p.add_argument("--json-output", action="store_true",
                   help="Emit a single JSON object to stdout (jobs + discovered "
                        "plan info) instead of human-readable text. Used by "
                        "the HTTP wrapper (server.py).")
    args = p.parse_args(argv)

    # When emitting machine-readable JSON to stdout, redirect all informational
    # print() calls (that don't already specify file=sys.stderr) to stderr so
    # that stdout contains only the final JSON envelope.
    if args.json_output:
        import builtins as _builtins
        _real_print = _builtins.print
        def _stderr_print(*a, file=None, **kw):  # noqa: E306
            _real_print(*a, file=file if file is not None else sys.stderr, **kw)
        _builtins.print = _stderr_print

    has_overrides = bool(os.getenv("RESUME_SCRAPE_OVERRIDE_TITLES", "").strip())

    # Only require the resume file when we don't have an override plan.
    if not has_overrides:
        if args.resume is None:
            print("Resume path is required (or set RESUME_SCRAPE_OVERRIDE_TITLES)",
                  file=sys.stderr)
            return 2
        if not args.resume.exists():
            print(f"Resume file not found: {args.resume}", file=sys.stderr)
            return 2

    configure_logging()
    log = get_logger("scrape_with_resume")

    # LLM key only needed when we still have to derive the plan.
    if not has_overrides and not (os.getenv("ANTHROPIC_API_KEY") or os.getenv("OPENAI_API_KEY")):
        print("Set ANTHROPIC_API_KEY or OPENAI_API_KEY", file=sys.stderr)
        return 2

    # ── Override path: dashboard already derived titles/keywords/years via
    # gpt-4o-mini in resumeProfileService — skip PDF read + LLM call here.
    # Triggered when RESUME_SCRAPE_OVERRIDE_TITLES env is set.
    override_titles_raw = os.getenv("RESUME_SCRAPE_OVERRIDE_TITLES", "").strip()
    if override_titles_raw:
        def _split(env: str) -> list[str]:
            return [t.strip() for t in env.split(",") if t.strip()]
        titles = _split(override_titles_raw)
        keywords = _split(os.getenv("RESUME_SCRAPE_OVERRIDE_KEYWORDS", ""))
        skills = _split(os.getenv("RESUME_SCRAPE_OVERRIDE_SKILLS", ""))
        try:
            ymin_env = float(os.getenv("RESUME_SCRAPE_OVERRIDE_YEARS_MIN") or 0)
            ymax_env = float(os.getenv("RESUME_SCRAPE_OVERRIDE_YEARS_MAX") or 0)
        except ValueError:
            ymin_env, ymax_env = 0.0, 0.0
        plan = ScrapePlan(
            linkedin_titles=titles,
            fantastic_titles=titles,
            linkedin_descriptions=keywords,
            fantastic_descriptions=keywords,
            years_min=ymin_env,
            years_max=ymax_env,
            skills=skills or keywords,
            rationale="overrides supplied by dashboard (resumeProfileService)",
        )
        log.info("scrape_with_resume.plan.override",
                 titles=len(titles), keywords=len(keywords),
                 years_min=ymin_env, years_max=ymax_env)
    else:
        resume_text = load_resume(args.resume)
        hints = {
            "location": os.getenv("RESUME_SCRAPE_LOCATION", ""),
            "remote": os.getenv("RESUME_SCRAPE_REMOTE", ""),
        }
        log.info("scrape_with_resume.plan.start",
                 resume_chars=len(resume_text), model=args.model)
        plan = derive_plan(resume_text, hints, model=args.model)

    print("\n=== Derived ScrapePlan ===")
    print(json.dumps(plan.model_dump(), indent=2))
    print("=== Rationale ===")
    print(plan.rationale)
    print()

    if args.dry_run:
        return 0

    if not os.getenv("APIFY_TOKEN"):
        print("APIFY_TOKEN not set — cannot run scrapers", file=sys.stderr)
        return 2

    do_li = not args.fantastic_only
    do_fj = not args.linkedin_only

    # ---- Operator-supplied YOE override (always wins over LLM) ----
    if args.years_min is not None:
        plan.years_min = float(args.years_min)
    if args.years_max is not None:
        plan.years_max = float(args.years_max)
    if plan.years_max <= 0:
        print("ERROR: --years-min and --years-max are required (or set them "
              "in the resume so the LLM can derive them). The YOE filter is "
              "a hard gate.", file=sys.stderr)
        return 2

    # ---- Incremental state: only fetch jobs posted since last run ----
    import hashlib
    profile_id = args.profile_id or hashlib.sha1(
        str((args.resume.resolve() if args.resume else "no-resume")).encode("utf-8")).hexdigest()[:12]
    state_dir = ROOT / "data" / "find_jobs_state"
    state_dir.mkdir(parents=True, exist_ok=True)
    state_path = state_dir / f"{profile_id}.json"
    state: dict[str, Any] = {}
    if state_path.exists() and not args.first_run:
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            state = {}
    last_run_at: Optional[str] = state.get("last_run_at")
    is_first_run = not last_run_at or args.first_run

    # ---- Time-window resolution ----
    # First run (or --first-run): 7d snapshot.
    # Later runs: pass datePostedAfter=last_run_at; use a wide timeRange
    # so the actor doesn't double-restrict (timeRange + datePostedAfter
    # both apply; timeRange is server-side default).
    explicit_tr = args.time_range
    if args.high_recall:
        plan.fantastic_descriptions = []
        plan.linkedin_descriptions = []
        os.environ["FANTASTIC_JOBS_REMOVE_AGENCY"] = "false"
        if args.max_per_source < 500:
            args.max_per_source = 500
        time_range = explicit_tr or "7d"
    elif explicit_tr:
        time_range = explicit_tr
    elif is_first_run:
        time_range = "7d"
    else:
        # Incremental: pass last_run_at as datePostedAfter; widen actor
        # timeRange just enough to cover the gap (cap at 7d to control cost).
        time_range = "7d"

    os.environ["FANTASTIC_JOBS_TIME_RANGE"] = time_range
    os.environ["LINKEDIN_TIME_RANGE"] = time_range

    if not is_first_run and last_run_at:
        os.environ["FANTASTIC_JOBS_DATE_POSTED_AFTER"] = last_run_at
        os.environ["LINKEDIN_DATE_POSTED_AFTER"] = last_run_at
        log.info("scrape_with_resume.incremental",
                 last_run_at=last_run_at, profile_id=profile_id)
        print(f"Incremental run — fetching jobs posted after {last_run_at}")
    else:
        log.info("scrape_with_resume.first_run",
                 time_range=time_range, profile_id=profile_id)
        print(f"First run for profile {profile_id} — pulling {time_range} window")

    # Stamp the run timestamp BEFORE the scrape so the next run's window
    # starts where this one began (no gap, slight overlap acceptable since
    # canonical_key dedupe handles repeats downstream).
    from datetime import datetime as _dt, timezone as _tz
    new_run_at = _dt.now(_tz.utc).replace(microsecond=0).isoformat()

    jobs, raws = run_scrapers(
        plan, linkedin=do_li, fantastic=do_fj,
        max_per_source=args.max_per_source,
    )
    log.info("scrape_with_resume.scrape.done",
             parsed=len(jobs), raw=len(raws))
    print(f"Scraped: {len(jobs)} parsed, {len(raws)} raw")

    # Resume-fit quality filter — drops jobs that don't actually match the
    # candidate's stack/seniority despite passing the actor's title filter.
    if not args.no_quality_filter and jobs:
        from src.quality_filter import ResumeProfile, filter_jobs
        # Derive target_title_tokens from the LLM-picked titles (strip ":*")
        title_tokens = list({
            t.replace(":*", "").strip().lower()
            for t in (plan.fantastic_titles + plan.linkedin_titles) if t
        })
        from src.quality_filter import DEFAULT_EXCLUDE_TITLE_TOKENS
        # Auto-prune any default exclusion that overlaps the candidate's
        # own target titles or skills — e.g. "salesforce" should NOT be a
        # hard exclusion for a Salesforce Developer.
        candidate_terms = " ".join(title_tokens + [s.lower() for s in plan.skills])
        pruned_excludes = tuple(
            tok for tok in DEFAULT_EXCLUDE_TITLE_TOKENS
            if tok.strip() not in candidate_terms
        )
        profile = ResumeProfile(
            skills=[s.lower() for s in plan.skills],
            target_title_tokens=title_tokens,
            years_min=plan.years_min, years_max=plan.years_max,
            exclude_title_tokens=pruned_excludes,
        )
        scored = filter_jobs(jobs, profile, min_score=args.min_quality_score)
        kept_jobs = [j for (j, _, _) in scored]
        dropped = len(jobs) - len(kept_jobs)
        log.info("scrape_with_resume.quality_filter.done",
                 kept=len(kept_jobs), dropped=dropped,
                 min_score=args.min_quality_score)
        print(f"Quality filter: kept {len(kept_jobs)}, dropped {dropped} "
              f"(min score {args.min_quality_score})")
        # Print top 10 with scores so the operator sees what's coming.
        print("\nTop matches:")
        for (j, score, reasons) in scored[:10]:
            print(f"  [{score:>3d}] {j.job_title[:60]:60s}  @ {j.company_name[:25]}")
        jobs = kept_jobs

    # Persist state so the next run is incremental.
    state.update({
        "last_run_at": new_run_at,
        "years_min": plan.years_min,
        "years_max": plan.years_max,
        "resume_path": str(args.resume.resolve()) if args.resume else None,
        "kept_count": len(jobs),
    })
    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
    print(f"State saved → {state_path} (next run will fetch jobs posted after {new_run_at})")

    if args.json_output:
        # Emit a single JSON envelope to stdout for the HTTP wrapper.
        # Use dataclasses.asdict for JobPosting serialization; datetime → str.
        from dataclasses import asdict
        import datetime as _dt

        def _serialise(obj):
            if isinstance(obj, _dt.datetime):
                return obj.isoformat()
            raise TypeError(f"Not serialisable: {type(obj)}")

        jobs_payload = []
        for j in jobs:
            try:
                d = asdict(j)
            except Exception:
                # Fallback: build a minimal dict from known attributes.
                d = {
                    "title": getattr(j, "job_title", ""),
                    "company": getattr(j, "company_name", ""),
                    "url": getattr(j, "source_url", "") or getattr(j, "apply_url", ""),
                    "location": getattr(j, "location", None),
                    "remote_type": getattr(j, "remote_type", None),
                    "source": getattr(j, "source_platform", ""),
                    "snippet": getattr(j, "job_description_snippet", ""),
                    "date_posted": getattr(j, "date_posted_raw", None),
                }
            jobs_payload.append(d)

        envelope = {
            "jobs": jobs_payload,
            "discovered": {
                "titles": list({t.replace(":*", "").strip() for t in (plan.linkedin_titles + plan.fantastic_titles) if t}),
                "years_min": plan.years_min,
                "years_max": plan.years_max,
                "skills": plan.skills,
            },
        }
        sys.stdout.write(json.dumps(envelope, default=_serialise) + "\n")
        sys.stdout.flush()
        return 0

    if args.no_ingest:
        return 0

    result = ingest(jobs)
    log.info("scrape_with_resume.ingest.done", **result)
    print(f"Ingest: {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
