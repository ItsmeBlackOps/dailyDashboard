/**
 * Self-contained test — verifies CC chain resolution using actual DB records.
 *
 * Usage:  node backend/scripts/testCcChain.js
 *
 * No database connection needed; the user records are inlined from production.
 */

// ─── Actual user records from the database ───
const USERS = [
  {
    email: 'alok.tanwar@vizvainc.com',
    role: 'recruiter',
    teamLead: 'Satyam Gupta',
    manager: 'Tushar Ahuja',
  },
  {
    email: 'satyam.gupta@silverspaceinc.com',
    role: 'mlead',
    teamLead: 'Shashank Sharma',
    manager: 'Tushar Ahuja',
  },
  {
    email: 'shashank.sharma@silverspaceinc.com',
    role: 'MAM',
    teamLead: '',
    manager: 'Tushar Ahuja',
  },
  {
    email: 'tushar.ahuja@silverspaceinc.com',
    role: 'mm',
    teamLead: '',
    manager: '',
  },
];

const usersByEmail = new Map(USERS.map((u) => [u.email.toLowerCase(), u]));

// ─── Helper functions (same as supportRequestService.js) ───
function normalizeName(value = '') {
  return value.toString().trim().replace(/\s+/g, ' ').toLowerCase();
}

function deriveDisplayNameFromEmail(email = '') {
  const local = (email || '').split('@')[0];
  return local
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function resolveEmail(nameValue) {
  if (!nameValue) return null;
  if (nameValue.includes('@')) return nameValue.toLowerCase();
  const target = normalizeName(nameValue);
  if (!target) return null;
  for (const u of USERS) {
    if (normalizeName(deriveDisplayNameFromEmail(u.email)) === target) {
      return u.email.toLowerCase();
    }
  }
  return null;
}

// ─── buildHierarchyChain (same logic as the service) ───
function buildHierarchyChain(startEmail) {
  const chain = [];
  const visited = new Set();
  let currentEmail = startEmail?.toLowerCase();

  while (currentEmail && !visited.has(currentEmail)) {
    const record = usersByEmail.get(currentEmail);
    if (!record) break;

    const role = (record.role || '').toLowerCase();
    if (role === 'admin') break;

    visited.add(currentEmail);
    chain.push(currentEmail);

    const nextFromTeamLead = resolveEmail(record.teamLead ?? '');
    const nextFromManager = resolveEmail(record.manager ?? '');

    if (nextFromTeamLead && !visited.has(nextFromTeamLead)) {
      currentEmail = nextFromTeamLead;
    } else if (nextFromManager && !visited.has(nextFromManager)) {
      currentEmail = nextFromManager;
    } else {
      break;
    }
  }
  return chain;
}

// ─── Run tests ───
const CANDIDATE = {
  name: 'Sindhuja Vangeti',
  recruiter: 'alok.tanwar@vizvainc.com',
};

console.log('═══════════════════════════════════════════════════════════');
console.log(`Candidate : ${CANDIDATE.name}`);
console.log(`Recruiter : ${CANDIDATE.recruiter}`);
console.log('═══════════════════════════════════════════════════════════\n');

const chain = buildHierarchyChain(CANDIDATE.recruiter);

console.log('Full email list (hierarchy chain):');
chain.forEach((email, i) => {
  const rec = usersByEmail.get(email);
  console.log(`  ${i + 1}. ${deriveDisplayNameFromEmail(email)} <${email}> — role: ${rec?.role}`);
});

const expected = [
  'alok.tanwar@vizvainc.com',
  'satyam.gupta@silverspaceinc.com',
  'shashank.sharma@silverspaceinc.com',
  'tushar.ahuja@silverspaceinc.com',
];
const pass = JSON.stringify(chain) === JSON.stringify(expected);
console.log(`\n  ${pass ? 'PASS' : 'FAIL'} — expected: [${expected.map(e => deriveDisplayNameFromEmail(e)).join(', ')}]`);

// ─── CC list for different senders ───
console.log('\n───────────────────────────────────────────────────────────');
console.log('CC list per logged-in user (sender excluded from CC):');
console.log('───────────────────────────────────────────────────────────');

for (const sender of chain) {
  const cc = chain.filter((e) => e !== sender);
  const senderName = deriveDisplayNameFromEmail(sender);
  console.log(`\n  If "${senderName}" creates the request:`);
  cc.forEach((e) => console.log(`    CC: ${deriveDisplayNameFromEmail(e)} <${e}>`));
}

// ─── What-if: different recruiter values ───
console.log('\n═══════════════════════════════════════════════════════════');
console.log('What-if scenarios (different recruiter values):');
console.log('═══════════════════════════════════════════════════════════');

const whatIf = [
  { recruiter: 'satyam.gupta@silverspaceinc.com', expected: ['satyam.gupta@silverspaceinc.com', 'shashank.sharma@silverspaceinc.com', 'tushar.ahuja@silverspaceinc.com'] },
  { recruiter: 'shashank.sharma@silverspaceinc.com', expected: ['shashank.sharma@silverspaceinc.com', 'tushar.ahuja@silverspaceinc.com'] },
  { recruiter: 'tushar.ahuja@silverspaceinc.com', expected: ['tushar.ahuja@silverspaceinc.com'] },
];

let allPass = pass;
for (const { recruiter, expected: exp } of whatIf) {
  const testChain = buildHierarchyChain(recruiter);
  const ok = JSON.stringify(testChain) === JSON.stringify(exp);
  allPass = allPass && ok;
  const name = deriveDisplayNameFromEmail(recruiter);
  console.log(`\n  Recruiter = ${name}`);
  console.log(`  Email list: [${testChain.map(deriveDisplayNameFromEmail).join(', ')}]`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — expected: [${exp.map(deriveDisplayNameFromEmail).join(', ')}]`);
}

console.log(`\n${'═'.repeat(59)}`);
console.log(allPass ? '  ALL TESTS PASSED' : '  SOME TESTS FAILED');
console.log('═'.repeat(59));
process.exit(allPass ? 0 : 1);
