// C19 phase 6 — formalize existing de-facto cross-MM access.
//
// Tushar Ahuja today manages the other two MMs and their full subtrees
// — informally, with no DB representation. C19 makes this explicit:
// each peer manager grants Tushar a `subtree` forever-share rooted at
// their own email. After this script runs, Tushar's reach is auditable
// and revocable; the BFS picks it up automatically.
//
// akash.avasthi and adnan.shaikh do NOT need shares — they ARE the
// formal teamLeads of their recruiters per the audit's Example 3
// correction. Their access is already legitimate via the normal BFS.
//
// Usage:
//   MONGO_URI="<atlas-uri>" node backend/scripts/c19-formalize-existing.mjs           # DRY_RUN
//   MONGO_URI="<atlas-uri>" APPLY=true node backend/scripts/c19-formalize-existing.mjs
//
// Idempotent — won't double-grant if a forever-share with the same
// (ownerEmail, delegateEmail, scope='subtree', subtreeRootEmail) already exists.

import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME   = process.env.DB_NAME || 'interviewSupport';
const APPLY     = process.env.APPLY === 'true';
const TUSHAR    = (process.env.C19_TUSHAR_EMAIL || 'tushar.ahuja@silverspaceinc.com').toLowerCase();

if (!MONGO_URI) {
  console.error('MONGO_URI required');
  process.exit(1);
}

const main = async () => {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const users = db.collection('users');
  const delegations = db.collection('userDelegations');

  // Find Tushar (the delegate)
  const tushar = await users.findOne({ email: TUSHAR });
  if (!tushar) {
    console.error(`Tushar not found at ${TUSHAR}. Set C19_TUSHAR_EMAIL if his email differs.`);
    process.exit(1);
  }
  const tusharRole = (tushar.role || '').toLowerCase();
  if (!['mm', 'manager'].includes(tusharRole)) {
    console.error(`Expected Tushar to be manager/mm, got ${tushar.role}`);
    process.exit(1);
  }

  // Find peer managers (other mm/manager users, active, NOT Tushar)
  const peerManagers = await users.find({
    role: { $in: ['mm', 'manager'] },
    active: { $ne: false },
    email: { $ne: TUSHAR },
  }).toArray();

  console.log(`Found ${peerManagers.length} peer manager(s):`);
  for (const p of peerManagers) {
    console.log(`  ${p.email} [${p.role}/${p.team || '-'}]`);
  }

  if (peerManagers.length === 0) {
    console.log('Nothing to formalize.');
    await client.close();
    return;
  }

  // Plan: each peer grants Tushar a forever subtree share.
  const plan = peerManagers.map((p) => ({
    ownerEmail: p.email.toLowerCase(),
    delegateEmail: TUSHAR,
    scope: 'subtree',
    subtreeRootEmail: p.email.toLowerCase(),
    subjectEmails: [],
    grantedAt: new Date(),
    grantedBy: 'system:c19-migration',
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    reason: 'c19-migration: formalize de-facto cross-MM access',
    source: 'system:c19-migration',
  }));

  // Idempotency: skip if a forever share with this (owner, delegate,
  // root) already exists and isn't revoked.
  const ops = [];
  for (const p of plan) {
    const existing = await delegations.findOne({
      ownerEmail: p.ownerEmail,
      delegateEmail: p.delegateEmail,
      scope: 'subtree',
      subtreeRootEmail: p.subtreeRootEmail,
      expiresAt: null,
      revokedAt: null,
    });
    if (existing) {
      console.log(`  skip ${p.ownerEmail} → already formalized (${existing._id})`);
      continue;
    }
    ops.push(p);
  }

  console.log(`\nWill insert ${ops.length} forever-share row(s) (mode: ${APPLY ? 'APPLY' : 'DRY_RUN'})`);
  for (const p of ops) {
    console.log(`  + ${p.ownerEmail} → ${TUSHAR}  scope=subtree forever`);
  }

  if (!APPLY) {
    console.log('\nDRY_RUN — no writes. Re-run with APPLY=true to commit.');
    await client.close();
    return;
  }

  if (ops.length > 0) {
    const result = await delegations.insertMany(ops, { ordered: false });
    console.log('\nInserted:', result.insertedCount);
  } else {
    console.log('\nNothing to insert.');
  }

  await client.close();
};

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
