// Admin-only diagnostic endpoint for the Fireflies bot pipeline.
//
// Replaces "give the agent SSH" — exposes the same data we'd grep for
// from a shell: service state, recent audit rows with full Fireflies
// response bodies, config presence check. Hit from a browser logged in
// as admin; paste the JSON back to the diagnostic loop.
//
// Removable in a follow-up PR once the bug is squashed.

import express from 'express';
import { database } from '../config/database.js';
import { firefliesService } from '../services/firefliesService.js';
import { requireHTTPRole } from '../middleware/auth.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/diagnose', requireHTTPRole(['admin']), async (req, res) => {
  try {
    const auditCol = database.getCollection('auditLog');
    const taskCol  = database.getCollection('taskBody');

    const since1h  = new Date(Date.now() - 60 * 60 * 1000);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Service runtime state.
    const serviceState = {
      enabled: Boolean(firefliesService?.enabled),
      isRateLimited: typeof firefliesService?.isRateLimited === 'function'
        ? firefliesService.isRateLimited()
        : null,
      rateLimitedUntilEpochMs: firefliesService?._rateLimitedUntil ?? null,
      rateLimitedUntilISO: firefliesService?._rateLimitedUntil
        ? new Date(firefliesService._rateLimitedUntil).toISOString()
        : null,
    };

    // Config presence — surface whether env vars are set without
    // leaking the actual key. Length + first 8 chars is enough to
    // identify which key is in use without enabling exfiltration.
    const apiKey = config?.fireflies?.apiKey || '';
    const configCheck = {
      apiKeyPresent: Boolean(apiKey),
      apiKeyLength: apiKey.length,
      apiKeyHint: apiKey ? (apiKey.slice(0, 8) + '…') : null,
      graphqlUrl: config?.fireflies?.graphqlUrl || null,
      pacingMs: parseInt(process.env.FIREFLIES_TICK_PACING_MS || '750', 10),
    };

    // Phase distribution last 1h + 24h.
    const phaseDistribution = await Promise.all([
      auditCol.aggregate([
        { $match: { phase: { $regex: /^FIREFLIES_/ }, timestamp: { $gte: since1h } } },
        { $group: { _id: { phase: '$phase', level: '$level' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      auditCol.aggregate([
        { $match: { phase: { $regex: /^FIREFLIES_/ }, timestamp: { $gte: since24h } } },
        { $group: { _id: { phase: '$phase', level: '$level' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
    ]).then(([h1, h24]) => ({ last1h: h1, last24h: h24 }));

    // Recent FIREFLIES_* audit rows with full payload. Cap at 50 to
    // keep response size sane; sufficient to spot the failure shape.
    const recentAudit = await auditCol.find(
      { phase: { $regex: /^FIREFLIES_/ }, timestamp: { $gte: since24h } },
      {
        timestamp: 1, phase: 1, level: 1, detail: 1, subject: 1,
        'extra.candidateName': 1, 'extra.stage': 1, 'extra.taskId': 1,
        'extra.firefliesStatus': 1, 'extra.firefliesBody': 1,
        'extra.retryAfter': 1, 'extra.attemptNumber': 1,
      }
    ).sort({ timestamp: -1 }).limit(50).toArray();

    // botStatus distribution on taskBody.
    const botStatusDistribution = await taskCol.aggregate([
      { $match: { botStatus: { $exists: true, $ne: null } } },
      { $group: { _id: '$botStatus', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray();

    // Tasks stuck pending past their window — most actionable list.
    const cutoff = new Date(Date.now() - 25 * 60 * 1000).toISOString().slice(0, 16);
    const stuckPending = await taskCol.find(
      {
        botStatus: 'pending',
        $or: [
          { interviewDateTime: { $lt: cutoff } },
          { interviewDateTime: { $exists: false }, 'Date of Interview': { $exists: true } },
        ],
      },
      {
        'Candidate Name': 1, interviewDateTime: 1, 'Date of Interview': 1,
        'Start Time Of Interview': 1, meetingLink: 1, joinUrl: 1, joinWebUrl: 1,
        botInviteAttempts: 1,
      }
    ).sort({ interviewDateTime: -1 }).limit(20).toArray();

    // Top terminal failures with full Fireflies body for diagnosis.
    const terminalFailures = await taskCol.find(
      { botStatus: { $in: ['main_failed', 'precheck_failed'] } },
      {
        'Candidate Name': 1, interviewDateTime: 1, botStatus: 1,
        botInviteAttempts: 1, botLastError: 1, subject: 1, Subject: 1,
      }
    ).sort({ interviewDateTime: -1 }).limit(15).toArray();

    return res.json({
      success: true,
      now: new Date().toISOString(),
      serviceState,
      configCheck,
      phaseDistribution,
      recentAudit,
      botStatusDistribution,
      stuckPending,
      terminalFailures,
    });
  } catch (error) {
    logger.error('fireflies diagnose endpoint failed', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
