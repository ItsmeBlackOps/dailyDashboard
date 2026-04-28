import express from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import 'dotenv/config';

const app = express();
app.use(express.json({ limit: '5mb' }));

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/tailor', async (req, res) => {
  const { candidate, jdText, jdMustHaves } = req.body || {};
  if (!candidate || !jdText) {
    return res.status(400).json({ success: false, error: 'candidate and jdText required' });
  }

  const slug = randomUUID().slice(0, 8);
  const candidatePath = path.join(os.tmpdir(), `cand-${slug}.json`);
  const jdPath = path.join(os.tmpdir(), `jd-${slug}.txt`);
  fs.writeFileSync(candidatePath, JSON.stringify(candidate, null, 2));
  fs.writeFileSync(jdPath, jdText);
  if (Array.isArray(jdMustHaves) && jdMustHaves.length) {
    fs.writeFileSync(jdPath.replace(/\.txt$/, '.must_haves.json'), JSON.stringify(jdMustHaves, null, 2));
  }

  const child = spawn('node', ['src/cli.js', 'test', '--candidate', candidatePath, '--jd', jdPath], {
    cwd: ROOT,
    env: process.env,
  });

  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  child.on('close', (code) => {
    try { fs.unlinkSync(candidatePath); } catch {}
    try { fs.unlinkSync(jdPath); } catch {}
    if (code !== 0) {
      return res.status(500).json({ success: false, error: 'forge exit ' + code, stderr: stderr.slice(-2000) });
    }
    // forge writes to output/<run-dir>/resume-final.json
    // find the most recent run dir
    const outDir = path.join(ROOT, 'output');
    const dirs = fs.readdirSync(outDir).filter(d => fs.statSync(path.join(outDir, d)).isDirectory());
    dirs.sort((a, b) => fs.statSync(path.join(outDir, b)).mtimeMs - fs.statSync(path.join(outDir, a)).mtimeMs);
    if (!dirs.length) return res.status(500).json({ success: false, error: 'no output produced', stderr: stderr.slice(-2000) });
    const finalPath = path.join(outDir, dirs[0], 'resume-final.json');
    if (!fs.existsSync(finalPath)) return res.status(500).json({ success: false, error: 'resume-final.json missing', stderr: stderr.slice(-2000) });

    const finalJson = JSON.parse(fs.readFileSync(finalPath, 'utf-8'));
    return res.json({ success: true, resume: finalJson, runDir: dirs[0], stderrTail: stderr.slice(-2000) });
  });
});

const PORT = process.env.PORT || 8002;
app.listen(PORT, '0.0.0.0', () => console.log(`forge-ai server listening on :${PORT}`));
