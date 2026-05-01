#!/usr/bin/env node
/**
 * Import previously-completed Apify run datasets into the jobsPool
 * collection. Idempotent — re-running skips already-imported jobs by
 * their dedupeKey.
 *
 * Usage:
 *   node backend/scripts/import-apify-runs.js [flags]
 *
 * Flags:
 *   --since=YYYY-MM-DD     start of import window (default: 14 days ago)
 *   --limit=N              max runs to scan (default: 200)
 *   --enrich=on|off        run gpt-4o-mini JD-enrich per new job (default: on)
 *   --concurrency=N        parallel JD-enrich requests (default: 5)
 *   --dry                  print what would happen, do not write
 *
 * Required env (lives on the VM where the dashboard runs):
 *   APIFY_TOKEN            same token the scraper uses
 *   MONGODB_URI            atlas URI (or seedlist if SRV blocked)
 *   SCRAPER_SERVICE_URL    e.g. http://scraper:8001 (default for compose)
 *
 * Exit code:
 *   0  on success
 *   1  on any error
 */
import 'dotenv/config';
import { database } from '../src/config/database.js';
import {
  jobsPoolService,
  normalizeTitle,
  yearsToBucket,
  dedupeKeyFor,
  isUSLocation,
} from '../src/services/jobsPoolService.js';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const SCRAPER_URL = process.env.SCRAPER_SERVICE_URL || 'http://scraper:8001';

if (!APIFY_TOKEN) {
  console.error('APIFY_TOKEN env var is required');
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    since: null,
    postedAfter: null,    // ISO date — items with postedAt <= this get skipped
    limit: 200,
    enrich: 'on',
    concurrency: 5,
    dry: false,
  };
  for (const a of argv.slice(2)) {
    if (a === '--dry') out.dry = true;
    else if (a.startsWith('--since=')) out.since = a.slice(8);
    else if (a.startsWith('--posted-after=')) out.postedAfter = a.slice(15);
    else if (a.startsWith('--limit=')) out.limit = parseInt(a.slice(8), 10) || 200;
    else if (a.startsWith('--enrich=')) out.enrich = a.slice(9).toLowerCase();
    else if (a.startsWith('--concurrency=')) out.concurrency = parseInt(a.slice(14), 10) || 5;
    else console.warn('[import] unknown arg:', a);
  }
  if (!out.since) {
    const d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    out.since = d.toISOString().slice(0, 10);
  }
  return out;
}

async function listRuns(sinceIso, limit) {
  // Apify pages 50 at a time; loop until we exceed `limit` or hit the
  // since cutoff.
  const all = [];
  let offset = 0;
  while (offset < limit) {
    const url = `https://api.apify.com/v2/actor-runs?token=${APIFY_TOKEN}&limit=50&offset=${offset}&desc=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Apify list runs ${res.status}`);
    const j = await res.json();
    const items = j?.data?.items || [];
    if (items.length === 0) break;
    for (const r of items) {
      if (r.status !== 'SUCCEEDED') continue;
      if (r.startedAt && r.startedAt < sinceIso) continue;
      all.push(r);
      if (all.length >= limit) break;
    }
    if (items.length < 50) break;
    offset += 50;
  }
  return all;
}

async function fetchDataset(datasetId) {
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&clean=true&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Apify dataset ${datasetId} ${res.status}`);
  return await res.json();
}

/** Map a raw Apify item (LinkedIn or FantasticJobs shape) to our pool shape. */
function adaptApifyItem(raw, run) {
  // Both actors emit slightly different field names. Try common ones.
  const title    = raw.title || raw.job_title || raw.position || '';
  const company  = raw.company || raw.company_name || raw.organization || '';
  const location =
    raw.location ||
    (Array.isArray(raw.locations_derived) ? raw.locations_derived[0] : null) ||
    (Array.isArray(raw.locations) ? raw.locations[0] : null) ||
    null;
  const url     = raw.url || raw.apply_url || raw.link || raw.source_url || '';
  const ats     = raw.ats || raw.source_platform || raw.source || run?.actId || '';
  const postedRaw =
    raw.date_posted || raw.datePosted || raw.posted_at || raw.publication_date || raw.postedAt || null;
  let postedAt = null;
  if (postedRaw) {
    const d = new Date(postedRaw);
    if (!Number.isNaN(d.getTime())) postedAt = d;
  }
  const fullDescription =
    raw.description || raw.description_text || raw.descriptionText || raw.snippet || '';
  const remoteRaw = (raw.remote_type || raw.work_arrangement || raw.workArrangement || '').toString().toLowerCase();
  const remote_type =
    remoteRaw.includes('remote') ? 'remote'
    : remoteRaw.includes('hybrid') ? 'hybrid'
    : remoteRaw.includes('site')   ? 'onsite'
    : null;

  if (!title || !company) return null;

  // US-only filter — drop postings clearly outside the US (Kuala
  // Lumpur, Mexico, Romania, etc. that the actor lets through when
  // its own country filter is loose).
  const inUS = isUSLocation(location, raw);
  if (!inUS) return null;

  return {
    title,
    company,
    location,
    inUS: true,
    remote_type,
    url,
    ats,
    postedAt,
    fullDescription,
    snippet: fullDescription.slice(0, 500),
    sourceActor: run?.actId || '',
    sourceRunId: run?.id || '',
    dedupeKey: dedupeKeyFor({ company, title, postedAt, url }),
    normalizedTitle: normalizeTitle(title),
  };
}

/** Call /enrich-jd-batch on the scraper service. Returns parallel array of {years_of_experience, job_titles}. */
async function enrichJDs(items, concurrency = 5) {
  if (items.length === 0) return [];
  const url = `${SCRAPER_URL}/enrich-jd-batch`;
  const body = {
    items: items.map((j) => ({ description: j.fullDescription || j.snippet || '', max_chars: 8000 })),
    concurrency,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`enrich-jd-batch ${res.status}: ${t.slice(0, 300)}`);
  }
  const out = await res.json();
  return out.results || [];
}

async function main() {
  const args = parseArgs(process.argv);
  console.log('[import] starting', args);

  await database.connect();

  console.log(`[import] listing Apify runs since ${args.since}, limit ${args.limit}`);
  const runs = await listRuns(args.since, args.limit);
  console.log(`[import] found ${runs.length} succeeded run(s)`);

  // Skip runs we've ALREADY processed (any outcome).
  // jobsPoolImportLog has a row per runId whether or not items landed
  // in the pool, so we never re-fetch the dataset or re-pay JD enrich.
  const db = database.getDb();
  let seenRuns = await jobsPoolService.getProcessedRunIds();

  // One-time migration: if the log is empty but jobsPool already has
  // docs (i.e. a previous one-shot import populated the pool before
  // the log existed), seed the log with every distinct sourceRunId
  // from jobsPool so we don't re-fetch + re-enrich those runs.
  if (seenRuns.size === 0) {
    const existingPoolRuns = await db.collection('jobsPool')
      .distinct('sourceRunId', { sourceRunId: { $type: 'string', $ne: '' } });
    if (existingPoolRuns.length > 0) {
      console.log(`[import] seeding jobsPoolImportLog with ${existingPoolRuns.length} pre-existing runIds`);
      for (const rid of existingPoolRuns) {
        await jobsPoolService.markRunProcessed({
          runId: rid,
          status: 'pre-existing',
          itemsUpserted: -1,  // sentinel — we don't know the count, was imported before logging existed
        });
      }
      seenRuns = await jobsPoolService.getProcessedRunIds();
    }
  }
  const todoRuns = runs.filter((r) => !seenRuns.has(r.id));
  console.log(
    `[import] ${todoRuns.length} run(s) not yet processed ` +
    `(${runs.length - todoRuns.length} skipped — already in jobsPoolImportLog)`
  );

  // Resolve the postedAt cutoff. Explicit --posted-after wins; otherwise
  // use the pool's high-water mark (max postedAt) so each cycle picks up
  // only postings genuinely newer than what we already have.
  let postedAfter = null;
  if (args.postedAfter) {
    const d = new Date(args.postedAfter);
    if (!Number.isNaN(d.getTime())) postedAfter = d;
  } else {
    postedAfter = await jobsPoolService.getHighWaterMark();
  }
  if (postedAfter) {
    console.log(`[import] postedAt cutoff: ${postedAfter.toISOString()} (items posted at/before this will be skipped)`);
  } else {
    console.log('[import] no postedAt cutoff (pool empty / no --posted-after) — taking all items');
  }

  let totalRaw = 0;
  let totalAdapted = 0;
  let totalNew = 0;
  let totalUpserted = 0;
  let totalSkippedOld = 0;

  // Helper: mark this run done in jobsPoolImportLog so we never touch
  // it again. Records every outcome (imported / empty / error / dry).
  const markDone = (run, status, extra = {}) => {
    if (args.dry) return Promise.resolve();
    return jobsPoolService.markRunProcessed({
      runId: run.id,
      actId: run.actId || '',
      datasetId: run.defaultDatasetId || '',
      status,
      ...extra,
    });
  };

  for (let i = 0; i < todoRuns.length; i++) {
    const run = todoRuns[i];
    const tag = `[${i + 1}/${todoRuns.length}] run=${run.id}`;
    if (!run.defaultDatasetId) {
      console.log(`${tag} no dataset, skipping`);
      await markDone(run, 'no_dataset');
      continue;
    }
    let items;
    try {
      items = await fetchDataset(run.defaultDatasetId);
    } catch (err) {
      console.error(`${tag} dataset fetch failed: ${err.message}`);
      await markDone(run, 'fetch_failed', { error: err.message.slice(0, 500) });
      continue;
    }
    totalRaw += items.length;

    let adapted = items.map((it) => adaptApifyItem(it, run)).filter(Boolean);
    totalAdapted += adapted.length;

    // Per-item cutoff: skip postings whose postedAt is at or before
    // the high-water mark. Items with no postedAt pass through (we
    // can't tell if they're old or new — the dedupeKey check below
    // is the second line of defense).
    if (postedAfter) {
      const beforeCount = adapted.length;
      adapted = adapted.filter((j) => !j.postedAt || j.postedAt > postedAfter);
      const skipped = beforeCount - adapted.length;
      if (skipped > 0) totalSkippedOld += skipped;
    }

    // Drop ones whose dedupeKey is already in the pool — saves enrichment cost.
    const existingKeys = new Set(
      await db
        .collection('jobsPool')
        .find({ dedupeKey: { $in: adapted.map((j) => j.dedupeKey) } })
        .project({ dedupeKey: 1, _id: 0 })
        .map((d) => d.dedupeKey)
        .toArray()
    );
    const fresh = adapted.filter((j) => !existingKeys.has(j.dedupeKey));
    totalNew += fresh.length;

    if (args.dry) {
      console.log(`${tag} adapted=${adapted.length} new=${fresh.length} (dry)`);
      continue;
    }
    if (fresh.length === 0) {
      console.log(`${tag} all ${adapted.length} items already in pool`);
      await markDone(run, 'empty', {
        itemsTotal: items.length,
        itemsAdapted: adapted.length,
        itemsNew: 0,
        itemsUpserted: 0,
      });
      continue;
    }

    // Enrich JDs.
    if (args.enrich === 'on') {
      try {
        const enriched = await enrichJDs(fresh, args.concurrency);
        for (let k = 0; k < fresh.length; k++) {
          const e = enriched[k] || {};
          const yoe = typeof e.years_of_experience === 'number' ? e.years_of_experience : null;
          const titles = Array.isArray(e.job_titles) ? e.job_titles : [];
          fresh[k].yearsOfExperience = yoe;
          fresh[k].experienceBucket = yearsToBucket(yoe);
          fresh[k].extractedTitles = titles;
          // Combine raw normalized title + extracted titles as the
          // matching surface — covers actor-derived and JD-derived names.
          const combined = new Set([fresh[k].normalizedTitle, ...titles.map(normalizeTitle)]);
          combined.delete('');
          fresh[k].normalizedTitles = [...combined];
        }
      } catch (err) {
        console.error(`${tag} enrich failed: ${err.message} — proceeding without YoE`);
        // Still upsert; matching by title alone still works.
        for (const j of fresh) {
          j.normalizedTitles = [j.normalizedTitle].filter(Boolean);
        }
      }
    } else {
      for (const j of fresh) {
        j.normalizedTitles = [j.normalizedTitle].filter(Boolean);
      }
    }

    const r = await jobsPoolService.upsertBatch(fresh);
    totalUpserted += r.upserted || 0;
    console.log(`${tag} adapted=${adapted.length} new=${fresh.length} upserted=${r.upserted || 0}`);
    await markDone(run, 'imported', {
      itemsTotal: items.length,
      itemsAdapted: adapted.length,
      itemsNew: fresh.length,
      itemsUpserted: r.upserted || 0,
    });
  }

  console.log('');
  console.log('[import] summary');
  console.log(`  runs scanned:   ${runs.length}`);
  console.log(`  runs imported:  ${todoRuns.length}`);
  console.log(`  raw items:      ${totalRaw}`);
  console.log(`  adapted:        ${totalAdapted}`);
  console.log(`  skipped (old):  ${totalSkippedOld}`);
  console.log(`  new (not dup):  ${totalNew}`);
  console.log(`  upserted:       ${totalUpserted}`);

  await database.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[import] fatal', err);
  try { await database.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
