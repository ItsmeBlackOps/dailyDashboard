#!/usr/bin/env node
/**
 * Per-candidate Apify cost validation.
 *
 * Pulls 5 representative candidates from candidateDetails, builds their
 * tight per-candidate Apify input (timeRange=1h with title/desc/exclusion
 * filters + bucket), then either:
 *   - dry-run (default): prints each input as JSON for inspection
 *   - --trigger: actually starts the Apify actor for each, prints runId
 *     so you can read the billing line item from the Apify dashboard
 *
 * After --trigger, wait ~3 minutes for runs to finish, then run with
 * --report=<runIds-comma-separated> to fetch finished-run stats and
 * compute cost-per-empty-run + cost-per-result.
 *
 * Required env:
 *   MONGODB_URI
 *   APIFY_TOKEN  (for --trigger and --report)
 *
 * Usage:
 *   node backend/scripts/validate-candidate-cost.mjs              # dry-run
 *   node backend/scripts/validate-candidate-cost.mjs --trigger    # fires 5 runs
 *   node backend/scripts/validate-candidate-cost.mjs --report=ID1,ID2,ID3
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { buildCareerSiteInput, buildLinkedInInput } from '../src/services/candidateApifyInputBuilder.js';

const APIFY = 'https://api.apify.com/v2';
const ACTOR_CS = 'fantastic-jobs~career-site-job-listing-api';
const ACTOR_LI = 'fantastic-jobs~advanced-linkedin-job-search-api';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.startsWith('--') ? a.slice(2).split('=') : [a, true];
  return [k, v ?? true];
}));

function uriFromEnv() {
  const u = process.env.MONGODB_URI;
  if (!u) throw new Error('MONGODB_URI env var is required');
  return u;
}

async function loadCandidates(client) {
  const db = client.db('interviewSupport');
  // 5 representative candidates spanning experience + role families.
  const namePatterns = [
    /nakshith sadashiva/i,        // 1-2 yrs, Data Analyst
    /aniket pramod/i,             // 3-5 yrs, Data Analyst flavor
    /rathin pothani/i,            // 3-5 yrs, SWE/full-stack
    /prathyusha dora/i,           // 3-4 yrs, Business Analyst
    /venkatesh nagasamudram/i,    // 3-3 yrs, Java/full-stack
  ];
  const out = [];
  for (const pat of namePatterns) {
    const c = await db.collection('candidateDetails').findOne(
      { 'Candidate Name': pat, 'forgeProfile.titles.0': { $exists: true } },
      { projection: { 'Candidate Name': 1, forgeProfile: 1, status: 1 } }
    );
    if (c) out.push(c);
  }
  return out;
}

async function startActor(actorId, input) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN env var is required for --trigger');
  const url = `${APIFY}/acts/${actorId}/runs?token=${token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Apify start ${actorId} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  return body?.data || body;
}

async function getRun(runId) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN required');
  const res = await fetch(`${APIFY}/actor-runs/${runId}?token=${token}`);
  if (!res.ok) throw new Error(`Apify get-run ${res.status}`);
  const body = await res.json();
  return body?.data || body;
}

async function runDry(client) {
  const cands = await loadCandidates(client);
  console.log(`\n=== Dry-run: ${cands.length} candidate × 2 actors = ${cands.length * 2} inputs ===\n`);
  for (const c of cands) {
    const cs = buildCareerSiteInput(c);
    const li = buildLinkedInInput(c);
    console.log(`### ${c['Candidate Name']}  (years ${c.forgeProfile.years_min}-${c.forgeProfile.years_max})`);
    console.log(`  bucket: ${JSON.stringify(cs.aiExperienceLevelFilter)}`);
    console.log(`  titleSearch (${cs.titleSearch.length}): ${JSON.stringify(cs.titleSearch).slice(0,200)}…`);
    console.log(`  titleExclusion: ${JSON.stringify(cs.titleExclusionSearch)}`);
    console.log(`  descriptionSearch (${cs.descriptionSearch.length}): ${JSON.stringify(cs.descriptionSearch)}`);
    console.log(`  descriptionExclusion (${cs.descriptionExclusionSearch.length}): ${JSON.stringify(cs.descriptionExclusionSearch)}`);
    console.log(`  taxonomies: ${JSON.stringify(cs.aiTaxonomiesPrimaryFilter)}`);
    console.log(`  career-site: noDirectApply=${cs.noDirectApply}, employmentType=${JSON.stringify(cs.aiEmploymentTypeFilter)}, timeRange=${cs.timeRange}`);
    console.log(`  linkedin   : datePostedAfter=${li.datePostedAfter}, remote=${li.remote}, excludeATSDuplicate=${li.excludeATSDuplicate}`);
    console.log('');
  }
  console.log(`Run with --trigger to fire ${cands.length * 2} runs and read cost from Apify billing.`);
}

async function runTrigger(client) {
  const cands = await loadCandidates(client);
  console.log(`\n=== Triggering ${cands.length} candidate × 2 actors = ${cands.length * 2} Apify runs ===\n`);
  const triggered = [];
  for (const c of cands) {
    const csInput = buildCareerSiteInput(c);
    const liInput = buildLinkedInInput(c);
    const [csR, liR] = await Promise.allSettled([
      startActor(ACTOR_CS, csInput),
      startActor(ACTOR_LI, liInput),
    ]);
    const csId = csR.status === 'fulfilled' ? (csR.value?.id || csR.value?.runId || '') : '';
    const liId = liR.status === 'fulfilled' ? (liR.value?.id || liR.value?.runId || '') : '';
    if (csR.status === 'rejected') console.error(`  [cs failed] ${c['Candidate Name']}: ${csR.reason?.message}`);
    else { console.log(`  [cs started] ${c['Candidate Name']}: runId=${csId}`); triggered.push(csId); }
    if (liR.status === 'rejected') console.error(`  [li failed] ${c['Candidate Name']}: ${liR.reason?.message}`);
    else { console.log(`  [li started] ${c['Candidate Name']}: runId=${liId}`); triggered.push(liId); }
  }
  console.log('\nWait ~3 minutes for runs to finish, then re-run with:');
  console.log(`  node backend/scripts/validate-candidate-cost.mjs --report=${triggered.join(',')}`);
}

async function runReport(runIdsCsv) {
  const ids = String(runIdsCsv || '').split(',').filter(Boolean);
  if (ids.length === 0) {
    console.error('--report requires comma-separated runIds');
    return;
  }
  console.log(`\n=== Apify run report for ${ids.length} runs ===\n`);
  let totalRows = 0;
  let totalUsd = 0;
  let totalEmptyRuns = 0;
  for (const id of ids) {
    try {
      const r = await getRun(id);
      const rows = r?.stats?.outputBodyLen || r?.defaultDatasetItemCount || 0;
      const usd = Number(r?.usageTotalUsd || 0);
      const status = r?.status || '?';
      const dur = r?.stats?.runTimeSecs ?? '?';
      const empty = (r?.defaultDatasetItemCount || 0) === 0;
      if (empty) totalEmptyRuns++;
      totalRows += (r?.defaultDatasetItemCount || 0);
      totalUsd += usd;
      console.log(`  runId=${id}  status=${status}  duration=${dur}s  rows=${r?.defaultDatasetItemCount || 0}  usageUsd=$${usd.toFixed(4)}`);
    } catch (e) {
      console.error(`  runId=${id}  ERROR: ${e.message}`);
    }
  }
  console.log(`\nTotals across ${ids.length} runs:`);
  console.log(`  empty runs (0 rows): ${totalEmptyRuns}/${ids.length}`);
  console.log(`  total rows         : ${totalRows}`);
  console.log(`  total usage USD    : $${totalUsd.toFixed(4)}`);
  console.log(`  avg per run        : $${(totalUsd / ids.length).toFixed(4)}`);
  console.log(`\nProjected hourly cost @ 317 candidates × 2 actors × 24 hrs:`);
  const avg = totalUsd / ids.length;
  console.log(`  ${(avg * 317 * 2 * 24).toFixed(2)} USD/day`);
  console.log(`  ${(avg * 317 * 2 * 24 * 30).toFixed(2)} USD/month`);
}

async function main() {
  if (args.report) {
    await runReport(args.report);
    return;
  }
  const client = new MongoClient(uriFromEnv(), { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  try {
    if (args.trigger) await runTrigger(client);
    else await runDry(client);
  } finally {
    await client.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
