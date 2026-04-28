import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTemplates, renderHTML } from '../render.js';
import { htmlToPDF } from '../to-pdf.js';
import { validateHTML, validatePDF } from '../validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const GRID_DIR = path.join(ROOT, 'output', 'grid');
const TEST_DATA = path.join(ROOT, 'test-data');

fs.mkdirSync(GRID_DIR, { recursive: true });

const resume = JSON.parse(fs.readFileSync(path.join(TEST_DATA, 'sample-rathin.json'), 'utf-8'));
const jobs = JSON.parse(fs.readFileSync(path.join(TEST_DATA, 'jobs.json'), 'utf-8'));
const templates = await listTemplates();

console.log(`Generating ${templates.length} templates x ${jobs.length} jobs = ${templates.length * jobs.length} outputs`);

const results = [];

for (const tpl of templates) {
  for (const job of jobs) {
    const resumeWithJob = { ...resume, _jobContext: job };
    const baseName = `${tpl.id}__${job.company.replace(/\W+/g, '-')}`;
    const htmlPath = path.join(GRID_DIR, `${baseName}.html`);
    const pdfPath = path.join(GRID_DIR, `${baseName}.pdf`);

    let status = 'FAIL', pages = null, sizeKB = null, issues = [], warnings = [];
    try {
      const html = await renderHTML(tpl.id, resumeWithJob);
      fs.writeFileSync(htmlPath, html);
      const htmlV = validateHTML(html);
      if (htmlV.ok) {
        htmlToPDF(htmlPath, pdfPath);
        const pdfV = validatePDF(pdfPath, job.must_haves || []);
        status = pdfV.ok ? 'PASS' : 'FAIL';
        pages = pdfV.pages;
        sizeKB = Math.round(pdfV.size / 1024);
        issues = pdfV.issues;
        warnings = pdfV.warnings || [];
      } else {
        issues = htmlV.issues;
      }
    } catch (err) {
      status = 'ERROR';
      issues = [err.message.slice(0, 100)];
    }

    results.push({
      tplId: tpl.id,
      tplLabel: tpl.label,
      jobId: job.id,
      jobTitle: job.title,
      jobCompany: job.company,
      baseName,
      status,
      pages,
      sizeKB,
      issues,
      warnings,
    });

    const badge = status === 'PASS' ? 'PASS' : status === 'ERROR' ? 'ERR' : 'FAIL';
    console.log(`  ${badge} | ${tpl.id} x ${job.company} | pages:${pages} | ${issues.join('; ').slice(0,80) || 'ok'}`);
  }
}

// Save results JSON
fs.writeFileSync(path.join(ROOT, 'output', 'grid-results.json'), JSON.stringify(results, null, 2));

// Build index.html
const passCount = results.filter(r => r.status === 'PASS').length;
const failCount = results.filter(r => r.status !== 'PASS').length;
const warnCount = results.filter(r => r.warnings?.length > 0).length;

// Group by template
const byTemplate = {};
for (const r of results) {
  if (!byTemplate[r.tplId]) byTemplate[r.tplId] = { label: r.tplLabel, rows: [] };
  byTemplate[r.tplId].rows.push(r);
}

const templateSections = Object.entries(byTemplate).map(([tplId, { label, rows }]) => {
  const cards = rows.map(r => {
    const badgeClass = r.status === 'PASS' ? 'badge-pass' : 'badge-fail';
    const badgeText = r.status;
    const warnBadge = r.warnings?.length ? `<span class="badge-warn">WARN</span>` : '';
    const issueText = r.issues.join(' | ').slice(0, 100) || '';
    const warnText = r.warnings?.join(' | ').slice(0, 100) || '';
    return `
    <div class="card">
      <div class="card-header">
        <div class="card-job">${r.jobTitle}</div>
        <div class="card-company">${r.jobCompany}</div>
        <div class="card-badges">
          <span class="${badgeClass}">${badgeText}</span>${warnBadge}
        </div>
      </div>
      <div class="card-meta">
        ${r.pages ? `${r.pages}p` : ''} ${r.sizeKB ? `${r.sizeKB}KB` : ''}
      </div>
      ${issueText ? `<div class="card-issue">${issueText}</div>` : ''}
      ${warnText ? `<div class="card-warn-text">${warnText}</div>` : ''}
      <div class="card-links">
        <a href="grid/${r.baseName}.html" target="_blank">HTML</a>
        <a href="grid/${r.baseName}.pdf" target="_blank">PDF</a>
      </div>
    </div>`;
  }).join('\n');

  return `
  <section class="tpl-section">
    <h2 class="tpl-heading">${label} <span class="tpl-id">(${tplId})</span></h2>
    <div class="card-grid">
      ${cards}
    </div>
  </section>`;
}).join('\n');

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Resume Templates Grid</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: #0f1117;
    color: #e2e8f0;
    font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
    font-size: 13px;
    line-height: 1.5;
  }
  header.top-bar {
    background: linear-gradient(135deg, #1e2a4a 0%, #0f1a2e 100%);
    border-bottom: 1px solid #2d3a5a;
    padding: 18px 32px;
    display: flex;
    align-items: center;
    gap: 24px;
  }
  header.top-bar h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: #7dd3fc;
    letter-spacing: -0.3px;
  }
  .top-stats {
    display: flex;
    gap: 16px;
    margin-left: auto;
  }
  .stat {
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
  }
  .stat-pass { background: #14532d; color: #86efac; }
  .stat-fail { background: #7f1d1d; color: #fca5a5; }
  .stat-warn { background: #713f12; color: #fde68a; }
  .stat-total { background: #1e3a5f; color: #93c5fd; }
  main {
    max-width: 1400px;
    margin: 0 auto;
    padding: 24px 32px;
  }
  .tpl-section {
    margin-bottom: 32px;
  }
  h2.tpl-heading {
    font-size: 15px;
    font-weight: 700;
    color: #94a3b8;
    border-bottom: 1px solid #1e2a4a;
    padding-bottom: 8px;
    margin: 0 0 12px;
  }
  .tpl-id {
    font-weight: 400;
    font-size: 12px;
    color: #475569;
  }
  .card-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 12px;
  }
  .card {
    background: #1a2035;
    border: 1px solid #2d3a5a;
    border-radius: 8px;
    padding: 12px;
    transition: border-color 0.15s;
  }
  .card:hover {
    border-color: #4a6fa5;
  }
  .card-header {
    margin-bottom: 6px;
  }
  .card-job {
    font-size: 11px;
    font-weight: 600;
    color: #cbd5e1;
    margin-bottom: 1px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-company {
    font-size: 12px;
    font-weight: 700;
    color: #7dd3fc;
    margin-bottom: 4px;
  }
  .card-badges {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .badge-pass {
    background: #14532d;
    color: #86efac;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .badge-fail {
    background: #7f1d1d;
    color: #fca5a5;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .badge-warn {
    background: #713f12;
    color: #fde68a;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .card-meta {
    font-size: 10px;
    color: #64748b;
    margin-bottom: 4px;
  }
  .card-issue {
    font-size: 10px;
    color: #f87171;
    margin-bottom: 4px;
    word-break: break-word;
  }
  .card-warn-text {
    font-size: 10px;
    color: #fbbf24;
    margin-bottom: 4px;
    word-break: break-word;
  }
  .card-links {
    display: flex;
    gap: 8px;
  }
  .card-links a {
    font-size: 11px;
    font-weight: 600;
    color: #60a5fa;
    text-decoration: none;
    padding: 2px 8px;
    border: 1px solid #1e3a5f;
    border-radius: 4px;
    transition: background 0.1s;
  }
  .card-links a:hover {
    background: #1e3a5f;
  }
</style>
</head>
<body>
<header class="top-bar">
  <h1>Resume Templates Grid</h1>
  <div class="top-stats">
    <span class="stat stat-pass">${passCount} PASS</span>
    <span class="stat stat-fail">${failCount} FAIL</span>
    <span class="stat stat-warn">${warnCount} WARN</span>
    <span class="stat stat-total">${results.length} total</span>
  </div>
</header>
<main>
  ${templateSections}
</main>
</body>
</html>`;

fs.writeFileSync(path.join(ROOT, 'output', 'index.html'), indexHtml);

console.log(`\nGrid complete: ${passCount} PASS / ${failCount} FAIL / ${warnCount} WARN`);
console.log(`Index: output/index.html`);
