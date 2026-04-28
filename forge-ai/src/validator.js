import fs from 'node:fs';

const ACTION_VERBS = new Set([
  'architected','built','cut','delivered','designed','drove','engineered','eliminated',
  'implemented','launched','led','migrated','modeled','optimized','orchestrated','owned',
  'partnered','rebuilt','reduced','refactored','shipped','scaled','surfaced','translated',
  'accelerated','authored','automated','consolidated','created','deployed',
  'developed','drafted','established','executed','generated','improved','initiated',
  'integrated','introduced','mentored','negotiated','piloted','pioneered','produced',
  'rolled','saved','secured','simplified','standardized','streamlined',
  'transformed','unified','upgraded','validated','wrote',
  // broader legitimate action verbs
  'analyzed','assessed','benchmarked','conducted','debugged','defined','diagnosed',
  'enabled','evaluated','fostered','guided','identified','instrumented','investigated',
  'monitored','overhauled','presented','prototyped','reconciled','researched','resolved',
  'reviewed','revised','tested','tracked','troubleshot','verified','transitioned','documented',
  'enhanced','expanded','extended','hardened','instituted','modernized','ported','profiled',
  'reorganized','replaced','restructured','trained','translated','tuned','negotiated',
  'responded','remediated','observed','patched','provisioned','onboarded','configured','rearranged',
  'mentor','lead','drive','author','build','design','ship','deploy','scale',
  'rearchitected','reengineered','rewrote','slashed','tripled','doubled','halved',
]);

const BAD_OPENERS = [
  /^responsible for/i, /^helped with/i, /^worked on/i, /^assisted/i,
  /^involved in/i, /^participated in/i,
];

const CLICHES = [
  /passionate/i, /hardworking/i, /team player/i, /self-starter/i, /go-getter/i,
  /detail-oriented/i, /results-driven/i,
];

const HAS_NUMBER = /\b(\$?\d[\d,.]*\s*(%|k|m|b|million|billion|bn|hrs|min|ms|s|x|\+)?|p95|p99)\b/i;

function extractEarliestStartYear(resume) {
  const exp = resume.experience || [];
  let earliest = null;
  for (const role of exp) {
    const d = String(role.dates || '');
    const m = d.match(/\b(19|20)\d{2}\b/);
    if (m) {
      const y = parseInt(m[0], 10);
      if (earliest === null || y < earliest) earliest = y;
    }
  }
  return earliest;
}

export function validate(resume) {
  const findings = [];

  // Tenure math: compare "N+ years" claim in summary against earliest role start.
  const earliestYear = extractEarliestStartYear(resume);
  const summaryText = resume.summary || '';
  const yearsClaim = summaryText.match(/\b(\d{1,2})\s*\+?\s*years?\b/i) || summaryText.match(/\bover\s+(\d{1,2})\s+years?\b/i);
  if (earliestYear && yearsClaim) {
    const claimed = parseInt(yearsClaim[1], 10);
    const actualMax = new Date().getFullYear() - earliestYear;
    if (claimed > actualMax) {
      findings.push({
        rule: 'summary_tenure_inflated',
        severity: 'critical',
        msg: `summary claims ${claimed}+ years but earliest role starts ${earliestYear} (max ~${actualMax} years)`,
      });
    }
  }

  // Summary checks
  const summary = resume.summary || '';
  const words = summary.trim().split(/\s+/).filter(Boolean).length;
  if (words > 80) findings.push({ rule: 'summary_length', severity: 'major', msg: `summary is ${words} words (>80)` });
  if (/\b(I|my|me)\b/.test(summary)) findings.push({ rule: 'summary_first_person', severity: 'major', msg: 'summary uses first-person pronouns' });
  for (const c of CLICHES) if (c.test(summary)) findings.push({ rule: 'summary_cliche', severity: 'minor', msg: `summary contains cliché: ${c}` });
  const quantCount = (summary.match(HAS_NUMBER) || []).length;
  if (quantCount < 2) findings.push({ rule: 'summary_quantification', severity: 'major', msg: `summary has ${quantCount} numeric wins (<2)` });

  // Title line
  if (!resume.title_line || resume.title_line.length < 10) findings.push({ rule: 'title_line_missing', severity: 'critical', msg: 'title_line missing or too short' });

  // Skills section
  const skills = resume.skills || {};
  const skillKeys = Object.keys(skills);
  if (skillKeys.length < 3) findings.push({ rule: 'skills_groups', severity: 'major', msg: `only ${skillKeys.length} skill groups (<3)` });
  for (const k of skillKeys) {
    if (!Array.isArray(skills[k]) || skills[k].length === 0) {
      findings.push({ rule: 'skills_empty_group', severity: 'major', msg: `skill group "${k}" is empty` });
    }
  }

  // Experience bullets
  const exp = resume.experience || [];
  if (exp.length === 0) findings.push({ rule: 'no_experience', severity: 'critical', msg: 'no experience entries' });

  exp.forEach((role, i) => {
    if (!role.company || !role.title || !role.dates) {
      findings.push({ rule: 'role_missing_fields', severity: 'critical', msg: `role ${i}: missing company/title/dates` });
    }
    const bullets = role.bullets || [];
    if (bullets.length === 0) findings.push({ rule: 'role_no_bullets', severity: 'major', msg: `${role.company}: no bullets` });

    bullets.forEach((b, j) => {
      const first = (b.split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z]/g, '');
      if (!ACTION_VERBS.has(first)) {
        findings.push({ rule: 'bullet_verb', severity: 'major', msg: `${role.company} #${j}: opener "${first}" not in action-verb list` });
      }
      for (const bad of BAD_OPENERS) {
        if (bad.test(b)) findings.push({ rule: 'bullet_weak_opener', severity: 'critical', msg: `${role.company} #${j}: weak opener "${b.slice(0, 60)}..."` });
      }
      if (!HAS_NUMBER.test(b)) {
        findings.push({ rule: 'bullet_no_number', severity: 'minor', msg: `${role.company} #${j}: no quantification` });
      }
      if (b.length > 280) {
        findings.push({ rule: 'bullet_too_long', severity: 'minor', msg: `${role.company} #${j}: ${b.length} chars (>280)` });
      }
    });
  });

  // Projects
  const projects = resume.projects || [];
  projects.forEach((p, i) => {
    if (!p.name || !p.outcome) findings.push({ rule: 'project_incomplete', severity: 'minor', msg: `project ${i}: missing name or outcome` });
  });

  const summary_stats = {
    total: findings.length,
    critical: findings.filter(f => f.severity === 'critical').length,
    major: findings.filter(f => f.severity === 'major').length,
    minor: findings.filter(f => f.severity === 'minor').length,
  };

  return { pass: summary_stats.critical === 0 && summary_stats.major <= 3, summary: summary_stats, findings };
}

export function validateKeywordCoverage(resume, jdMustHaves = []) {
  const hay = JSON.stringify(resume).toLowerCase();
  const hits = [];
  const misses = [];
  for (const kw of jdMustHaves) {
    if (hay.includes(kw.toLowerCase())) hits.push(kw); else misses.push(kw);
  }
  return {
    coverage: jdMustHaves.length ? hits.length / jdMustHaves.length : 1,
    hits,
    misses,
  };
}

export function formatReport(result) {
  const lines = [];
  lines.push(`Validation: ${result.pass ? 'PASS' : 'FAIL'}`);
  lines.push(`  critical: ${result.summary.critical}, major: ${result.summary.major}, minor: ${result.summary.minor}`);
  for (const f of result.findings) {
    lines.push(`  [${f.severity.padEnd(8)}] ${f.rule}: ${f.msg}`);
  }
  return lines.join('\n');
}

export function validateFile(resumePath) {
  const resume = JSON.parse(fs.readFileSync(resumePath, 'utf8'));
  return validate(resume);
}
