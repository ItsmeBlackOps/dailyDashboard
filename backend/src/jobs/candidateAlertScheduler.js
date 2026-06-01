// PRT Phase 4 — daily candidate alert scheduler.
//
// Fires once per 24h at 02:00 IST. Per tick:
//   1. Cursor over { status: {$in: ['Active','New']}, eadEndDate: {$exists:true,$ne:null} }
//   2. Recompute expiringInDays + daysInMarketing; $set them on the doc
//      (so they're index-backed for "Expiring soon" filters).
//   3. If expiringInDays < 30 AND no CandidateEadExpiring fired for
//      this candidate in the last 7 days:
//        - emit CandidateEadExpiring on the domain bus
//        - in-app notify recruiter + team lead (always)
//        - email recipients with preferences.eadEmailAlerts === true
//          (app-only Graph token; no clicker context)
//        - $set lastEadAlertAt = now for the 7-day dedupe window
//   4. Per-candidate try/catch — log and continue.
//
// Modelled on firefliesBotScheduler.js (same setInterval + tick pattern).
// Exported `_tick` lets tests call a single pass without the scheduler.

import moment from 'moment-timezone';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { domainEventBus } from '../events/eventBus.js';
import { DomainEvents } from '../events/eventTypes.js';
import { notificationService } from '../services/notificationService.js';
import { graphMailService } from '../services/graphMailService.js';
import { userModel } from '../models/User.js';
import { config } from '../config/index.js';

const TIMEZONE = 'Asia/Kolkata';
const DAILY_HOUR = 2;       // 02:00 IST
const DAILY_MINUTE = 0;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ALERT_DEDUPE_WINDOW_MS = 7 * MS_PER_DAY;
const EXPIRING_THRESHOLD_DAYS = 30;

function toDateOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function computeMsUntilNextRun(now = new Date()) {
  const nowIst = moment(now).tz(TIMEZONE);
  let next = nowIst.clone()
    .hour(DAILY_HOUR)
    .minute(DAILY_MINUTE)
    .second(0)
    .millisecond(0);
  if (!next.isAfter(nowIst)) {
    next = next.add(1, 'day');
  }
  return next.valueOf() - now.getTime();
}

function buildAlertEmailPayload({ recipientEmail, candidateName, expiringInDays, eadEndDate, candidateId }) {
  const niceDate = eadEndDate
    ? moment(eadEndDate).tz(TIMEZONE).format('DD MMM YYYY')
    : 'unknown';
  const link = `${(config?.frontend?.appUrl || '').replace(/\/$/, '')}/candidate/${candidateId}`;
  const linkHtml = link.endsWith(`/candidate/${candidateId}`) && link.startsWith('http')
    ? `<p><a href="${link}">Open candidate</a></p>`
    : '';
  const subject = `Candidate EAD expiring soon — ${candidateName} (${expiringInDays} day${expiringInDays === 1 ? '' : 's'})`;
  const html = [
    `<p>Heads up — <strong>${candidateName}</strong>'s EAD is expiring in <strong>${expiringInDays} day${expiringInDays === 1 ? '' : 's'}</strong>.</p>`,
    `<p>EAD end date: <strong>${niceDate}</strong></p>`,
    linkHtml,
    `<p style="color:#888;font-size:12px;">You're receiving this because you opted in to PRT EAD email alerts. Toggle this off in your dashboard settings.</p>`
  ].join('');
  return {
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: recipientEmail } }]
    },
    saveToSentItems: false
  };
}

async function tick(nowOverride) {
  const now = nowOverride instanceof Date ? nowOverride : new Date();
  const db = database.getDb();
  if (!db) {
    logger.warn('candidateAlertScheduler tick skipped — DB not ready');
    return { scanned: 0, alerted: 0, errors: 0 };
  }
  const candidates = db.collection('candidateDetails');
  const cursor = candidates.find({
    status: { $in: ['Active', 'New'] },
    eadEndDate: { $exists: true, $ne: null }
  }, {
    projection: {
      _id: 1,
      'Candidate Name': 1, name: 1,
      Recruiter: 1, recruiter: 1,
      teamLead: 1,
      eadEndDate: 1,
      marketingStartDate: 1,
      lastEadAlertAt: 1
    }
  });

  let scanned = 0;
  let alerted = 0;
  let errors = 0;

  for await (const doc of cursor) {
    scanned += 1;
    try {
      const eadEnd = toDateOrNull(doc.eadEndDate);
      const marketingStart = toDateOrNull(doc.marketingStartDate);
      const expiringInDays = eadEnd
        ? Math.floor((eadEnd.getTime() - now.getTime()) / MS_PER_DAY)
        : null;
      const daysInMarketing = marketingStart
        ? Math.floor((now.getTime() - marketingStart.getTime()) / MS_PER_DAY)
        : null;

      const $set = {
        expiringInDays,
        daysInMarketing,
        lastAlertScanAt: now
      };

      const lastAlert = toDateOrNull(doc.lastEadAlertAt);
      const shouldAlert =
        expiringInDays !== null &&
        expiringInDays < EXPIRING_THRESHOLD_DAYS &&
        (!lastAlert || now.getTime() - lastAlert.getTime() >= ALERT_DEDUPE_WINDOW_MS);

      if (shouldAlert) {
        $set.lastEadAlertAt = now;
      }

      await candidates.updateOne({ _id: doc._id }, { $set });

      if (!shouldAlert) continue;

      const candidateName = doc['Candidate Name'] || doc.name || 'candidate';
      const candidateId = doc._id?.toString?.() || String(doc._id);

      // Recipients: recruiter + team lead. Lowercase, dedupe, drop empties.
      const recruiterEmail = (doc.recruiter || doc.Recruiter || '').toString().trim().toLowerCase();
      const teamLeadEmail = (doc.teamLead || '').toString().trim().toLowerCase();
      const recipients = [...new Set([recruiterEmail, teamLeadEmail].filter(Boolean))];
      if (recipients.length === 0) {
        logger.debug('EAD alert skipped — no recipients on candidate', { candidateId });
        continue;
      }

      // In-app notifications — fire for everyone, opt-in is for email only.
      await notificationService.broadcastToWatchers(recipients, {
        type: 'ead-expiring',
        title: 'EAD expiring soon',
        description: `${candidateName} — ${expiringInDays} day${expiringInDays === 1 ? '' : 's'} left`,
        candidateId,
        link: `/candidate/${candidateId}`,
        meta: { expiringInDays, eadEndDate: eadEnd?.toISOString() ?? null }
      });

      // Opt-in email — per-recipient lookup so an opted-in user gets
      // the mail even if their teammate hasn't opted in.
      for (const email of recipients) {
        try {
          const userRecord = userModel.getUserByEmail(email);
          if (!userRecord?.preferences?.eadEmailAlerts) continue;
          const payload = buildAlertEmailPayload({
            recipientEmail: email,
            candidateName,
            expiringInDays,
            eadEndDate: eadEnd,
            candidateId
          });
          await graphMailService.sendApplicationMail(payload);
        } catch (mailErr) {
          // Per-recipient failures don't fail the whole alert pass.
          logger.warn('EAD alert email send failed (per-recipient)', {
            candidateId,
            recipient: email,
            error: mailErr?.message
          });
        }
      }

      domainEventBus.publish(DomainEvents.CandidateEadExpiring, {
        eventId: `${candidateId}-${now.getTime()}`,
        candidateId,
        candidateName,
        expiringInDays,
        eadEndDate: eadEnd ? eadEnd.toISOString() : null,
        recipients,
        occurredAt: now.toISOString()
      });

      alerted += 1;
    } catch (err) {
      errors += 1;
      logger.error('candidateAlertScheduler per-candidate error', {
        candidateId: doc?._id?.toString?.() || null,
        error: err?.message
      });
    }
  }

  logger.info('candidateAlertScheduler tick complete', { scanned, alerted, errors });
  return { scanned, alerted, errors };
}

let scheduled = null;
let interval = null;

export function startCandidateAlertScheduler() {
  if (scheduled || interval) {
    logger.warn('candidateAlertScheduler already started — ignoring duplicate start');
    return;
  }
  const ms = computeMsUntilNextRun();
  logger.info('candidateAlertScheduler scheduled', {
    timezone: TIMEZONE,
    dailyHour: DAILY_HOUR,
    msUntilFirstRun: ms
  });
  scheduled = setTimeout(() => {
    scheduled = null;
    tick().catch((err) =>
      logger.error('candidateAlertScheduler first tick threw', { error: err.message })
    );
    interval = setInterval(() => {
      tick().catch((err) =>
        logger.error('candidateAlertScheduler tick threw', { error: err.message })
      );
    }, MS_PER_DAY);
  }, ms);
}

export function stopCandidateAlertScheduler() {
  if (scheduled) {
    clearTimeout(scheduled);
    scheduled = null;
  }
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

// Exported for tests + an admin /api/admin/run-ead-alerts endpoint
// (not wired in v1 — add when ops need on-demand triggers).
export const _tick = tick;
