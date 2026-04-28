import { callJSON, loadPrompt } from './llm.js';

const BANNED_OPENERS = [
  'responsible', 'helped', 'worked', 'assisted', 'involved', 'participated', 'participate',
  'own', 'owning', 'collaborated', 'collaborating', 'contributed', 'contributing', 'engaged',
  'supporting', 'supported', 'facilitated', 'facilitating', 'coordinated', 'managed',
  'handled', 'ensured', 'maintained',
];

const BANNED_WORDS = [
  /\bresults-driven\b/i, /\bpassionate\b/i, /\bhardworking\b/i, /\bteam player\b/i,
  /\bself-starter\b/i, /\bgo-getter\b/i, /\bdetail-oriented\b/i, /\bspearheaded\b/i,
  /\bsynergy\b/i, /\bleveraged?\b/i,
];

const HAS_NUMBER = /\b(\$?\d[\d,.]*\s*(%|k|m|b|million|billion|bn|hrs|min|ms|s|x|\+)?|p95|p99)\b/i;

const POLISH_PROMPT = {
  system: `You are a surgical resume editor. You will receive ONE bullet that fails a rule. Rewrite it to fix the rule while preserving the underlying fact. Output STRICT JSON: {"bullet": "rewritten text"}.

Rules:
- Start with one of: Architected, Authored, Built, Cut, Delivered, Deployed, Designed, Drove, Engineered, Implemented, Improved, Integrated, Launched, Led, Mentored, Migrated, Optimized, Rebuilt, Reduced, Refactored, Shipped, Scaled, Simplified, Streamlined, Wrote, Conducted, Prototyped, Resolved, Reviewed.
- Never start with: Responsible, Helped, Worked, Assisted, Participated, Own, Collaborated, Contributed, Engaged, Supported, Facilitated, Coordinated, Managed, Handled, Ensured, Maintained.
- Include at least one UNEVEN number (37%, 43%, 8.4K, 1.7M, 310ms). NEVER use round numbers like 10%, 20%, 25%, 30%, 50%, 100%. If inventing, keep it plausible for the role and uneven.
- Never use: results-driven, passionate, hardworking, team player, self-starter, spearheaded, synergy, leverage.
- One or two lines. No markdown fences.`,
  user: `Bullet to fix:\n"{bullet}"\n\nCompany / role for context: {context}\n\nFailed rules: {failures}\n\nRewrite. OUTPUT JSON ONLY.`,
};

function firstWord(s) {
  return (s.split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z]/g, '');
}

function bulletFailures(b) {
  const f = [];
  if (BANNED_OPENERS.includes(firstWord(b))) f.push(`banned_opener:${firstWord(b)}`);
  if (!HAS_NUMBER.test(b)) f.push('no_number');
  for (const bw of BANNED_WORDS) if (bw.test(b)) f.push(`banned_word:${bw.source}`);
  if (b.length > 280) f.push('too_long');
  return f;
}

function summaryFailures(s, resume) {
  const f = [];
  for (const bw of BANNED_WORDS) if (bw.test(s)) f.push(`banned_word:${bw.source}`);
  if (/\b(I|my|me)\b/.test(s)) f.push('first_person');
  const words = s.trim().split(/\s+/).filter(Boolean).length;
  if (words > 80) f.push(`too_long:${words}`);
  if (resume) {
    const earliest = earliestStartYear(resume);
    const m = s.match(/\b(\d{1,2})\s*\+?\s*years?\b/i) || s.match(/\bover\s+(\d{1,2})\s+years?\b/i);
    if (earliest && m) {
      const claimed = parseInt(m[1], 10);
      const actualMax = new Date().getFullYear() - earliest;
      if (claimed > actualMax) f.push(`tenure_inflated:${claimed}>${actualMax}`);
    }
  }
  return f;
}

function earliestStartYear(resume) {
  let earliest = null;
  for (const r of resume.experience || []) {
    const m = String(r.dates || '').match(/\b(19|20)\d{2}\b/);
    if (m) {
      const y = parseInt(m[0], 10);
      if (earliest === null || y < earliest) earliest = y;
    }
  }
  return earliest;
}

export async function polish(resume, { traceDir } = {}) {
  const fixes = [];

  // polish each bullet
  for (const role of resume.experience || []) {
    const context = `${role.company} / ${role.title} / ${role.dates}`;
    for (let i = 0; i < (role.bullets || []).length; i++) {
      const b = role.bullets[i];
      const failures = bulletFailures(b);
      if (failures.length === 0) continue;

      const { parsed } = await callJSON({
        agent: 'polish_bullet',
        prompt: POLISH_PROMPT,
        vars: { bullet: b, context, failures: failures.join(', ') },
        temperature: 0.3,
        traceDir,
      });
      const newBullet = (parsed.bullet || '').trim();
      if (newBullet && bulletFailures(newBullet).length < failures.length) {
        role.bullets[i] = newBullet;
        fixes.push({ location: `${role.company} #${i}`, from: b, to: newBullet, fixed: failures });
      } else {
        fixes.push({ location: `${role.company} #${i}`, unfixed: failures, attempted: newBullet });
      }
    }
  }

  // polish summary if needed
  if (resume.summary) {
    const sf = summaryFailures(resume.summary, resume);
    if (sf.length > 0) {
      const earliest = earliestStartYear(resume);
      const tenureCap = earliest ? new Date().getFullYear() - earliest : null;
      const tenureHint = tenureCap ? `Earliest role start year: ${earliest}. MAX years claim allowed: ${tenureCap}. If summary says "N+ years" and N > ${tenureCap}, rewrite to ≤ ${tenureCap}.` : '';
      const { parsed } = await callJSON({
        agent: 'polish_summary',
        prompt: {
          system: POLISH_PROMPT.system.replace('ONE bullet', 'the SUMMARY'),
          user: 'Summary to fix:\n"{bullet}"\n\nFailed rules: {failures}\n\n{tenureHint}\n\nRewrite. Keep ≤ 80 words. OUTPUT JSON: {"bullet": "..."}.',
        },
        vars: { bullet: resume.summary, context: 'resume summary', failures: sf.join(', '), tenureHint },
        temperature: 0.3,
        traceDir,
      });
      const newSummary = (parsed.bullet || '').trim();
      if (newSummary) {
        fixes.push({ location: 'summary', from: resume.summary, to: newSummary, fixed: sf });
        resume.summary = newSummary;
      }
    }
  }

  return { resume, fixes };
}
