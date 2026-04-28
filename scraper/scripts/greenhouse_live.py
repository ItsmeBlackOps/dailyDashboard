"""Temp local live dashboard for a greenhouse-only scraper run.

Spawns `python run_daily.py --source greenhouse --target 1000`, parses
its stdout in real time for board-fetch events, and serves a tiny
auto-refreshing status page at http://127.0.0.1:8765.

Usage:
    python scripts/greenhouse_live.py

This file is intentionally self-contained — no frameworks — so it works
with just the stdlib already available to the scraper venv.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8765

STATE = {
    "started_at": time.time(),
    "boards_total": 1085,
    "boards_fetched": 0,
    "boards_missed": 0,
    "current_board": None,
    "raw_jobs_seen": 0,
    "recent_boards": [],
    "recent_misses": [],
    "last_event": None,
    "phase": "starting",
    "done": False,
    "exit_code": None,
}
STATE_LOCK = threading.Lock()

HTML = """<!doctype html>
<html>
<head>
<title>Greenhouse Live — scraper-rehabilitation</title>
<meta http-equiv="refresh" content="5">
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.4 system-ui, -apple-system, sans-serif; margin: 24px; max-width: 960px; }
  h1 { margin-bottom: 0; }
  .sub { color: #666; margin-top: 4px; margin-bottom: 18px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: 180px 1fr; gap: 6px 24px; align-items: center; }
  .label { color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  .value { font-weight: 600; font-size: 18px; }
  .bar { background: #e6e6e6; height: 24px; border-radius: 4px; overflow: hidden; position: relative; }
  .bar > div { background: linear-gradient(90deg, #4caf50, #66bb6a); height: 100%; transition: width 0.3s; }
  .bar span { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #222; }
  pre { background: #f4f4f4; padding: 10px 12px; border-radius: 4px; overflow-x: auto; font-size: 12px; }
  ul.recent { list-style: none; padding: 0; margin: 0; font-family: ui-monospace, monospace; font-size: 12px; }
  ul.recent li { padding: 2px 0; border-bottom: 1px solid #eee; }
  ul.recent li:last-child { border-bottom: 0; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .pill.running { background: #e3f2fd; color: #1565c0; }
  .pill.done { background: #e8f5e9; color: #2e7d32; }
  .pill.err { background: #ffebee; color: #c62828; }
  @media (prefers-color-scheme: dark) {
    body { background: #111; color: #ddd; }
    .bar { background: #333; }
    pre { background: #1a1a1a; color: #ddd; }
    ul.recent li { border-bottom: 1px solid #222; }
  }
</style>
</head>
<body>
<h1>Greenhouse Live</h1>
<p class="sub" id="sub">scraper-rehabilitation · <span id="phase" class="pill running">starting</span></p>

<div class="grid">
  <div class="label">Boards fetched</div>
  <div class="value"><span id="fetched">0</span> <span style="color:#888;font-weight:400">/ <span id="total">1085</span></span></div>

  <div class="label">Board misses</div>
  <div class="value" id="missed">0</div>

  <div class="label">Raw jobs seen</div>
  <div class="value" id="raw">0</div>

  <div class="label">Current board</div>
  <div class="value" id="current" style="font-family:ui-monospace,monospace;font-size:14px">—</div>

  <div class="label">Elapsed</div>
  <div class="value" id="elapsed">0s</div>

  <div class="label">ETA</div>
  <div class="value" id="eta">—</div>

  <div class="label">Progress</div>
  <div><div class="bar"><div id="pbar" style="width:0%"></div><span id="pct">0%</span></div></div>
</div>

<h3>Last log line</h3>
<pre id="last">(waiting…)</pre>

<h3>Recently fetched</h3>
<ul class="recent" id="recent"></ul>

<script>
async function tick() {
  try {
    const r = await fetch('/status.json');
    const s = await r.json();
    document.getElementById('fetched').textContent = s.boards_fetched;
    document.getElementById('total').textContent = s.boards_total;
    document.getElementById('missed').textContent = s.boards_missed;
    document.getElementById('raw').textContent = s.raw_jobs_seen;
    document.getElementById('current').textContent = s.current_board || '—';
    const el = Math.round(s.elapsed);
    document.getElementById('elapsed').textContent = el < 60 ? el + 's' : Math.floor(el/60) + 'm ' + (el%60) + 's';
    const fetched = s.boards_fetched + s.boards_missed;
    const rate = s.elapsed > 0 ? fetched / s.elapsed : 0;
    const remain = Math.max(0, s.boards_total - fetched);
    const etaSec = rate > 0 ? Math.round(remain / rate) : 0;
    document.getElementById('eta').textContent =
      s.done ? '—' :
      etaSec <= 0 ? '…' :
      etaSec < 60 ? etaSec + 's' :
      Math.floor(etaSec/60) + 'm ' + (etaSec%60) + 's';
    const pct = s.boards_total ? 100 * fetched / s.boards_total : 0;
    document.getElementById('pbar').style.width = pct.toFixed(1) + '%';
    document.getElementById('pct').textContent = pct.toFixed(1) + '%';
    document.getElementById('last').textContent = s.last_event || '—';
    const phase = document.getElementById('phase');
    phase.textContent = s.phase;
    phase.className = 'pill ' + (s.done ? (s.exit_code === 0 ? 'done' : 'err') : 'running');
    const ul = document.getElementById('recent');
    ul.innerHTML = '';
    (s.recent_boards || []).slice().reverse().forEach(b => {
      const li = document.createElement('li');
      li.textContent = b;
      ul.appendChild(li);
    });
  } catch (e) { console.error(e); }
}
setInterval(tick, 1000); tick();
</script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a, **kw):
        pass  # keep server silent

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML.encode("utf-8"))
            return
        if self.path == "/status.json":
            with STATE_LOCK:
                payload = dict(STATE)
                payload["elapsed"] = time.time() - payload["started_at"]
            body = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()


BOARD_FETCH_RE = re.compile(r"boards-api\.greenhouse\.io/v1/boards/([^/]+)/jobs")
BOARD_MISS_RE = re.compile(r"board\.miss.*board=([^\s]+)")
PHASE_HINTS = {
    "fetching": ["boards-api.greenhouse.io"],
    "ingesting": ["SupabaseStorage", "ingest", "rows_written"],
    "exporting": ["jobs_top", "Wrote jobs_top"],
}


def _update_phase(line: str) -> None:
    for phase, markers in PHASE_HINTS.items():
        if any(m in line for m in markers):
            STATE["phase"] = phase
            return


def run_scraper() -> int:
    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    proc = subprocess.Popen(
        [sys.executable, "run_daily.py", "--source", "greenhouse", "--target", "1000"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=1,
        text=True,
        env=env,
        cwd=repo_root,
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()
        if not line:
            continue
        with STATE_LOCK:
            STATE["last_event"] = line[:240]
            _update_phase(line)
            m = BOARD_FETCH_RE.search(line)
            if m:
                board = m.group(1)
                STATE["boards_fetched"] += 1
                STATE["current_board"] = board
                recent = STATE["recent_boards"]
                recent.append(board)
                if len(recent) > 30:
                    del recent[:-30]
            miss = BOARD_MISS_RE.search(line)
            if miss:
                STATE["boards_missed"] += 1
    proc.wait()
    with STATE_LOCK:
        STATE["done"] = True
        STATE["exit_code"] = proc.returncode
        STATE["phase"] = "done" if proc.returncode == 0 else "error"
    return proc.returncode


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"[live] dashboard http://127.0.0.1:{PORT}", flush=True)
    return run_scraper()


if __name__ == "__main__":
    raise SystemExit(main())
