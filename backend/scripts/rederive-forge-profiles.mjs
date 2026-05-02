#!/usr/bin/env node
/**
 * Batch re-derive forgeProfile for all active candidates so they get
 * the new richer schema (titles 6-25, keywords 6-16, industries[]).
 *
 * Idempotent + concurrency-bounded:
 *   - Skips candidates whose forgeProfile.industries is already present
 *     AND whose forgeProfile.titles.length >= 6 (already on new prompt).
 *   - Re-derives candidates missing industries OR with old narrow titles.
 *   - Forces re-derive on --force regardless of state.
 *
 * gpt-4o-mini per derive ≈ $0.001 — 317 candidates ≈ $0.30 total.
 *
 * Required env: MONGODB_URI, OPENAI_API_KEY
 *
 * Usage:
 *   node backend/scripts/rederive-forge-profiles.mjs                # idempotent re-derive
 *   node backend/scripts/rederive-forge-profiles.mjs --force        # re-derive ALL
 *   node backend/scripts/rederive-forge-profiles.mjs --concurrency=8
 *   node backend/scripts/rederive-forge-profiles.mjs --limit=10     # test on 10 first
 *   node backend/scripts/rederive-forge-profiles.mjs --candidate=<id>  # single candidate
 *   node backend/scripts/rederive-forge-profiles.mjs --dry           # print plan, do nothing
 */
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import { resumeProfileService } from '../src/services/resumeProfileService.js';
import { database } from '../src/config/database.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.startsWith('--') ? a.slice(2).split('=') : [a, true];
  return [k, v ?? true];
}));

const FORCE       = !!args.force;
const DRY         = !!args.dry;
const LIMIT       = args.limit ? parseInt(args.limit, 10) : Infinity;
const CONCURRENCY = parseInt(args.concurrency || '4', 10);
const SINGLE_ID   = args.candidate ? String(args.candidate) : null;

function needsRederive(c) {
  if (FORCE) return true;
  const fp = c.forgeProfile;
  if (!fp) return true;
  if (!Array.isArray(fp.industries) || fp.industries.length === 0) return true;
  if (!Array.isArray(fp.titles) || fp.titles.length < 6) return true;
  return false;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI env var is required');

  // The resumeProfileService imports the singleton database; connect that
  // instance so the service's getDb() works.
  await database.connect();

  const db = database.getDb();
  const col = db.collection('candidateDetails');

  let cands;
  if (SINGLE_ID) {
    if (!ObjectId.isValid(SINGLE_ID)) throw new Error(`Invalid candidate id: ${SINGLE_ID}`);
    const c = await col.findOne(
      { _id: new ObjectId(SINGLE_ID) },
      { projection: { _id: 1, 'Candidate Name': 1, status: 1, resumeLink: 1, resumeUrl: 1, forgeProfile: 1 } }
    );
    cands = c ? [c] : [];
  } else {
    cands = await col.find(
      {
        status: 'Active',
        $or: [
          { resumeLink: { $type: 'string', $ne: '' } },
          { resumeUrl:  { $type: 'string', $ne: '' } },
        ],
      },
      { projection: { _id: 1, 'Candidate Name': 1, status: 1, resumeLink: 1, resumeUrl: 1, forgeProfile: 1 } }
    ).toArray();
  }

  const todo    = cands.filter(needsRederive).slice(0, LIMIT);
  const skipped = cands.length - todo.length;
  console.log(`Found ${cands.length} active candidate(s).`);
  console.log(`Will re-derive: ${todo.length}   Skipped (already on new schema): ${skipped}`);
  if (DRY) {
    console.log('\n--dry — listing planned re-derives:');
    todo.forEach((c) => console.log(`  - ${c['Candidate Name']}  (${c._id})`));
    await database.disconnect?.();
    return;
  }

  let i = 0; let ok = 0; let fail = 0;
  const startMs = Date.now();
  const workers = Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= todo.length) return;
      const c = todo[idx];
      const candidateId = String(c._id);
      const resumeUrl = c.resumeLink || c.resumeUrl;
      const tag = `[${idx + 1}/${todo.length}] ${c['Candidate Name']}`;
      if (!resumeUrl) { console.log(`${tag} — no resumeUrl, skipped`); continue; }
      try {
        const t0 = Date.now();
        const fp = await resumeProfileService.deriveAndStore({
          candidateId, resumeUrl, force: true, // force because we're explicitly re-deriving
        });
        const ms = Date.now() - t0;
        console.log(`${tag} ✓ titles=${fp.titles?.length || 0} keywords=${fp.keywords?.length || 0} industries=${JSON.stringify(fp.industries || [])} (${ms}ms)`);
        ok++;
      } catch (err) {
        console.error(`${tag} ✗ ${err.message}`);
        fail++;
      }
    }
  });
  await Promise.all(workers);

  const totalMs = Date.now() - startMs;
  console.log(`\nDone. ${ok} succeeded, ${fail} failed. (${(totalMs / 1000).toFixed(1)}s)`);
  await database.disconnect?.();
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
