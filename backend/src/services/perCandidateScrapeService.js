/**
 * Per-candidate Apify scraper.
 *
 * Each active candidate gets their own hourly Apify run with tight,
 * resume-derived filters (titleSearch + descriptionSearch +
 * descriptionExclusionSearch + titleExclusionSearch + bucket + taxonomies).
 *
 * Pay-per-result pricing means empty 1h windows cost ~$0, making this
 * economical at hourly cadence for ~300 candidates. Runs are staggered
 * across the hour by candidate index to avoid concurrency spikes.
 *
 * State: per-candidate row in `candidateScrapeState` with lastTriggeredAt,
 * lastRunId, lastStatus, runsTriggered.
 *
 * Required env:
 *   APIFY_TOKEN
 *
 * Tunables:
 *   PER_CAND_SCRAPE_ENABLED        opt-in flag, default off
 *   PER_CAND_SCRAPE_TIME_RANGE     '1h' | '24h' | '7d' (default '1h')
 *   PER_CAND_SCRAPE_LIMIT          dataset cap per run (default 500)
 *   PER_CAND_SCRAPE_CONCURRENCY    max concurrent in-flight runs (default 6)
 *   PER_CAND_SCRAPE_BATCH          candidates per cron tick (default 60 — fires
 *                                  N candidates each minute, covers 317 in ~6 min)
 */
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { buildCareerSiteInput, buildLinkedInInput } from './candidateApifyInputBuilder.js';

const APIFY = 'https://api.apify.com/v2';
const ACTOR_CAREER_SITE = 'fantastic-jobs~career-site-job-listing-api';
const ACTOR_LINKEDIN    = 'fantastic-jobs~advanced-linkedin-job-search-api';
const STATE_COL = 'candidateScrapeState';

const TIME_RANGE   = process.env.PER_CAND_SCRAPE_TIME_RANGE || '1h';
const LIMIT        = parseInt(process.env.PER_CAND_SCRAPE_LIMIT || '500', 10);
const CONCURRENCY  = parseInt(process.env.PER_CAND_SCRAPE_CONCURRENCY || '6', 10);

let _indexEnsured = false;
async function ensureIndex(db) {
  if (_indexEnsured) return;
  const col = db.collection(STATE_COL);
  await col.createIndex({ candidateId: 1 }, { unique: true, name: 'candidateId_unique' });
  await col.createIndex({ lastTriggeredAt: 1 }, { name: 'last_triggered' });
  await col.createIndex({ scheduleSlotMinute: 1 }, { name: 'slot_minute' });
  _indexEnsured = true;
}

function token() {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error('APIFY_TOKEN env var is required');
  return t;
}

async function startActor(actorId, input) {
  const url = `${APIFY}/acts/${actorId}/runs?token=${token()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Apify start ${actorId} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return body?.data || body;
}

class PerCandidateScrapeService {
  /**
   * Pull active candidates with derived forgeProfile + assign each a
   * stable schedule slot (minute 0..59) so 317 don't fire at :00. Slot
   * is hash(candidateId) % 60.
   */
  async _activeCandidates(db) {
    const rows = await db.collection('candidateDetails').find(
      { status: 'Active', 'forgeProfile.titles.0': { $exists: true } },
      { projection: { _id: 1, 'Candidate Name': 1, forgeProfile: 1, Recruiter: 1 } }
    ).toArray();
    return rows.map((c) => {
      const idStr = String(c._id);
      let h = 0;
      for (let i = 0; i < idStr.length; i++) h = (h * 31 + idStr.charCodeAt(i)) >>> 0;
      return { ...c, scheduleSlotMinute: h % 60 };
    });
  }

  /**
   * Trigger one candidate's actor run. Idempotent on the side of the
   * candidate state row but will start a NEW Apify run every call —
   * it's the scheduler's job to throttle.
   */
  /**
   * Fire BOTH the career-site actor and the LinkedIn actor for one
   * candidate (per their resume-derived forgeProfile). Returns the two
   * runIds. Both calls happen in parallel.
   */
  async triggerOne(candidate) {
    const db = database.getDb();
    await ensureIndex(db);
    const candId = String(candidate._id);
    const opts = { timeRange: TIME_RANGE, limit: LIMIT };

    let csInput, liInput;
    try {
      csInput = buildCareerSiteInput(candidate, opts);
      liInput = buildLinkedInInput(candidate, opts);
    } catch (err) {
      logger.warn('perCandidateScrape: skip — input build failed', {
        candidateId: candId, name: candidate['Candidate Name'], error: err.message,
      });
      await db.collection(STATE_COL).updateOne(
        { candidateId: candId },
        { $set: { lastError: err.message, lastErrorAt: new Date() }, $setOnInsert: { candidateId: candId } },
        { upsert: true }
      );
      return { skipped: true, reason: 'input_build_failed', error: err.message };
    }

    const [csRes, liRes] = await Promise.allSettled([
      startActor(ACTOR_CAREER_SITE, csInput),
      startActor(ACTOR_LINKEDIN, liInput),
    ]);
    const csRunId = csRes.status === 'fulfilled' ? (csRes.value?.id || csRes.value?.runId || '') : '';
    const liRunId = liRes.status === 'fulfilled' ? (liRes.value?.id || liRes.value?.runId || '') : '';
    const errors = [
      csRes.status === 'rejected' ? `careerSite: ${csRes.reason?.message || csRes.reason}` : null,
      liRes.status === 'rejected' ? `linkedin: ${liRes.reason?.message || liRes.reason}` : null,
    ].filter(Boolean);

    await db.collection(STATE_COL).updateOne(
      { candidateId: candId },
      {
        $set: {
          lastTriggeredAt: new Date(),
          lastRunIdCareerSite: csRunId,
          lastRunIdLinkedIn: liRunId,
          lastStatus: errors.length === 0 ? 'started' : (errors.length === 2 ? 'failed' : 'partial'),
          lastError: errors.length > 0 ? errors.join('; ') : null,
          lastErrorAt: errors.length > 0 ? new Date() : null,
          name: candidate['Candidate Name'] || '',
          recruiter: candidate.Recruiter || '',
        },
        $setOnInsert: { candidateId: candId, scheduleSlotMinute: candidate.scheduleSlotMinute },
        $inc: { runsTriggered: 1 },
      },
      { upsert: true }
    );

    if (errors.length > 0) {
      logger.error('perCandidateScrape: actor start error(s)', {
        candidateId: candId, name: candidate['Candidate Name'], errors,
      });
    }
    return {
      careerSiteRunId: csRunId,
      linkedinRunId: liRunId,
      name: candidate['Candidate Name'],
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Fire candidates whose scheduleSlotMinute matches the current minute.
   * Concurrency-bounded; safe to call from a per-minute cron tick.
   */
  async tickForCurrentMinute() {
    const db = database.getDb();
    await ensureIndex(db);
    const minute = new Date().getUTCMinutes();
    const candidates = (await this._activeCandidates(db))
      .filter((c) => c.scheduleSlotMinute === minute);

    if (candidates.length === 0) {
      logger.debug('perCandidateScrape: tick — no candidates in this slot', { minute });
      return { triggered: 0, errors: 0, minute };
    }

    logger.info('perCandidateScrape: tick — firing slot', { minute, candidates: candidates.length });

    let i = 0; let triggered = 0; let errors = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= candidates.length) return;
        const c = candidates[idx];
        const r = await this.triggerOne(c);
        if (r?.errors?.length) errors++;
        else if (r?.careerSiteRunId || r?.linkedinRunId) triggered++;
      }
    });
    await Promise.all(workers);
    return { triggered, errors, minute, totalInSlot: candidates.length };
  }

  /** State summary for the admin dashboard. */
  async stats() {
    const db = database.getDb();
    await ensureIndex(db);
    const col = db.collection(STATE_COL);
    const [total, withRecentRun, withErrors] = await Promise.all([
      col.countDocuments({}),
      col.countDocuments({ lastTriggeredAt: { $gt: new Date(Date.now() - 90 * 60 * 1000) } }),
      col.countDocuments({ lastError: { $ne: null }, lastErrorAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    ]);
    return { total, withRecentRun, withErrors };
  }
}

export const perCandidateScrapeService = new PerCandidateScrapeService();
