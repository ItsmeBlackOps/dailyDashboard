import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export function validateHTML(html) {
  const issues = [];
  const nonAscii = [...html].filter(c => c.charCodeAt(0) > 126);
  if (nonAscii.length) issues.push(`HTML contains non-ASCII chars: ${nonAscii.slice(0,3).map(c => 'U+' + c.charCodeAt(0).toString(16).toUpperCase()).join(', ')}`);
  return { ok: issues.length === 0, issues };
}

export function validatePDF(pdfPath, mustHaves = []) {
  const issues = [];
  const txt = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf-8' });

  // 1. Replacement chars
  if (txt.includes('�')) issues.push(`pdftotext output contains U+FFFD replacement chars (font glyph encoding failed)`);

  // 2. File size
  const size = fs.statSync(pdfPath).size;
  if (size < 30 * 1024) issues.push(`PDF too small (${size} bytes) - possibly empty render`);
  if (size > 500 * 1024) issues.push(`PDF too large (${(size/1024).toFixed(0)}KB) - possibly embedded images`);

  // 3. Page count via form-feeds in pdftotext output
  const pages = (txt.match(/\f/g) || []).length + 1;
  if (pages > 2) issues.push(`PDF has ${pages} pages - keep to 1-2`);

  // 4. Keyword presence (must_haves)
  const txtLower = txt.toLowerCase();
  const missingKeywords = mustHaves.filter(k => !txtLower.includes(k.toLowerCase()));
  if (missingKeywords.length) issues.push(`Missing must-have keywords: ${missingKeywords.join(', ')}`);

  // 5. Canonical section headings
  const REQUIRED_SECTIONS = ['summary', 'experience', 'education', 'skills'];
  const missingSections = REQUIRED_SECTIONS.filter(s => !txtLower.includes(s));
  if (missingSections.length) issues.push(`Missing canonical sections: ${missingSections.join(', ')}`);

  return { ok: issues.length === 0, issues, pages, size, txt };
}
