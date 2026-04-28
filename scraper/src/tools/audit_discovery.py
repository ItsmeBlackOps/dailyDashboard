"""Live-integration audit harness — exercise the discovery pipeline end-to-end.

Given a list of US employer domains, this tool runs ``detect.detect_domain``
against each one, collects the results into a structured report, and emits
both a JSON artifact and a human-readable markdown summary into
``data/reports/``.

This is the "25–50 real employer targets" validation step called out in
``docs/DISCOVERY_SYSTEM.md`` (section J.4) — the final checkpoint before a
first production cron.

Key properties
--------------
- **Stateless:** does not write to ``data/companies/``. Use
  ``src.discovery.employers.persist_report`` for that.
- **Tolerant:** one flaky domain never sinks the whole run (per-domain
  exceptions get swallowed and logged).
- **Reproducible:** the JSON artifact contains the full per-domain
  record so downstream analysis can diff runs.
- **Threaded:** concurrent per-domain fetches via ``HttpClient``, which
  keeps per-host throttling intact (distinct hosts parallelize, same
  host serializes).
- **Timing-aware:** tracks total wall-clock and per-domain latency so
  operators can identify slow employer sites.

CLI usage::

    python -m src.tools.audit_discovery acme.com,example.com
    python -m src.tools.audit_discovery --file domains.txt
    python -m src.tools.audit_discovery --env EMPLOYER_DOMAINS

Outputs::

    data/reports/discovery_audit_{YYYY-MM-DDTHH-MM-SS}.json
    data/reports/discovery_audit_{YYYY-MM-DDTHH-MM-SS}.md

Exit code is 0 unless the input domain list is empty.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

from config import REPORT_DIR
from src.discovery.detect import DetectionResult, detect_domain
from src.http_client import HttpClient
from src.logging_config import get_logger

log = get_logger(__name__)


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------

@dataclass
class DomainOutcome:
    """One domain's audit result — a DetectionResult plus timing."""

    domain: str
    platform: Optional[str]
    slug: Optional[str]
    confidence: int
    final_url: Optional[str]
    has_jsonld: bool
    notes: Optional[str]
    elapsed_s: float
    error: Optional[str] = None


@dataclass
class AuditReport:
    """Full per-run audit artifact."""

    started_at: str
    finished_at: str
    domains_checked: int
    total_elapsed_s: float
    outcomes: list[DomainOutcome] = field(default_factory=list)

    # Derived bucket counts — populated by ``finalize()``.
    by_platform: dict[str, int] = field(default_factory=dict)
    by_confidence: dict[str, int] = field(default_factory=dict)
    custom_jsonld_count: int = 0
    unknown_count: int = 0
    error_count: int = 0

    def finalize(self) -> None:
        """Populate the derived fields from ``outcomes``."""
        self.by_platform = {}
        self.by_confidence = {}
        self.custom_jsonld_count = 0
        self.unknown_count = 0
        self.error_count = 0
        for out in self.outcomes:
            if out.error:
                self.error_count += 1
                continue
            # confidence histogram
            key = str(out.confidence)
            self.by_confidence[key] = self.by_confidence.get(key, 0) + 1
            if out.platform and out.slug:
                self.by_platform[out.platform] = self.by_platform.get(out.platform, 0) + 1
            elif out.has_jsonld:
                self.custom_jsonld_count += 1
            elif out.confidence == -1:
                self.unknown_count += 1

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, sort_keys=True)


# --------------------------------------------------------------------------
# Core runner
# --------------------------------------------------------------------------

def audit_domains(
    domains: Iterable[str],
    *,
    concurrency: int = 8,
    http: Optional[HttpClient] = None,
) -> AuditReport:
    """Run detection against every domain and return a populated report."""
    normalized: list[str] = []
    seen: set[str] = set()
    for d in domains:
        if not d:
            continue
        d = d.strip()
        if not d:
            continue
        key = d.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(d)

    started = datetime.now(timezone.utc)
    t0 = time.perf_counter()
    own_http = http is None
    client = http or HttpClient(timeout=15.0)
    outcomes: list[DomainOutcome] = []
    try:
        if not normalized:
            log.info("audit.empty_input")
            report = AuditReport(
                started_at=_iso(started),
                finished_at=_iso(datetime.now(timezone.utc)),
                domains_checked=0,
                total_elapsed_s=0.0,
            )
            report.finalize()
            return report

        def _check(domain: str) -> DomainOutcome:
            start = time.perf_counter()
            try:
                result: DetectionResult = detect_domain(domain, http=client)
                return DomainOutcome(
                    domain=domain,
                    platform=result.platform,
                    slug=result.slug,
                    confidence=result.confidence,
                    final_url=result.final_url,
                    has_jsonld=result.has_jsonld,
                    notes=result.notes,
                    elapsed_s=round(time.perf_counter() - start, 3),
                )
            except Exception as exc:  # pragma: no cover — belt-and-braces
                log.exception("audit.error", domain=domain, error=str(exc))
                return DomainOutcome(
                    domain=domain,
                    platform=None,
                    slug=None,
                    confidence=-1,
                    final_url=None,
                    has_jsonld=False,
                    notes=None,
                    elapsed_s=round(time.perf_counter() - start, 3),
                    error=str(exc),
                )

        with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
            futures = [pool.submit(_check, d) for d in normalized]
            for fut in as_completed(futures):
                outcomes.append(fut.result())
    finally:
        if own_http:
            client.close()

    finished = datetime.now(timezone.utc)
    report = AuditReport(
        started_at=_iso(started),
        finished_at=_iso(finished),
        domains_checked=len(normalized),
        total_elapsed_s=round(time.perf_counter() - t0, 3),
        outcomes=sorted(outcomes, key=lambda o: o.domain.lower()),
    )
    report.finalize()
    log.info("audit.done",
             checked=report.domains_checked,
             platforms=len(report.by_platform),
             jsonld=report.custom_jsonld_count,
             unknown=report.unknown_count,
             errors=report.error_count,
             elapsed_s=report.total_elapsed_s)
    return report


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

def render_markdown(report: AuditReport) -> str:
    """Render the audit as an operator-friendly markdown document."""
    lines: list[str] = [
        "# Discovery Audit Report",
        "",
        f"- **Started:** {report.started_at}",
        f"- **Finished:** {report.finished_at}",
        f"- **Domains checked:** {report.domains_checked}",
        f"- **Total elapsed:** {report.total_elapsed_s:.2f}s",
        "",
        "## Summary",
        "",
    ]
    if report.domains_checked == 0:
        lines.append("_No domains supplied._")
        return "\n".join(lines) + "\n"

    platform_covered = sum(report.by_platform.values())
    total = report.domains_checked
    pct = (platform_covered / total * 100.0) if total else 0.0
    lines.extend([
        f"- **Platform-recognized:** {platform_covered} ({pct:.1f}%)",
        f"- **Custom JSON-LD (fallback-eligible):** {report.custom_jsonld_count}",
        f"- **Unknown / no-signal:** {report.unknown_count}",
        f"- **Errors:** {report.error_count}",
        "",
    ])

    if report.by_platform:
        lines.extend(["## Platform coverage", "", "| Platform | Slugs |", "|---|---|"])
        for plat in sorted(report.by_platform, key=lambda k: (-report.by_platform[k], k)):
            lines.append(f"| `{plat}` | {report.by_platform[plat]} |")
        lines.append("")

    if report.by_confidence:
        lines.extend(["## Confidence histogram", "", "| Confidence | Count |", "|---|---|"])
        for conf in sorted(report.by_confidence, key=lambda k: int(k), reverse=True):
            lines.append(f"| {_confidence_label(conf)} | {report.by_confidence[conf]} |")
        lines.append("")

    # Per-platform slug listings
    plat_to_slugs: dict[str, list[str]] = {}
    for out in report.outcomes:
        if out.platform and out.slug:
            plat_to_slugs.setdefault(out.platform, []).append(out.slug)
    if plat_to_slugs:
        lines.extend(["## Slugs by platform", ""])
        for plat in sorted(plat_to_slugs):
            slugs = sorted(set(plat_to_slugs[plat]))
            lines.extend([f"### `{plat}` ({len(slugs)})", ""])
            for s in slugs:
                lines.append(f"- `{s}`")
            lines.append("")

    # Review queues
    custom_urls = [o.final_url for o in report.outcomes
                   if o.has_jsonld and o.final_url and not o.platform]
    if custom_urls:
        lines.extend(["## Custom-site fallback candidates (JSON-LD detected)",
                      "", "Feed these to `CUSTOM_JSONLD_URLS` or let `employers.persist_report` handle it.", ""])
        for u in sorted(set(custom_urls)):
            lines.append(f"- {u}")
        lines.append("")

    unknown = [o.domain for o in report.outcomes
               if o.confidence == -1 and not o.error]
    if unknown:
        lines.extend(["## Unknown domains (no signal)", "",
                      "These returned no ATS fingerprint and no JSON-LD — operator review recommended.", ""])
        for d in sorted(set(unknown)):
            lines.append(f"- {d}")
        lines.append("")

    errors = [(o.domain, o.error) for o in report.outcomes if o.error]
    if errors:
        lines.extend(["## Errors", ""])
        for d, err in errors:
            lines.append(f"- `{d}` — {err}")
        lines.append("")

    return "\n".join(lines) + "\n"


def _confidence_label(conf_str: str) -> str:
    mapping = {
        "3": "3 (URL match)",
        "2": "2 (script/iframe)",
        "1": "1 (weak DOM/meta)",
        "0": "0 (JSON-LD only)",
        "-1": "-1 (no signal)",
    }
    return mapping.get(conf_str, conf_str)


def _iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


# --------------------------------------------------------------------------
# Persistence
# --------------------------------------------------------------------------

def write_report(report: AuditReport, *, out_dir: Optional[Path] = None,
                 timestamp: Optional[str] = None) -> tuple[Path, Path]:
    """Write the JSON artifact and markdown summary. Return both paths."""
    base = Path(out_dir) if out_dir is not None else Path(REPORT_DIR)
    base.mkdir(parents=True, exist_ok=True)
    ts = timestamp or _iso(datetime.now(timezone.utc)).replace(":", "-")
    json_path = base / f"discovery_audit_{ts}.json"
    md_path = base / f"discovery_audit_{ts}.md"
    json_path.write_text(report.to_json(), encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    return json_path, md_path


# --------------------------------------------------------------------------
# Input gathering
# --------------------------------------------------------------------------

def load_domains(
    *,
    csv_arg: Optional[str] = None,
    file_path: Optional[str] = None,
    env_name: Optional[str] = None,
) -> list[str]:
    """Gather domains from any of: CSV string, file, or env var. Union result."""
    domains: list[str] = []
    if csv_arg:
        domains.extend(s.strip() for s in csv_arg.split(",") if s.strip())
    if file_path:
        p = Path(file_path)
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                domains.append(line)
    if env_name:
        raw = os.getenv(env_name, "")
        domains.extend(s.strip() for s in raw.split(",") if s.strip())
    # Dedup preserving order
    seen: set[str] = set()
    ordered: list[str] = []
    for d in domains:
        k = d.lower()
        if k in seen:
            continue
        seen.add(k)
        ordered.append(d)
    return ordered


# --------------------------------------------------------------------------
# CLI entry
# --------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m src.tools.audit_discovery",
        description="Run an end-to-end discovery audit over a list of employer domains.",
    )
    p.add_argument("domains", nargs="?",
                   help="Comma-separated CSV of domains (optional if --file or --env given).")
    p.add_argument("--file", dest="file_path",
                   help="Path to a newline-separated domain list (# comments supported).")
    p.add_argument("--env", dest="env_name",
                   help="Name of an env var holding a CSV domain list (e.g. EMPLOYER_DOMAINS).")
    p.add_argument("--concurrency", type=int, default=8,
                   help="Parallel fetch workers (default 8).")
    p.add_argument("--out-dir", dest="out_dir", default=None,
                   help="Override the output directory (default data/reports).")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_parser().parse_args(argv)
    domains = load_domains(
        csv_arg=args.domains,
        file_path=args.file_path,
        env_name=args.env_name,
    )
    if not domains:
        print("No domains supplied. Pass a CSV argument, --file, or --env.", file=sys.stderr)
        return 2
    report = audit_domains(domains, concurrency=args.concurrency)
    json_path, md_path = write_report(
        report,
        out_dir=Path(args.out_dir) if args.out_dir else None,
    )
    print(f"Wrote {json_path}")
    print(f"Wrote {md_path}")
    # Echo top-line summary to stdout for CI consumption
    platform_covered = sum(report.by_platform.values())
    print(
        f"checked={report.domains_checked} "
        f"platform={platform_covered} "
        f"jsonld={report.custom_jsonld_count} "
        f"unknown={report.unknown_count} "
        f"errors={report.error_count}"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
