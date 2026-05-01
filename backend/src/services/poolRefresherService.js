/**
 * Pool refresher — kicks off fresh Apify runs on a schedule using
 * `timeRange=1h` (both Fantastic Jobs career-site actor and LinkedIn
 * actor) so each call only returns postings from the last hour.
 *
 * Runs land as new actor-runs in Apify; the existing
 * jobsPoolImportScheduler picks them up on its next tick and ingests
 * the dataset items into jobsPool.
 *
 * State (mongo collection `poolRefresherState`):
 *   { key, lastTriggerAt, lastDatePostedAfter, lastRunId, lastStatus, updatedAt }
 *
 * Required env:
 *   APIFY_TOKEN — same token the scraper uses
 *
 * Optional env (for tuning):
 *   POOL_REFRESH_FANTASTIC_TITLE_CAP    max titles passed to actor (default 25)
 *   POOL_REFRESH_FANTASTIC_LIMIT        max items per actor run (default 500)
 *   POOL_REFRESH_FANTASTIC_TIME_RANGE   1h|24h|7d|30d (default 1h)
 *   POOL_REFRESH_LINKEDIN_LIMIT         max items per LinkedIn run (default 200)
 */
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { jobsPoolService, normalizeTitle } from './jobsPoolService.js';

const APIFY = 'https://api.apify.com/v2';
const STATE_COL = 'poolRefresherState';

const FANTASTIC_ACTOR = 'fantastic-jobs~career-site-job-listing-api';
const LINKEDIN_ACTOR  = 'fantastic-jobs~advanced-linkedin-job-search-api';

const FANTASTIC_TITLE_CAP   = parseInt(process.env.POOL_REFRESH_FANTASTIC_TITLE_CAP || '25', 10);
const FANTASTIC_LIMIT       = parseInt(process.env.POOL_REFRESH_FANTASTIC_LIMIT     || '500', 10);
// Career-site actor exposes a `timeRange` enum, NOT a `datePostedAfter`
// timestamp. Valid values per Apify schema: 1h | 24h | 7d | 30d.
// We poll hourly so 1h is the right default (matches the LinkedIn actor).
const FANTASTIC_TIME_RANGE  = process.env.POOL_REFRESH_FANTASTIC_TIME_RANGE || '1h';
const LINKEDIN_LIMIT        = parseInt(process.env.POOL_REFRESH_LINKEDIN_LIMIT      || '200', 10);

// Full 50-state + DC + Remote list for locationSearch. The actor uses
// `:*` wildcards to expand a state into all of its localities. This
// ensures we don't miss postings tagged "Plano, TX" when only
// "Texas:*" was queried — the actor handles the expansion server-side.
const FANTASTIC_LOCATION_SEARCH = [
  'United States',
  'Alabama:*', 'Alaska:*', 'Arizona:*', 'Arkansas:*', 'California:*',
  'Colorado:*', 'Connecticut:*', 'Delaware:*', 'Florida:*', 'Georgia:*',
  'Hawaii:*', 'Idaho:*', 'Illinois:*', 'Indiana:*', 'Iowa:*',
  'Kansas:*', 'Kentucky:*', 'Louisiana:*', 'Maine:*', 'Maryland:*',
  'Massachusetts:*', 'Michigan:*', 'Minnesota:*', 'Mississippi:*', 'Missouri:*',
  'Montana:*', 'Nebraska:*', 'Nevada:*', 'New Hampshire:*', 'New Jersey:*',
  'New Mexico:*', 'New York:*', 'North Carolina:*', 'North Dakota:*', 'Ohio:*',
  'Oklahoma:*', 'Oregon:*', 'Pennsylvania:*', 'Rhode Island:*', 'South Carolina:*',
  'South Dakota:*', 'Tennessee:*', 'Texas:*', 'Utah:*', 'Vermont:*',
  'Virginia:*', 'Washington:*', 'West Virginia:*', 'Wisconsin:*', 'Wyoming:*',
  'District of Columbia:*',
  'Remote',
];

function token() {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error('APIFY_TOKEN env var is required');
  return t;
}

async function getState(key) {
  const db = database.getDb();
  return db.collection(STATE_COL).findOne({ key });
}

async function setState(key, patch) {
  const db = database.getDb();
  await db.collection(STATE_COL).updateOne(
    { key },
    { $set: { ...patch, updatedAt: new Date() }, $setOnInsert: { key } },
    { upsert: true }
  );
}

/**
 * Pull the active candidate snapshot and return the most-common
 * title shapes (raw, not normalized) for actor titleSearch input.
 * Caps at FANTASTIC_TITLE_CAP because Apify's titleSearch becomes
 * unwieldy past ~30 entries.
 */
async function getActiveTitles(cap = FANTASTIC_TITLE_CAP) {
  const db = database.getDb();
  const snap = await jobsPoolService._getActiveCandidateSnapshot(db);
  // Frequency-rank normalized titles, then return top N in their
  // original casing as Apify expects them.
  const counts = new Map();
  const originalByNorm = new Map();
  for (const c of snap) {
    for (const t of c.titles) {
      counts.set(t, (counts.get(t) || 0) + 1);
      if (!originalByNorm.has(t)) {
        // Best-effort original casing: title-case the normalized.
        originalByNorm.set(
          t,
          t.replace(/\b\w/g, (m) => m.toUpperCase())
        );
      }
    }
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap)
    .map(([norm]) => originalByNorm.get(norm));
  return ranked;
}

async function startActor(actorId, runInput) {
  const url = `${APIFY}/acts/${encodeURIComponent(actorId)}/runs?token=${token()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(runInput),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Apify start ${actorId} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return body?.data || body;
}

class PoolRefresherService {
  /**
   * Trigger a Fantastic Jobs (career-site-job-listing-api) run.
   *
   * IMPORTANT: this actor exposes `timeRange` (enum: 1h|24h|7d|30d),
   * NOT a `datePostedAfter` ISO timestamp. We poll hourly with
   * timeRange=1h so each run only returns postings from the last
   * hour — keeps Apify cost + JD-enrich cost minimal.
   *
   * Returns { runId, timeRange, titles }.
   */
  async triggerFantasticJobs() {
    const titles = await getActiveTitles();
    if (titles.length === 0) {
      logger.warn('poolRefresher: no active titles to scan');
      return { skipped: true, reason: 'no_titles' };
    }

    const runInput = {
      titleSearch: titles,
      locationSearch: FANTASTIC_LOCATION_SEARCH,
      timeRange: FANTASTIC_TIME_RANGE,           // '1h' default — hourly cadence
      includeAi: true,
      includeLinkedIn: false,
      removeAgency: false,                       // per spec (PR #52)
      noDirectApply: true,                       // skip aggregator/direct-apply boards
      descriptionType: 'text',
      EmploymentTypeFilter: ['FULL_TIME', 'CONTRACTOR'],
      aiWorkArrangementFilter: ['On-site', 'Hybrid', 'Remote OK', 'Remote Solely'],
      seniorityFilter: ['Mid-Senior level', 'Associate', 'Director', 'Entry level'],
      aiHasSalary: false,
      aiVisaSponsorshipFilter: false,
      limit: FANTASTIC_LIMIT,
      populateAiRemoteLocation: false,
      populateAiRemoteLocationDerived: false,
    };

    logger.info('poolRefresher: starting Fantastic Jobs run', {
      titles: titles.length,
      locations: FANTASTIC_LOCATION_SEARCH.length,
      timeRange: FANTASTIC_TIME_RANGE,
      limit: FANTASTIC_LIMIT,
    });
    const run = await startActor(FANTASTIC_ACTOR, runInput);
    const runId = run?.id || run?.runId || '';

    await setState('fantastic_jobs', {
      lastTriggerAt: new Date(),
      lastTimeRange: FANTASTIC_TIME_RANGE,
      lastRunId: runId,
      lastStatus: 'started',
    });

    return { runId, timeRange: FANTASTIC_TIME_RANGE, titles: titles.length };
  }

  /**
   * Trigger a LinkedIn run with timeRange=1h. titleSearch from active
   * candidates. Returns { runId, titles }.
   */
  async triggerLinkedIn() {
    const titles = await getActiveTitles();
    if (titles.length === 0) return { skipped: true, reason: 'no_titles' };

    const runInput = {
      titleSearch: titles,
      timeRange: '1h',                  // hourly window per user spec
      remote: true,                     // remote jobs
      excludeATSDuplicate: true,
      seniorityFilter: ['Mid-Senior level', 'Associate', 'Director', 'Entry level'],
      EmploymentTypeFilter: ['Full-time', 'Contract'],
      limit: LINKEDIN_LIMIT,
    };

    logger.info('poolRefresher: starting LinkedIn run', {
      titles: titles.length, timeRange: '1h', limit: LINKEDIN_LIMIT,
    });
    const run = await startActor(LINKEDIN_ACTOR, runInput);
    const runId = run?.id || run?.runId || '';

    await setState('linkedin', {
      lastTriggerAt: new Date(),
      lastRunId: runId,
      lastStatus: 'started',
    });

    return { runId, titles: titles.length };
  }

  async stats() {
    const db = database.getDb();
    const rows = await db.collection(STATE_COL).find({}).toArray();
    return rows.reduce((acc, r) => ({ ...acc, [r.key]: {
      lastTriggerAt: r.lastTriggerAt,
      lastDatePostedAfter: r.lastDatePostedAfter,
      lastRunId: r.lastRunId,
      lastStatus: r.lastStatus,
    } }), {});
  }
}

export const poolRefresherService = new PoolRefresherService();
