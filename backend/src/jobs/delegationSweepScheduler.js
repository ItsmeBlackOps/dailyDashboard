// C19 phase 5 — schedulers for delegation lifecycle.
//
// Two ticks:
//   - sweepExpired       hourly. Marks rows past expiresAt as revoked
//                        and fires per-row in-app notifications.
//   - quarterlyDigest    once per 90 days (also fires on first boot if
//                        the last-sent stamp is missing). Sends each
//                        owner an in-app summary of their active
//                        forever-shares so dead grants surface.
//
// Both gated by env: DELEGATION_SWEEP_ENABLED=1. Without the flag
// they no-op (logged on boot). Avoids surprise runs in non-prod.

import { delegationService } from '../services/delegationService.js';
import { notificationService } from '../services/notificationService.js';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const HOURLY_MS = 60 * 60 * 1000;
const QUARTERLY_MS = 90 * 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 5 * 60 * 1000;

let sweepInterval = null;
let digestInterval = null;
let sweepRunning = false;
let digestRunning = false;

const STATE_COL = 'systemState';
const DIGEST_KEY = 'c19_quarterly_digest';

const getLastDigestAt = async () => {
  try {
    const col = database.getCollection(STATE_COL);
    if (!col) return null;
    const doc = await col.findOne({ _id: DIGEST_KEY });
    return doc?.lastSentAt || null;
  } catch {
    return null;
  }
};

const setLastDigestAt = async (at) => {
  try {
    const col = database.getCollection(STATE_COL);
    if (!col) return;
    await col.updateOne(
      { _id: DIGEST_KEY },
      { $set: { lastSentAt: at } },
      { upsert: true },
    );
  } catch (err) {
    logger.warn('c19 digest: setLastDigestAt failed', { error: err.message });
  }
};

const sweepTick = async () => {
  if (sweepRunning) {
    logger.warn('c19 sweep: previous tick still running, skipping');
    return;
  }
  sweepRunning = true;
  try {
    const count = await delegationService.sweepExpired();
    if (count > 0) {
      logger.info('c19 sweep: expired delegations marked', { count });
    }
  } catch (err) {
    logger.error('c19 sweep: tick failed', { error: err.message });
  } finally {
    sweepRunning = false;
  }
};

const digestTick = async () => {
  if (digestRunning) return;
  digestRunning = true;
  try {
    const last = await getLastDigestAt();
    const now = Date.now();
    if (last && (now - new Date(last).getTime()) < QUARTERLY_MS) {
      // Not time yet.
      return;
    }
    const byOwner = await delegationService.quarterlyDigest();
    if (byOwner.size === 0) {
      await setLastDigestAt(new Date());
      return;
    }
    let sent = 0;
    for (const [ownerEmail, rows] of byOwner) {
      const lines = rows.map((r) => {
        const target = r.scope === 'subtree'
          ? `subtree of ${r.subtreeRootEmail}`
          : `${(r.subjectEmails || []).length} specific subordinate(s)`;
        return `• ${r.delegateEmail} — ${target} (granted ${new Date(r.grantedAt).toLocaleDateString()}${r.reason ? ', ' + r.reason : ''})`;
      });
      await notificationService.createNotification(ownerEmail, {
        type: 'info',
        title: 'Quarterly forever-share review',
        description: `You have ${rows.length} active forever-share(s):\n${lines.join('\n')}\n\nRevoke any that are no longer needed in User Management → My Active Shares.`,
      });
      sent++;
    }
    await setLastDigestAt(new Date());
    logger.info('c19 quarterly digest sent', { ownerCount: sent });
  } catch (err) {
    logger.error('c19 quarterly digest: tick failed', { error: err.message });
  } finally {
    digestRunning = false;
  }
};

export function startDelegationSweepScheduler() {
  if (sweepInterval) {
    logger.warn('c19 sweep: scheduler already started');
    return;
  }
  if (process.env.DELEGATION_SWEEP_ENABLED !== '1') {
    logger.info('c19 sweep: disabled (set DELEGATION_SWEEP_ENABLED=1 to opt in)');
    return;
  }
  setTimeout(() => { sweepTick(); }, STARTUP_DELAY_MS);
  sweepInterval = setInterval(sweepTick, HOURLY_MS);

  // Digest runs less often but checks every hour whether 90 days have
  // passed since the last send.
  setTimeout(() => { digestTick(); }, STARTUP_DELAY_MS + 60_000);
  digestInterval = setInterval(digestTick, HOURLY_MS);

  logger.info('c19 schedulers started', {
    sweepIntervalSec: HOURLY_MS / 1000,
    digestCheckIntervalSec: HOURLY_MS / 1000,
    startupDelaySec: STARTUP_DELAY_MS / 1000,
  });
}

// Test helpers
export const _internals = { sweepTick, digestTick, getLastDigestAt, setLastDigestAt };
