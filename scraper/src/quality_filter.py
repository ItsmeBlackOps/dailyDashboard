"""Score parsed JobPostings against a candidate's resume profile.

Heuristic, transparent, no LLM calls.

Scoring philosophy (per operator spec):
  - **Title relevance and years-of-experience match are the gates.**
    Either alone is meaningful; both together is a strong fit.
  - Skill overlap is a *tiebreaker within the top band* (90-100), not a
    requirement. A job with the right title and right YOE clears the
    default keep threshold even with zero skill overlap on the actor's
    ai_key_skills list (which is itself spotty).

Weights:
  + Title family match            : 45 pts
  + YOE bucket overlaps window    : 45 pts
  + Per-skill bonus               : 1 pt each, capped at 10
  - Hard title exclusions (Manager/Intern/DBA-only/etc.) → score = 0

Score range [0, 100]. Default keep threshold: 50.
A perfect title + YOE match scores 90; full skill overlap pushes to 100.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Optional


# Title tokens that strongly indicate the role does NOT match an IC
# Senior Data Engineer profile. Tunable per profile if you have a
# different role family in mind.
DEFAULT_EXCLUDE_TITLE_TOKENS: tuple[str, ...] = (
    "manager", "director", "vp ", "vice president", "head of",
    "chief", "principal architect",
    "mainframe", "cobol", "db2 dba", "oracle dba", "pl/sql developer",
    "sap analyst", "dynamics 365",
    "intern", "internship", "entry level", "entry-level",
    "junior",  # mismatches a Senior profile
    "tableau developer", "power bi developer",  # report-only roles
    "salesforce", "workday consultant",
    # sales/consulting adjacent
    "presales", "pre-sales", "solutions engineer", "sales engineer",
    "customer success",
)


@dataclass
class ResumeProfile:
    """The minimal projection of a resume needed to score jobs."""

    skills: list[str] = field(default_factory=list)             # lower-case
    target_title_tokens: list[str] = field(default_factory=list)  # lower-case substrings
    years_min: float = 0.0
    years_max: float = 0.0
    seniority_label: str = ""                                    # e.g. "Senior"
    exclude_title_tokens: tuple[str, ...] = DEFAULT_EXCLUDE_TITLE_TOKENS


# Map ai_experience_level bucket → [lo, hi).
_BUCKET = {
    "0-2": (0, 2), "2-5": (2, 5), "5-10": (5, 10), "10+": (10, 99),
}


def _bucket_overlaps(level: Optional[str], lo: float, hi: float) -> bool:
    if not level:
        return True   # missing data — don't penalize
    for k, (b_lo, b_hi) in _BUCKET.items():
        if k in level:
            return b_hi > lo and b_lo < hi
    return True


def _job_skill_set(job_raw: dict[str, Any]) -> set[str]:
    """Pull skills from ai_key_skills first; fall back to title+description tokens."""
    skills = job_raw.get("ai_key_skills") or job_raw.get("_skills_normalized") or []
    if isinstance(skills, list) and skills:
        return {str(s).strip().lower() for s in skills if s}
    # Fallback: scrape title + description for token presence (less precise).
    text = " ".join([
        str(job_raw.get("title") or ""),
        str(job_raw.get("description_text") or job_raw.get("description") or ""),
    ]).lower()
    return {text}  # consumer will do substring matching against this single blob


def score_job(job: Any, profile: ResumeProfile) -> tuple[int, list[str]]:
    """Return (score 0-100, list of human-readable reasons).

    `job` is a JobPosting (with `.raw` dict + `.job_title`, `.seniority`).
    """
    reasons: list[str] = []
    raw = job.raw if hasattr(job, "raw") else (job if isinstance(job, dict) else {})
    title_lc = (job.job_title if hasattr(job, "job_title") else raw.get("title", "")).lower()

    # --- 1. Hard title exclusions (kill the score outright if hit) ----
    for tok in profile.exclude_title_tokens:
        if tok in title_lc:
            return 0, [f"excluded: title contains {tok!r}"]

    # --- 2. Title family match (PRIMARY gate, 45 pts) ----------------
    title_score = 0
    if profile.target_title_tokens:
        for tok in profile.target_title_tokens:
            if tok in title_lc:
                title_score = 45
                reasons.append(f"title contains {tok!r}")
                break
        else:
            reasons.append("title has no target-family token")

    # --- 3. Experience bucket overlap (PRIMARY gate, 45 pts) ----------
    exp_score = 0
    level = raw.get("ai_experience_level") or (
        job.seniority if hasattr(job, "seniority") else None
    )
    if profile.years_max > 0:
        if _bucket_overlaps(str(level) if level else "", profile.years_min, profile.years_max):
            exp_score = 45
            reasons.append(f"experience match: job={level!r} candidate={profile.years_min}-{profile.years_max}y")
        else:
            reasons.append(f"experience MISMATCH: job={level!r} candidate={profile.years_min}-{profile.years_max}y")
    else:
        # No years window provided → don't penalize.
        exp_score = 45
        reasons.append("experience: no candidate window, neutral")

    # --- 4. Skill overlap (tiebreaker bonus, 0-10 pts) ----------------
    # Only pushes top-tier matches into the 90+ band. Does NOT gate; a
    # job with right title + right YOE but spotty ai_key_skills still
    # passes the default 50 threshold easily.
    skill_score = 0
    skill_hits = 0
    if profile.skills:
        job_skills = _job_skill_set(raw)
        is_text_blob = len(job_skills) == 1 and len(next(iter(job_skills))) > 200
        if is_text_blob:
            blob = next(iter(job_skills))
            hits = [s for s in profile.skills if s in blob]
        else:
            hits = [s for s in profile.skills if s in job_skills]
        skill_hits = len(hits)
        skill_score = min(10, skill_hits)        # 1 pt each, capped at 10
        reasons.append(f"skill hits: {skill_hits}/{len(profile.skills)} (+{skill_score} bonus)")

    # Per operator: title relevance AND YOE match are MUST-HAVE gates.
    # If either fails, the job is dropped outright regardless of other signals.
    if profile.target_title_tokens and title_score == 0:
        return 0, reasons + ["GATE_FAIL: no target-family title token"]
    if profile.years_max > 0 and exp_score == 0:
        return 0, reasons + ["GATE_FAIL: experience window mismatch"]

    score = min(100, title_score + exp_score + skill_score)
    return score, reasons


def filter_jobs(
    jobs: Iterable[Any],
    profile: ResumeProfile,
    *,
    min_score: int = 50,
) -> list[tuple[Any, int, list[str]]]:
    """Score every job; return only those at or above min_score, sorted desc."""
    scored = [(j, *score_job(j, profile)) for j in jobs]
    kept = [t for t in scored if t[1] >= min_score]
    kept.sort(key=lambda t: t[1], reverse=True)
    return kept
