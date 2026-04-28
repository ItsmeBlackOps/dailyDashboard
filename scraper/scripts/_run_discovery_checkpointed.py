"""Checkpointing employer-discovery runner.

Reads data/seeds/us_employers.txt, runs ``detect_domain`` per domain with
configurable concurrency, and checkpoints a JSON report after every N
completions. If the process is killed mid-run, the partial report is
still usable by ``_merge_audit_to_companies.py``.

Outputs JSON + MD at the standard ``data/reports/discovery_audit_*.{json,md}``
paths so the merge script picks it up automatically.

Temp helper — safe to delete after this pass.
"""
from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from config import REPORT_DIR
from src.discovery.detect import detect_domain
from src.http_client import HttpClient
from src.logging_config import configure_logging, get_logger
from src.tools.audit_discovery import AuditReport, DomainOutcome

log = get_logger(__name__)

SEED_FILE = ROOT / "data" / "seeds" / "us_employers.txt"
CONCURRENCY = 6
CHECKPOINT_EVERY = 25
HTTP_TIMEOUT = 12.0


def _read_seed() -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for ln in SEED_FILE.read_text(encoding="utf-8").splitlines():
        s = ln.strip()
        if not s or s.startswith("#"):
            continue
        k = s.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
    return out


def _probe_one(domain: str, http: HttpClient) -> DomainOutcome:
    t0 = time.monotonic()
    try:
        res = detect_domain(domain, http=http)
    except Exception as e:
        return DomainOutcome(
            domain=domain, platform=None, slug=None, confidence=-1,
            final_url=None, has_jsonld=False, notes=None,
            elapsed_s=time.monotonic() - t0, error=f"{type(e).__name__}: {str(e)[:200]}",
        )
    return DomainOutcome(
        domain=domain,
        platform=res.platform,
        slug=res.slug,
        confidence=res.confidence,
        final_url=res.final_url,
        has_jsonld=res.has_jsonld,
        notes=res.notes,
        elapsed_s=time.monotonic() - t0,
        error=None,
    )


def _checkpoint(report: AuditReport, json_path: Path, md_path: Path) -> None:
    report.finalize()
    json_path.write_text(report.to_json(), encoding="utf-8")
    # minimal markdown
    lines = [
        "# Discovery audit (checkpoint)",
        f"- started_at: {report.started_at}",
        f"- finished_at: {report.finished_at}",
        f"- domains_checked: {report.domains_checked}",
        f"- total_elapsed_s: {report.total_elapsed_s:.1f}",
        "",
        "## By platform",
    ]
    for plat, n in sorted(report.by_platform.items()):
        lines.append(f"- {plat}: {n}")
    lines.append("")
    lines.append(f"- custom_jsonld: {report.custom_jsonld_count}")
    lines.append(f"- unknown: {report.unknown_count}")
    lines.append(f"- errors: {report.error_count}")
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    configure_logging()
    domains = _read_seed()
    print(f"[info] {len(domains)} domains to probe, concurrency={CONCURRENCY}", flush=True)

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    report_dir = Path(REPORT_DIR)
    report_dir.mkdir(parents=True, exist_ok=True)
    json_path = report_dir / f"discovery_audit_{ts}.json"
    md_path = report_dir / f"discovery_audit_{ts}.md"

    t0 = time.monotonic()
    started = datetime.now(timezone.utc).isoformat()

    report = AuditReport(
        started_at=started,
        finished_at=started,
        domains_checked=0,
        total_elapsed_s=0.0,
    )

    http = HttpClient(timeout=HTTP_TIMEOUT)
    try:
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            futs = {pool.submit(_probe_one, d, http): d for d in domains}
            done_count = 0
            for fut in as_completed(futs):
                domain = futs[fut]
                try:
                    outcome = fut.result()
                except Exception as e:
                    outcome = DomainOutcome(
                        domain=domain, platform=None, slug=None, confidence=-1,
                        final_url=None, has_jsonld=False, notes=None,
                        elapsed_s=0.0, error=f"{type(e).__name__}: {str(e)[:200]}",
                    )
                report.outcomes.append(outcome)
                done_count += 1
                report.domains_checked = done_count
                report.total_elapsed_s = time.monotonic() - t0
                report.finished_at = datetime.now(timezone.utc).isoformat()
                if done_count % CHECKPOINT_EVERY == 0:
                    _checkpoint(report, json_path, md_path)
                    print(f"[checkpoint] {done_count}/{len(domains)} "
                          f"elapsed={report.total_elapsed_s:.0f}s", flush=True)
    finally:
        http.close()

    _checkpoint(report, json_path, md_path)
    print(f"[done] {report.domains_checked}/{len(domains)} in "
          f"{report.total_elapsed_s:.0f}s", flush=True)
    print(f"[done] json={json_path.name} md={md_path.name}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
