"""One-shot helper: reconstitute the latest audit JSON into an
EmployerDiscoveryReport, then call persist_report() to merge discovered
slugs into data/companies/*.txt.

Used to avoid re-running detect_domain for every URL after an expensive
audit has already classified them. Safe to delete after use.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.discovery.employers import EmployerDiscoveryReport, persist_report


def main() -> int:
    reports = sorted((ROOT / "data" / "reports").glob("discovery_audit_*.json"))
    if not reports:
        print("no discovery_audit_*.json found", file=sys.stderr)
        return 1
    path = reports[-1]
    print(f"using: {path.name}")
    doc = json.loads(path.read_text(encoding="utf-8"))

    emp = EmployerDiscoveryReport()
    for out in doc.get("outcomes", []):
        emp.checked += 1
        if out.get("error"):
            continue
        platform = out.get("platform")
        slug = out.get("slug")
        if platform and slug:
            emp.by_platform.setdefault(platform, []).append(slug)
        elif out.get("has_jsonld") and out.get("final_url"):
            emp.custom_jsonld.append(out["final_url"])
        else:
            emp.unknown.append(out.get("domain", ""))

    print("summary:", emp.summary())
    written = persist_report(emp)
    for k, v in sorted(written.items()):
        print(f"wrote: {k} -> {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
