import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTemplates, renderHTML } from '../render.js';
import { htmlToPDF } from '../to-pdf.js';
import { validateHTML, validatePDF } from '../validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT = path.join(ROOT, 'output');
const TEST_DATA = path.join(ROOT, 'test-data');

fs.mkdirSync(OUT, { recursive: true });

const resume = JSON.parse(fs.readFileSync(path.join(TEST_DATA, 'sample-rathin.json'), 'utf-8'));
const jobs = JSON.parse(fs.readFileSync(path.join(TEST_DATA, 'jobs.json'), 'utf-8'));
const templates = await listTemplates();

console.log(`Templates: ${templates.length}`);
console.log(`Jobs: ${jobs.length}`);
console.log(`Total renders: ${templates.length}`);
console.log('');

const results = [];
let passCount = 0, failCount = 0;

for (let i = 0; i < templates.length; i++) {
  const tpl = templates[i];
  const job = jobs[i % jobs.length];   // pair each template with a job round-robin
  const resumeWithJob = { ...resume, _jobContext: job };

  const baseName = `${tpl.id}__${job.company.replace(/\W+/g,'-')}`;
  const htmlPath = path.join(OUT, `${baseName}.html`);
  const pdfPath  = path.join(OUT, `${baseName}.pdf`);

  let html, htmlOk, pdfOk, pdfV;
  try {
    html = await renderHTML(tpl.id, resumeWithJob);
    fs.writeFileSync(htmlPath, html);
    htmlOk = validateHTML(html);
    if (htmlOk.ok) {
      htmlToPDF(htmlPath, pdfPath);
      pdfV = validatePDF(pdfPath, job.must_haves || []);
      pdfOk = pdfV.ok;
    }
  } catch (err) {
    results.push({ tpl: tpl.id, job: job.company, status: 'ERROR', error: err.message.slice(0,200) });
    failCount++;
    continue;
  }

  const status = htmlOk.ok && pdfOk ? 'PASS' : 'FAIL';
  if (status === 'PASS') passCount++; else failCount++;
  results.push({
    tpl: tpl.id,
    label: tpl.label,
    job: job.company,
    status,
    pages: pdfV?.pages,
    sizeKB: pdfV ? Math.round(pdfV.size / 1024) : null,
    htmlIssues: htmlOk.issues,
    pdfIssues: pdfV?.issues || [],
    warnings: pdfV?.warnings || [],
  });
}

console.log('\nRESULTS:');
console.log('| # | Template | Job | Status | Pages | Size | Issues |');
console.log('|---|---|---|---|---|---|---|');
results.forEach((r, i) => {
  const issues = [...(r.htmlIssues || []), ...(r.pdfIssues || [])].slice(0,2).join('; ').slice(0, 80) || '-';
  const warns = (r.warnings || []).join('; ').slice(0, 60) || '';
  console.log(`| ${i+1} | ${r.label || r.tpl} | ${r.job} | ${r.status} | ${r.pages || '?'} | ${r.sizeKB ? r.sizeKB+'KB' : '?'} | ${issues} | ${warns} |`);
});

console.log(`\n${passCount} PASS · ${failCount} FAIL · ${templates.length} total`);

fs.writeFileSync(path.join(OUT, 'test-results.json'), JSON.stringify(results, null, 2));

if (failCount > 0) process.exit(1);
