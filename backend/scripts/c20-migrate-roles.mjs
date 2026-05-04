// C20 migration — rename role enum to {admin, manager, assistantManager,
// teamLead, recruiter, expert} and split off a new `team` field
// {technical, marketing, sales, null}. One-shot, idempotent.
//
// Run via:
//   MONGO_URI="<atlas-uri>" node backend/scripts/c20-migrate-roles.mjs
//
// Behavior:
//   - DRY_RUN=true (default) prints the change set, no writes
//   - APPLY=true performs the writes inside a single bulkWrite
//   - Always pushes a changeHistory entry for each affected user
//
// Migration map (matches the audit doc's table):
//   mm        -> { role: 'manager',          team: 'marketing' }   (Tushar's home team is marketing)
//   mam       -> { role: 'assistantManager', team: 'marketing' }
//   mlead     -> { role: 'teamLead',         team: 'marketing' }
//   am        -> { role: 'assistantManager', team: 'technical' }
//   lead      -> { role: 'teamLead',         team: 'technical' }
//   recruiter -> { role: 'recruiter',        team: 'marketing' }   (only marketing recruiters today)
//   user      -> { role: 'expert',           team: 'technical' }
//   admin     -> { role: 'admin',            team: null }

import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || 'interviewSupport';
const APPLY = process.env.APPLY === 'true';

if (!MONGO_URI) {
  console.error('MONGO_URI environment variable is required');
  process.exit(1);
}

const RULES = {
  mm:        { role: 'manager',          team: 'marketing' },
  mam:       { role: 'assistantManager', team: 'marketing' },
  mlead:     { role: 'teamLead',         team: 'marketing' },
  am:        { role: 'assistantManager', team: 'technical' },
  lead:      { role: 'teamLead',         team: 'technical' },
  recruiter: { role: 'recruiter',        team: 'marketing' },
  user:      { role: 'expert',           team: 'technical' },
  admin:     { role: 'admin',            team: null },
};

const main = async () => {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const users = db.collection('users');

  const all = await users.find({}, { projection: { email: 1, role: 1, team: 1 } }).toArray();
  console.log(`Inspecting ${all.length} users (mode: ${APPLY ? 'APPLY' : 'DRY_RUN'})`);

  const operations = [];
  const summary = {};

  for (const u of all) {
    const currentRole = (u.role || '').toLowerCase().trim();
    const rule = RULES[currentRole];
    if (!rule) {
      console.warn(`  skip ${u.email}: unknown role "${u.role}"`);
      continue;
    }
    // Idempotent: skip if already on the new shape (role matches AND team
    // is set when expected).
    const alreadyMigrated = u.role === rule.role && (rule.team === null
      ? (u.team === null || u.team === undefined)
      : u.team === rule.team);
    if (alreadyMigrated) continue;

    summary[currentRole] = (summary[currentRole] || 0) + 1;
    operations.push({
      updateOne: {
        filter: { email: u.email },
        update: {
          $set: {
            role: rule.role,
            team: rule.team,
            updatedAt: new Date(),
          },
          $push: {
            changeHistory: {
              at: new Date(),
              by: 'system:c20-migration',
              source: 'c20-migrate-roles.mjs',
              changes: {
                role:  { from: u.role,         to: rule.role },
                team:  { from: u.team || null, to: rule.team },
              },
            },
          },
        },
      },
    });
  }

  console.log('Pending changes by source role:', summary);
  console.log(`Total ops: ${operations.length}`);

  if (!APPLY) {
    console.log('DRY_RUN — no writes. Re-run with APPLY=true to commit.');
    await client.close();
    return;
  }

  if (operations.length === 0) {
    console.log('Nothing to migrate.');
    await client.close();
    return;
  }

  const result = await users.bulkWrite(operations, { ordered: false });
  console.log('Migration complete:', {
    matched: result.matchedCount,
    modified: result.modifiedCount,
  });

  await client.close();
};

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
