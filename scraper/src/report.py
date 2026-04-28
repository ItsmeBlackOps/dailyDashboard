"""Daily summary report."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import REPORT_DIR


def write_report(summary: dict[str, Any]) -> Path:
    ts = datetime.now(timezone.utc)
    path = Path(REPORT_DIR) / f"report_{ts.strftime('%Y-%m-%d')}.json"
    payload = {"generated_at_utc": ts.isoformat(), **summary}
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return path


def render_console(summary: dict[str, Any]) -> str:
    lines = [
        "",
        "=" * 60,
        " Daily Data Analyst Job Scrape — Summary",
        "=" * 60,
        f" Total fetched       : {summary.get('total_fetched', 0)}",
        f" Unique after dedupe : {summary.get('total_unique', 0)}",
        f" Exported (top N)    : {summary.get('total_exported', 0)}",
        f" Duplicates removed  : {summary.get('duplicates_removed', 0)}",
        f" Backlog (open)      : {summary.get('backlog_total', 0)}",
        f" Posted in last 24h  : {summary.get('last_24h', 0)}",
        " Per-source counts   :",
    ]
    for src, n in (summary.get("per_source") or {}).items():
        lines.append(f"   - {src:<22} {n}")
    cc = summary.get("classification_counts") or {}
    if cc:
        lines.append(" Classification      :")
        for bucket in ("new", "repost", "updated", "duplicate", "cross_dup", "uncertain"):
            n = cc.get(bucket, 0)
            if n:
                lines.append(f"   - {bucket:<22} {n}")
    swept = summary.get("marked_removed") or {}
    if swept:
        lines.append(" Marked removed      :")
        for src, n in swept.items():
            if n:
                lines.append(f"   - {src:<22} {n}")
    failed = summary.get("failed_sources") or []
    if failed:
        lines.append(" Failed sources      :")
        for f in failed:
            lines.append(f"   - {f}")
    lines.append("=" * 60)
    return "\n".join(lines)
