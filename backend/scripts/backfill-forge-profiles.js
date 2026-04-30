/**
 * One-time backfill: derive a forgeProfile for every candidateDetails doc that
 * has a non-empty resumeUrl/resumeLink but no (or stale) forgeProfile.
 *
 * Usage:
 *   node backend/scripts/backfill-forge-profiles.js [--force] [--limit=N] [--concurrency=3] [--dry]
 *
 * Flags:
 *   --force         re-derive even when forgeProfile.derivedFrom matches the resume URL
 *   --limit=N       stop after N candidates (default: all)
 *   --concurrency=N parallel workers (default: 3)
 *   --dry           print which candidates would be processed, don't call OpenAI
 *
 * Exits 0 on success, 1 if any candidate failed.
 */
import 'dotenv/config';
import { database } from '../src/config/database.js';
import { resumeProfileService } from '../src/services/resumeProfileService.js';

function parseArgs(argv) {
  const args = { force: false, dry: false, limit: null, concurrency: 3 };
  for (const a of argv.slice(2)) {
    if (a === '--force') args.force = true;
    else if (a === '--dry') args.dry = true;
    else if (a.startsWith('--limit=')) args.limit = parseInt(a.slice(8), 10);
    else if (a.startsWith('--concurrency=')) args.concurrency = parseInt(a.slice(14), 10);
    else console.warn(`[warn] ignoring unknown arg: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  console.log('[backfill] starting with', args);

  await database.connect();
  const db = database.getDatabase();
  const col = db.collection('candidateDetails');

  // Active candidates only. Live DB uses lowercase `status` with these
  // values: Active (775), Backout (238), Placement Offer (163), null (92),
  // Hold (44), Low Priority (32). Only "Active" is in scope.
  // Resume lives on `resumeLink` (475 docs); `resumeUrl` is absent in prod
  // but accepted as a forward-compat fallback.
  const baseFilter = {
    status: 'Active',
    $or: [
      { resumeLink: { $type: 'string', $ne: '' } },
      { resumeUrl: { $type: 'string', $ne: '' } },
    ],
  };

  const cursor = col.find(baseFilter, {
    projection: { _id: 1, resumeUrl: 1, resumeLink: 1, forgeProfile: 1, name: 1 },
  });

  const candidates = [];
  for await (const doc of cursor) {
    const resumeUrl = doc.resumeUrl || doc.resumeLink;
    if (!resumeUrl) continue;
    if (!args.force && doc.forgeProfile?.derivedFrom === resumeUrl) continue;
    candidates.push({ _id: doc._id, resumeUrl, name: doc.name });
    if (args.limit && candidates.length >= args.limit) break;
  }

  const total = candidates.length;
  console.log(`[backfill] ${total} candidate(s) need processing (force=${args.force})`);

  if (args.dry) {
    candidates.forEach((c, i) => {
      console.log(`  [${i + 1}/${total}] ${c._id} ${c.name || ''} -> ${c.resumeUrl}`);
    });
    await database.disconnect();
    process.exit(0);
  }

  let done = 0;
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let i = 0;

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= total) return;
      const c = candidates[idx];
      const cid = c._id.toString();
      const tag = `[${idx + 1}/${total}] ${cid}`;
      try {
        const profile = await resumeProfileService.deriveAndStore({
          candidateId: cid,
          resumeUrl: c.resumeUrl,
          force: args.force,
        });
        const titles = profile?.titles?.length ?? 0;
        const ymin = profile?.years_min ?? '?';
        const ymax = profile?.years_max ?? '?';
        // If service returned cached (derivedFrom matched and not forced), count as skipped
        const wasCached = !args.force && profile?.derivedFrom === c.resumeUrl &&
          profile?.derivedAt && (Date.now() - new Date(profile.derivedAt).getTime() > 5000);
        if (wasCached) {
          skipped++;
          console.log(`${tag} cached (titles=${titles}, yoe=${ymin}-${ymax})`);
        } else {
          succeeded++;
          console.log(`${tag} ok (titles=${titles}, yoe=${ymin}-${ymax})`);
        }
      } catch (err) {
        failed++;
        console.error(`${tag} ERROR: ${err.message}`);
      } finally {
        done++;
      }
    }
  }

  const concurrency = Math.max(1, args.concurrency || 1);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  console.log('');
  console.log('[backfill] summary:');
  console.log(`  total:     ${total}`);
  console.log(`  succeeded: ${succeeded}`);
  console.log(`  skipped:   ${skipped}`);
  console.log(`  failed:    ${failed}`);

  await database.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[backfill] fatal:', err);
  try { await database.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
