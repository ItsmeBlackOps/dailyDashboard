"""Dynamically import COMPANY_TARGETS lists from a cloned JobPulse repo.

We treat the JobPulse crawler modules as the source of truth for company slugs
so we scale automatically whenever upstream adds more tenants. Pure AST parse —
we never execute the target files.
"""
from __future__ import annotations

import ast
from pathlib import Path
from typing import Optional

JOBPULSE_ROOT = Path(__file__).resolve().parents[2] / "external" / "JobPulse"

# map: our connector name -> (filename, key we care about)
_FILES = {
    "greenhouse": ("greenhouse_boards_crawler.py", "board_token"),
    "lever":      ("lever_postings_crawler.py", "slug"),
    "ashby":      ("ashby_job_boards_crawler.py", "board_token"),
    "workable":   ("workable_jobs_crawler.py", "slug"),
}


def _extract_targets(path: Path, key: str) -> list[str]:
    """AST-parse a JobPulse crawler file and return the list of slugs from
    its COMPANY_TARGETS literal. Aliases (e.g. slug / board_token / boardToken)
    are accepted."""
    aliases = {key, "slug", "board_token", "boardToken", "company"}
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, SyntaxError):
        return []

    for node in ast.walk(tree):
        # Match either `COMPANY_TARGETS = [...]` or `COMPANY_TARGETS: T = [...]`
        targets = getattr(node, "targets", None)
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) \
                and node.target.id == "COMPANY_TARGETS":
            value = node.value
        elif isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "COMPANY_TARGETS" for t in (targets or [])
        ):
            value = node.value
        else:
            continue
        if not isinstance(value, ast.List):
            return []
        out: list[str] = []
        for el in value.elts:
            if not isinstance(el, ast.Dict):
                continue
            for k, v in zip(el.keys, el.values):
                if isinstance(k, ast.Constant) and isinstance(v, ast.Constant) \
                        and isinstance(v.value, str) and k.value in aliases:
                    out.append(v.value.strip())
                    break
        # de-dupe, preserve order
        seen = set()
        uniq = []
        for s in out:
            if s and s.lower() not in seen:
                seen.add(s.lower())
                uniq.append(s)
        return uniq
    return []


def load_targets(source_name: str, root: Optional[Path] = None) -> list[str]:
    """Return JobPulse-sourced slugs for a given source, or [] if unavailable."""
    if source_name not in _FILES:
        return []
    filename, key = _FILES[source_name]
    base = root or JOBPULSE_ROOT
    path = base / filename
    if not path.exists():
        return []
    return _extract_targets(path, key)
