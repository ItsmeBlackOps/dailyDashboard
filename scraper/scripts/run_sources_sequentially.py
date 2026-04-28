"""Sequential source runner — runs each source one at a time and records
per-source timing + row counts landed in Supabase.

Usage:
    python scripts/run_sources_sequentially.py [--target 100] [--sources a b c]

For each source:
  1. Snapshot pre-run `scraper_jobs_clean` count.
  2. Invoke `run_daily.py --source <name> --parallel 1 --target <N>`.
  3. Snapshot post-run count; record delta + wall-clock time.
  4. Append result to `data/reports/sequential_run_<ts>.json`.

Leaves the current scraper backend alone — this relies on `run_daily.py`
picking the Supabase backend when SUPABASE_URL is set in the environment.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

from src.sources.registry import all_scrapers


def _count_clean() -> int | None:
    """Return current row count in scraper_jobs_clean via Supabase, or None
    if Supabase isn't configured (falls back to noting N/A)."""
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_KEY"):
        return None
    try:
        from src.supabase_storage import SupabaseStorage
        return SupabaseStorage().count_clean()
    except Exception as e:
        print(f"[warn] count_clean failed: {e}", file=sys.stderr)
        return None


def _all_source_names() -> list[str]:
    return [s.name for s in all_scrapers()]


def main() -> int:
    ap = argparse.ArgumentParser(description="Run scraper sources sequentially.")
    ap.add_argument("--target", type=int, default=100,
                    help="Per-source target job count (passed through).")
    ap.add_argument("--sources", nargs="*",
                    help="Optional subset of source names; default = all.")
    ap.add_argument("--no-recency", action="store_true",
                    help="Pass --no-recency through to run_daily.py.")
    args = ap.parse_args()

    sources = args.sources or _all_source_names()
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    out_dir = ROOT / "data" / "reports"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"sequential_run_{ts}.json"

    summary: list[dict] = []
    print(f"[info] {len(sources)} sources, target={args.target}")
    print(f"[info] report -> {out_path.name}")

    baseline = _count_clean()
    print(f"[info] baseline jobs_clean={baseline}")

    for idx, name in enumerate(sources, 1):
        print(f"\n[{idx}/{len(sources)}] === {name} ===")
        before = _count_clean()
        t0 = time.monotonic()
        cmd = [sys.executable, "run_daily.py",
               "--source", name, "--parallel", "1",
               "--target", str(args.target)]
        if args.no_recency:
            cmd.append("--no-recency")
        try:
            rc = subprocess.call(cmd, cwd=str(ROOT), env=os.environ.copy())
        except KeyboardInterrupt:
            print("[warn] interrupted; writing partial report")
            break
        elapsed = time.monotonic() - t0
        after = _count_clean()
        delta = (after - before) if (before is not None and after is not None) else None
        row = {
            "source": name,
            "exit_code": rc,
            "elapsed_s": round(elapsed, 1),
            "before": before,
            "after": after,
            "delta": delta,
            "target": args.target,
        }
        summary.append(row)
        print(f"[{idx}/{len(sources)}] {name} rc={rc} elapsed={elapsed:.0f}s "
              f"before={before} after={after} delta={delta}")
        # Persist after every source (resumable).
        out_path.write_text(json.dumps({
            "started_at": ts,
            "target": args.target,
            "baseline": baseline,
            "results": summary,
        }, indent=2), encoding="utf-8")

    final = _count_clean()
    total_delta = (final - baseline) if (baseline is not None and final is not None) else None
    print(f"\n[done] final jobs_clean={final} total_delta={total_delta}")
    print(f"[done] report written to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
