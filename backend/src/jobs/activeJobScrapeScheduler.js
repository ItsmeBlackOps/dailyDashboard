/**
 * Active candidate auto-scrape scheduler.
 *
 * Runs on container startup (after a short delay so DB / scraper come up
 * cleanly) and then twice a day (every 12 hours). Each batch:
 *
 *   1. Lists active candidates (status='Active') that have a resumeLink.
 *   2. Ensures each has a derived forgeProfile (gpt-4o-mini) — cached
 *      result is reused when derivedFrom matches the resume URL, so this
 *      is cheap on subsequent runs.
 *   3. Triggers a per-candidate job-search session via jobSearchService.
 *      The scraper script's incremental-state volume tracks each
 *      candidate's last_run_at and switches from a 7d window (first run)
 *      to a 24h window with datePostedAfter narrowing (subsequent runs).
 *
 * Concurrency is capped to avoid hammering Apify. The schedule reuses
 * setInterval (no external cron lib) for simplicity; restarting the
 * container resets the timer but the immediate-on-boot run keeps things
 * caught up.
 */
import { database } from '../config/database.js';
import { resumeProfileService } from '../services/resumeProfileService.js';
import { jobSearchService } from '../services/jobSearchService.js';
import { logger } from '../utils/logger.js';

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30 * 1000;
const DEFAULT_CONCURRENCY = parseInt(process.env.ACTIVE_JOB_SCRAPE_CONCURRENCY || '2', 10);

let interval = null;
let runInProgress = false;

async function runOnce() {
  if (runInProgress) {
    logger.warn('activeJobScrape: previous batch still running, skipping');
    return;
  }
  runInProgress = true;
  const start = Date.now();
  logger.info('activeJobScrape: batch run starting');

  try {
    const db = database.getDb();
    const candidates = await db.collection('candidateDetails').find(
      {
        status: 'Active',
        $or: [
          { resumeLink: { $type: 'string', $ne: '' } },
          { resumeUrl:  { $type: 'string', $ne: '' } },
        ],
      },
      {
        projection: {
          _id: 1, resumeLink: 1, resumeUrl: 1, forgeProfile: 1, 'Candidate Name': 1,
        },
      }
    ).toArray();

    logger.info(`activeJobScrape: ${candidates.length} active candidate(s) to process`);

    const stats = {
      total: candidates.length,
      derivedFresh: 0,
      derivedCached: 0,
      derivedFailed: 0,
      scrapeStarted: 0,
      scrapeFailed: 0,
      skippedNoProfile: 0,
    };

    let i = 0;
    async function worker() {
      while (i < candidates.length) {
        const c = candidates[i++];
        const cid = c._id.toString();
        const resumeUrl = c.resumeLink || c.resumeUrl;
        if (!resumeUrl) continue;

        try {
          const beforeDeriveAt = c.forgeProfile?.derivedAt
            ? new Date(c.forgeProfile.derivedAt).getTime()
            : 0;
          const profile = await resumeProfileService.deriveAndStore({
            candidateId: cid,
            resumeUrl,
            force: false,
          });
          const afterDeriveAt = profile?.derivedAt
            ? new Date(profile.derivedAt).getTime()
            : 0;
          if (afterDeriveAt > beforeDeriveAt) {
            stats.derivedFresh++;
          } else {
            stats.derivedCached++;
          }

          if (!profile?.titles?.length) {
            stats.skippedNoProfile++;
            logger.warn('activeJobScrape: empty forgeProfile, skipping scrape', { cid });
            continue;
          }
        } catch (e) {
          stats.derivedFailed++;
          logger.error('activeJobScrape: derivation failed', { cid, error: e.message });
          continue;
        }

        try {
          await jobSearchService.startSearch({
            candidateId: cid,
            candidateName: c['Candidate Name'] || '',
            requestedBy: 'system:activeJobScrape',
            filters: {},
          });
          stats.scrapeStarted++;
        } catch (e) {
          stats.scrapeFailed++;
          logger.error('activeJobScrape: startSearch failed', { cid, error: e.message });
        }
      }
    }

    const concurrency = Math.max(1, DEFAULT_CONCURRENCY);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    logger.info('activeJobScrape: batch complete', {
      ms: Date.now() - start,
      ...stats,
    });
  } catch (err) {
    logger.error('activeJobScrape: batch failed', { error: err.message });
  } finally {
    runInProgress = false;
  }
}

export function startActiveJobScrapeScheduler() {
  if (interval) {
    logger.warn('activeJobScrape: scheduler already started');
    return;
  }
  // Default OFF as of the pool-model migration — per-candidate auto-scrape
  // is the wrong shape: every candidate fires its own Apify run, costs
  // explode, and most fail at the YoE guard when forgeProfile.years_max=0.
  // Opt back in only via ACTIVE_JOB_SCRAPE_ENABLED=1 if you really want
  // per-candidate scrapes alongside the daily pool import.
  if (process.env.ACTIVE_JOB_SCRAPE_ENABLED !== '1') {
    logger.info('activeJobScrape: disabled by default (set ACTIVE_JOB_SCRAPE_ENABLED=1 to opt in)');
    return;
  }
  if (process.env.ACTIVE_JOB_SCRAPE_DISABLED === '1') {
    logger.info('activeJobScrape: disabled via ACTIVE_JOB_SCRAPE_DISABLED=1');
    return;
  }
  // Initial boot run after a short delay so DB / scraper container settle.
  setTimeout(() => {
    runOnce().catch((err) =>
      logger.error('activeJobScrape: boot run threw', { error: err.message })
    );
  }, STARTUP_DELAY_MS);

  // Twice a day after that.
  interval = setInterval(() => {
    runOnce().catch((err) =>
      logger.error('activeJobScrape: scheduled run threw', { error: err.message })
    );
  }, TWELVE_HOURS_MS);

  logger.info('activeJobScrape scheduler started — boot run in 30s, then every 12h');
}

// Exported for testing
export const _runOnce = runOnce;
