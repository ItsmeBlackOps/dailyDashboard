/**
 * generate-live-grid.js
 *
 * Pipeline: 10 jobs x 20 templates = 200 tailored PDFs via hosted ResumeForge API.
 *
 * Usage:
 *   node scripts/generate-live-grid.js
 *
 * Outputs:
 *   output/live-tailored/<job-id>.json   -- raw API response
 *   output/live-grid/<template>__<job>.html
 *   output/live-grid/<template>__<job>.pdf
 *   output/live-grid/index.html          -- Aurora-styled dashboard
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderHTML } from '../render.js';
import { htmlToPDF } from '../to-pdf.js';
import { validatePDF } from '../validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const TAILOR_API = 'https://resumeforge.silverspace.tech/tailor';
const CONCURRENCY = 3;
const TIMEOUT_MS = 300_000;

const TEMPLATES = [
  '01', '02', '03', '04', '05',
  '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15',
  '16', '17', '18', '19', '20',
];

// ---------------------------------------------------------------------------
// Semaphore
// ---------------------------------------------------------------------------
function makeSemaphore(limit) {
  let active = 0;
  const queue = [];
  return function acquire() {
    return new Promise((resolve) => {
      const attempt = () => {
        if (active < limit) {
          active++;
          resolve(() => {
            active--;
            if (queue.length) queue.shift()();
          });
        } else {
          queue.push(attempt);
        }
      };
      attempt();
    });
  };
}

// ---------------------------------------------------------------------------
// Adapter: API response -> template input shape
// ---------------------------------------------------------------------------
function adaptForgeToTemplate(forgeResume, candidate, job) {
  const parseDates = (d) => {
    const parts = String(d ?? '').split(/\s*-\s*/);
    return { startDate: parts[0]?.trim() || '', endDate: parts[1]?.trim() || '' };
  };
  return {
    name: candidate.name,
    title: forgeResume.title_line || job.title,
    contact: {
      email: candidate.contact?.email || '',
      phone: candidate.contact?.phone || '',
      linkedin: candidate.contact?.linkedin || '',
      location: candidate.location || '',
    },
    summary: forgeResume.summary || '',
    skills: forgeResume.skills || {},
    experience: (forgeResume.experience || []).map((e) => ({
      company: e.company,
      role: e.title,
      location: e.location || '',
      ...parseDates(e.dates),
      bullets: e.bullets || [],
    })),
    education: (candidate.education || []).map((edu) => ({
      school: edu.school,
      degree: edu.degree,
      location: edu.location || '',
      startDate: '',
      endDate: edu.graduated || '',
    })),
    projects: (forgeResume.projects || []).map((p) => ({
      name: p.name,
      technologies: p.tech || [],
      bullets: p.outcome ? [p.outcome] : [],
    })),
    certifications: candidate.certifications || [],
  };
}

// ---------------------------------------------------------------------------
// ASCII sanitiser - strips non-ASCII for ATS safety
// ---------------------------------------------------------------------------
function toAscii(html) {
  return html.replace(/[^\x00-\x7E]/g, (c) => {
    const map = {
      '–': '-', '—': '-', '‘': "'", '’': "'",
      '“': '"', '”': '"', '•': '-', ' ': ' ',
    };
    return map[c] || ' ';
  });
}

// ---------------------------------------------------------------------------
// Call the hosted API
// ---------------------------------------------------------------------------
async function callForgeAPI(candidate, job) {
  const body = {
    candidate,
    jd_text: job.jd_text,
    must_haves: job.must_haves,
  };

  const res = await fetch(TAILOR_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '(no body)');
    throw new Error(`HTTP ${res.status} from API: ${txt.slice(0, 200)}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Render + PDF for one (templateId, job, forgeResume) combination
// ---------------------------------------------------------------------------
async function renderOne(templateId, job, forgeResume, candidate) {
  const templateResume = adaptForgeToTemplate(forgeResume, candidate, job);
  const htmlRaw = await renderHTML(templateId, templateResume);
  const html = toAscii(htmlRaw);

  const baseName = `${templateId}__${job.id}`;
  const htmlPath = path.join(ROOT, 'output', 'live-grid', `${baseName}.html`);
  const pdfPath = path.join(ROOT, 'output', 'live-grid', `${baseName}.pdf`);

  fs.writeFileSync(htmlPath, html, 'utf-8');

  try {
    htmlToPDF(htmlPath, pdfPath);
  } catch (err) {
    return { templateId, jobId: job.id, baseName, status: 'fail', issues: [`PDF render error: ${err.message}`], warnings: [], pages: 0, size: 0 };
  }

  if (!fs.existsSync(pdfPath)) {
    return { templateId, jobId: job.id, baseName, status: 'fail', issues: ['PDF file not created'], warnings: [], pages: 0, size: 0 };
  }

  let validation;
  try {
    validation = validatePDF(pdfPath, job.must_haves);
  } catch (err) {
    return { templateId, jobId: job.id, baseName, status: 'warn', issues: [], warnings: [`Validation error: ${err.message}`], pages: 0, size: 0 };
  }

  const status = !validation.ok ? 'fail' : (validation.warnings?.length ? 'warn' : 'pass');
  return {
    templateId,
    jobId: job.id,
    baseName,
    status,
    issues: validation.issues || [],
    warnings: validation.warnings || [],
    pages: validation.pages || 0,
    size: validation.size || 0,
  };
}

// ---------------------------------------------------------------------------
// Build index.html
// ---------------------------------------------------------------------------
function buildIndex(jobs, results, apiResults) {
  const jobBlocks = jobs.map((job) => {
    const jobResults = results.filter((r) => r.jobId === job.id);
    const apiData = apiResults[job.id];
    const passCount = jobResults.filter((r) => r.status === 'pass').length;
    const warnCount = jobResults.filter((r) => r.status === 'warn').length;
    const failCount = jobResults.filter((r) => r.status === 'fail').length;
    const iterations = apiData?.meta?.iterations ?? '-';
    const latencyS = apiData?.meta?.latency_ms ? (apiData.meta.latency_ms / 1000).toFixed(1) + 's' : '-';
    const coverage = apiData?.keyword_coverage?.coverage != null
      ? (apiData.keyword_coverage.coverage * 100).toFixed(0) + '%'
      : '-';
    const apiPassed = apiData?.validation?.pass;

    const cards = jobResults.map((r) => {
      const badgeClass = r.status;
      const badgeLabel = r.status.toUpperCase();
      const issuesHtml = [...r.issues, ...r.warnings]
        .map((i) => `<div class="issue">${i}</div>`).join('');
      return `
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:13px;font-weight:600">Template ${r.templateId}</span>
            <span class="badge ${badgeClass}">${badgeLabel}</span>
          </div>
          <div style="font-size:11px;color:#888;margin-bottom:8px">${r.pages}p &middot; ${(r.size / 1024).toFixed(0)}KB</div>
          ${issuesHtml}
          <div style="margin-top:8px">
            <a href="${r.baseName}.html" target="_blank">HTML</a>
            <a href="${r.baseName}.pdf" target="_blank">PDF</a>
            <a href="../live-tailored/${job.id}.json" target="_blank">JSON</a>
          </div>
        </div>`;
    }).join('\n');

    return `
      <div class="job-block">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div>
            <h2 style="margin:0 0 4px;font-size:18px">${job.title} <span style="color:#888;font-weight:400">@ ${job.company}</span></h2>
            <div class="job-meta">${job.location} &middot; ${job.remote_type} &middot; ${job.ats}</div>
          </div>
          <div style="text-align:right;font-size:12px;color:#aaa;line-height:1.8">
            <div>Iterations: <strong style="color:#fff">${iterations}</strong></div>
            <div>API latency: <strong style="color:#fff">${latencyS}</strong></div>
            <div>Keyword coverage: <strong style="color:#22d3ee">${coverage}</strong></div>
            <div>API validation: <strong style="color:${apiPassed ? '#34d399' : '#fb7185'}">${apiPassed ? 'PASS' : 'FAIL'}</strong></div>
            <div style="margin-top:4px">
              <span class="badge pass">${passCount} PASS</span>&nbsp;
              <span class="badge warn">${warnCount} WARN</span>&nbsp;
              <span class="badge fail">${failCount} FAIL</span>
            </div>
          </div>
        </div>
        <div class="grid" style="margin-top:12px">${cards}</div>
      </div>`;
  }).join('\n');

  const totalPass = results.filter((r) => r.status === 'pass').length;
  const totalWarn = results.filter((r) => r.status === 'warn').length;
  const totalFail = results.filter((r) => r.status === 'fail').length;
  const apiSuccessCount = Object.keys(apiResults).filter((k) => apiResults[k] && !apiResults[k]._error).length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ResumeForge Live Grid - ${results.length} Tailored PDFs</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: 'Inter Tight', system-ui, sans-serif; background: #07060c; color: #fff; padding: 24px; margin: 0; }
  h1 { font-family: 'Bricolage Grotesque', serif; font-size: 32px; margin: 0 0 4px; background: linear-gradient(135deg, #22d3ee, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  h2 { font-family: 'Bricolage Grotesque', serif; }
  .subtitle { color: #888; font-size: 14px; margin-bottom: 24px; }
  .stats-bar { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 28px; }
  .stat { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 12px 20px; }
  .stat-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.08em; }
  .stat-value { font-size: 24px; font-weight: 700; }
  .job-block { background: #1a1726; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  .job-meta { color: #888; font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
  .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; transition: border-color 0.2s; }
  .card:hover { border-color: rgba(255,255,255,0.2); }
  .card a { color: #22d3ee; text-decoration: none; margin-right: 12px; font-size: 12px; }
  .card a:hover { text-decoration: underline; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .badge.pass { background: rgba(52,211,153,0.18); color: #34d399; }
  .badge.warn { background: rgba(251,191,36,0.18); color: #fbbf24; }
  .badge.fail { background: rgba(251,113,133,0.18); color: #fb7185; }
  .issue { font-size: 10px; color: #f87171; margin-top: 3px; line-height: 1.4; }
  footer { margin-top: 40px; text-align: center; color: #444; font-size: 12px; }
</style>
</head>
<body>
<h1>ResumeForge Live Grid</h1>
<p class="subtitle">${results.length} PDFs &middot; ${jobs.length} jobs &times; ${TEMPLATES.length} templates &middot; tailored via ${TAILOR_API}</p>
<div class="stats-bar">
  <div class="stat"><div class="stat-label">API calls</div><div class="stat-value" style="color:#22d3ee">${apiSuccessCount} / ${jobs.length}</div></div>
  <div class="stat"><div class="stat-label">PDFs generated</div><div class="stat-value">${results.length}</div></div>
  <div class="stat"><div class="stat-label">PASS</div><div class="stat-value" style="color:#34d399">${totalPass}</div></div>
  <div class="stat"><div class="stat-label">WARN</div><div class="stat-value" style="color:#fbbf24">${totalWarn}</div></div>
  <div class="stat"><div class="stat-label">FAIL</div><div class="stat-value" style="color:#fb7185">${totalFail}</div></div>
</div>
${jobBlocks}
<footer>Generated ${new Date().toISOString()} &middot; http://localhost:4173/live-grid/</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const candidatePath = path.join(ROOT, 'test-data', 'candidate-rathin-forge.json');
  const jobsPath = path.join(ROOT, 'test-data', 'jobs-live.json');

  const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf-8'));
  const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf-8'));

  const outTailored = path.join(ROOT, 'output', 'live-tailored');
  const outGrid = path.join(ROOT, 'output', 'live-grid');
  fs.mkdirSync(outTailored, { recursive: true });
  fs.mkdirSync(outGrid, { recursive: true });

  console.log(`\nResumeForge live-grid generation`);
  console.log(`  ${jobs.length} jobs x ${TEMPLATES.length} templates = ${jobs.length * TEMPLATES.length} PDFs expected`);
  console.log(`  API: ${TAILOR_API}`);
  console.log(`  Concurrency: ${CONCURRENCY} simultaneous API calls\n`);

  const wallStart = Date.now();
  const acquire = makeSemaphore(CONCURRENCY);

  // Step 1: Call the API for all jobs with concurrency limit
  const apiResults = {};
  const apiLatencies = [];

  const apiTasks = jobs.map(async (job) => {
    const release = await acquire();
    const t0 = Date.now();
    console.log(`[API] Starting: ${job.id} - ${job.title} @ ${job.company}`);
    try {
      const data = await callForgeAPI(candidate, job);
      const latencyMs = Date.now() - t0;
      apiLatencies.push(latencyMs);
      apiResults[job.id] = data;
      fs.writeFileSync(
        path.join(outTailored, `${job.id}.json`),
        JSON.stringify(data, null, 2),
        'utf-8'
      );
      const coverage = data.keyword_coverage?.coverage != null
        ? (data.keyword_coverage.coverage * 100).toFixed(0) + '%'
        : '?%';
      console.log(`[API] Done: ${job.id} in ${(latencyMs / 1000).toFixed(1)}s | coverage=${coverage} | iterations=${data.meta?.iterations ?? '?'}`);
    } catch (err) {
      const latencyMs = Date.now() - t0;
      apiLatencies.push(latencyMs);
      console.error(`[API] FAILED: ${job.id} - ${err.message}`);
      apiResults[job.id] = { _error: err.message, resume: null };
      fs.writeFileSync(
        path.join(outTailored, `${job.id}.json`),
        JSON.stringify({ _error: err.message }, null, 2),
        'utf-8'
      );
    } finally {
      release();
    }
  });

  await Promise.all(apiTasks);

  console.log(`\n[RENDER] All API calls complete. Rendering ${jobs.length * TEMPLATES.length} PDFs...\n`);

  // Step 2: Render all 200 PDFs
  const allResults = [];
  let pdfCount = 0;

  for (const job of jobs) {
    const apiData = apiResults[job.id];
    if (!apiData || apiData._error || !apiData.resume) {
      console.warn(`[RENDER] Skipping ${job.id} - no valid API response`);
      // Record failures for all templates
      for (const templateId of TEMPLATES) {
        allResults.push({
          templateId,
          jobId: job.id,
          baseName: `${templateId}__${job.id}`,
          status: 'fail',
          issues: [`API call failed: ${apiData?._error || 'unknown'}`],
          warnings: [],
          pages: 0,
          size: 0,
        });
      }
      continue;
    }

    const forgeResume = apiData.resume;
    console.log(`[RENDER] ${job.id}: rendering ${TEMPLATES.length} templates...`);

    for (const templateId of TEMPLATES) {
      try {
        const result = await renderOne(templateId, job, forgeResume, candidate);
        allResults.push(result);
        pdfCount++;
        if (result.status !== 'pass') {
          console.log(`  [${result.status.toUpperCase()}] ${templateId}__${job.id} issues=${result.issues.length} warns=${result.warnings.length}`);
        }
      } catch (err) {
        console.error(`  [FAIL] ${templateId}__${job.id}: ${err.message}`);
        allResults.push({
          templateId,
          jobId: job.id,
          baseName: `${templateId}__${job.id}`,
          status: 'fail',
          issues: [err.message],
          warnings: [],
          pages: 0,
          size: 0,
        });
      }
    }
    console.log(`[RENDER] ${job.id}: done (${pdfCount} PDFs so far)`);
  }

  // Step 3: Build index.html
  console.log(`\n[INDEX] Building index.html...`);
  const indexHtml = buildIndex(jobs, allResults, apiResults);
  fs.writeFileSync(path.join(outGrid, 'index.html'), indexHtml, 'utf-8');

  // Step 4: Print final report
  const wallMs = Date.now() - wallStart;
  const wallMin = (wallMs / 60000).toFixed(1);
  const avgLatency = apiLatencies.length
    ? (apiLatencies.reduce((a, b) => a + b, 0) / apiLatencies.length / 1000).toFixed(1)
    : 0;
  const apiSuccessCount = Object.values(apiResults).filter((v) => v && !v._error).length;
  const apiFailCount = jobs.length - apiSuccessCount;
  const passCount = allResults.filter((r) => r.status === 'pass').length;
  const warnCount = allResults.filter((r) => r.status === 'warn').length;
  const failCount = allResults.filter((r) => r.status === 'fail').length;

  console.log(`
==========================================================
ResumeForge live-grid generation
- ${apiSuccessCount} API calls succeeded / ${apiFailCount} failed
- ${pdfCount} PDFs generated
- ${passCount} PASS / ${warnCount} WARN / ${failCount} FAIL
- avg API latency: ${avgLatency}s
- total wallclock: ~${wallMin} min

Browse at: http://localhost:4173/live-grid/
==========================================================
`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
