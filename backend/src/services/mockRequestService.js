// mockRequestService — the Mock Support status machine + business logic.
//
// Spec: docs/superpowers/specs/2026-06-12-mock-support-design.md
// PR-1 scope: create (candidate picker scope, expert prefill, linked
// interview references, checklist), list (visibility), and the status
// transitions through `completed`. Chat (PR-2), meeting materialization
// + recording (PR-3), and the auto mock-debrief (PR-4) come later — the
// fields they need are reserved on the document here.

import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { userModel } from '../models/User.js';
import { candidateModel } from '../models/Candidate.js';
import { mockRequestModel, DEFAULT_CHECKLIST } from '../models/MockRequest.js';
import { logger } from '../utils/logger.js';

const LEAD_ROLES = new Set(['lead', 'mlead', 'am', 'mam', 'teamlead', 'assistantmanager']);
const EXPERT_ROLES = new Set(['user', 'expert']);
const MAX_LINKED = 10;

const norm = (v) => (v || '').toString().trim().toLowerCase();
const normName = (v) => norm(v).replace(/\s+/g, ' ');

const err = (message, statusCode = 400) => {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
};

// Legal transitions: from-status → allowed next states.
const TRANSITIONS = {
  requested: ['in_progress', 'cancelled'],
  in_progress: ['scheduling', 'cancelled'],
  scheduling: ['scheduled', 'recruiter_blocker', 'cancelled'],
  recruiter_blocker: ['scheduling', 'cancelled'],
  scheduled: ['meeting_created', 'scheduling', 'cancelled'],
  meeting_created: ['connected', 'scheduling', 'cancelled'],
  connected: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

class MockRequestService {
  // ── helpers ──────────────────────────────────────────────────────────

  deriveDisplayNameFromEmail(email) {
    const local = (email || '').split('@')[0] || '';
    return local
      .split(/[._]/)
      .filter(Boolean)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');
  }

  legacyRole(user) {
    return norm(user?.role);
  }

  allUsersActive() {
    // userModel keeps an in-memory cache (Map email→doc) refreshed via
    // change stream; values() is the cheapest roster read.
    return Array.from(userModel.cache?.values?.() || []).filter((u) => u.active !== false);
  }

  /** Display names of the lead's direct reports (teamLead string match). */
  reportsOf(leadEmail) {
    const leadDisplay = normName(this.deriveDisplayNameFromEmail(leadEmail));
    if (!leadDisplay) return [];
    return this.allUsersActive().filter((u) => normName(u.teamLead) === leadDisplay);
  }

  /**
   * Candidates the requesting lead may pick for a mock: those whose
   * Expert is one of the lead's reports, status Active/New. Admin → all
   * active/new. Returns slim rows for the picker.
   */
  async candidatesForLead(actor) {
    const col = candidateModel.collection;
    if (!col) throw err('Database not ready', 503);
    const isAdmin = this.legacyRole(actor) === 'admin';
    const q = { status: { $in: ['Active', 'New'] } };
    if (!isAdmin) {
      const reportEmails = this.reportsOf(actor.email).map((u) => norm(u.email));
      // a lead is also an expert-of-record sometimes; include self.
      reportEmails.push(norm(actor.email));
      if (reportEmails.length === 0) return [];
      q.Expert = { $in: reportEmails };
    }
    const rows = await col
      .find(q, {
        projection: {
          'Candidate Name': 1, 'Email ID': 1, Expert: 1, Recruiter: 1,
          Technology: 1, Branch: 1, status: 1,
        },
      })
      .limit(500)
      .toArray();
    return rows.map((c) => ({
      candidateId: String(c._id),
      name: c['Candidate Name'] || '',
      emailId: c['Email ID'] || '',
      expert: norm(c.Expert),
      recruiter: norm(c.Recruiter),
      technology: c.Technology || '',
      branch: c.Branch || '',
      status: c.status || '',
    }));
  }

  /** Recent interview tasks for a candidate — offered as references. */
  async interviewTasksForCandidate(emailId) {
    const taskCol = database.getCollection('taskBody');
    if (!taskCol || !emailId) return [];
    const rows = await taskCol
      .find(
        { 'Email ID': emailId, taskType: { $ne: 'mock' } },
        { projection: { subject: 1, interviewStartAt: 1, status: 1, 'Interview Round': 1, 'End Client': 1 } },
      )
      .sort({ interviewStartAt: -1 })
      .limit(15)
      .toArray();
    return rows.map((t) => ({
      taskId: String(t._id),
      subject: t.subject || '',
      interviewStartAt: t.interviewStartAt ? new Date(t.interviewStartAt).toISOString() : null,
      round: t['Interview Round'] || '',
      client: t['End Client'] || '',
      status: t.status || '',
    }));
  }

  /**
   * Build the watcher set for a mock at create time. Fail-soft: raw
   * emails are kept even when they don't resolve to an active user.
   */
  buildWatchers({ expertEmail, coExpertEmails = [], recruiterEmail, requesterEmail }) {
    const watchers = new Set();
    const add = (e) => { const n = norm(e); if (n) watchers.add(n); };
    add(expertEmail);
    coExpertEmails.forEach(add);
    add(recruiterEmail);
    add(requesterEmail);
    // Recruiter's up-chain: marketing lead → AM → manager via teamLead.
    let cursor = recruiterEmail;
    const seen = new Set();
    for (let hop = 0; hop < 4 && cursor; hop += 1) {
      const u = userModel.getUserByEmail?.(cursor);
      if (!u || seen.has(norm(cursor))) break;
      seen.add(norm(cursor));
      const leadName = normName(u.teamLead);
      if (!leadName) break;
      const lead = this.allUsersActive().find(
        (x) => normName(this.deriveDisplayNameFromEmail(x.email)) === leadName,
      );
      if (!lead) break;
      add(lead.email);
      cursor = lead.email;
    }
    return Array.from(watchers);
  }

  // ── create ───────────────────────────────────────────────────────────

  async create(actor, input) {
    if (!actor?.email) throw err('actor required', 401);
    const role = this.legacyRole(actor);
    if (role !== 'admin' && !LEAD_ROLES.has(role)) {
      throw err('only a team lead or admin can request a mock', 403);
    }
    const { candidateId, role: mockRole = '', expertEmail: expertOverride,
      linkedTaskIds = [], checklist, notes = '', coExpertEmails = [] } = input || {};
    if (!candidateId) throw err('candidateId required');

    const candidate = await candidateModel.getCandidateById?.(candidateId)
      || (candidateModel.collection
        ? await candidateModel.collection.findOne({ _id: new ObjectId(candidateId) })
        : null);
    if (!candidate) throw err('candidate not found');

    const expertEmail = norm(expertOverride) || norm(candidate.Expert);
    if (!expertEmail) throw err('candidate has no expert; pick one explicitly');

    if (!Array.isArray(linkedTaskIds) || linkedTaskIds.length > MAX_LINKED) {
      throw err(`attach at most ${MAX_LINKED} interview references`);
    }
    // snapshot the linked tasks for display stability
    const linkedTaskSnapshots = [];
    if (linkedTaskIds.length) {
      const taskCol = database.getCollection('taskBody');
      const oids = [];
      for (const id of linkedTaskIds) {
        try { oids.push(new ObjectId(id)); } catch { throw err('invalid linkedTaskId'); }
      }
      const tasks = await taskCol
        .find({ _id: { $in: oids } }, { projection: { subject: 1, interviewStartAt: 1 } })
        .toArray();
      for (const t of tasks) {
        linkedTaskSnapshots.push({
          taskId: String(t._id),
          subject: t.subject || '',
          interviewStartAt: t.interviewStartAt ? new Date(t.interviewStartAt).toISOString() : null,
        });
      }
    }

    const recruiterEmail = norm(candidate.Recruiter);
    const watchers = this.buildWatchers({
      expertEmail, coExpertEmails, recruiterEmail, requesterEmail: actor.email,
    });

    const seededChecklist = (Array.isArray(checklist) && checklist.length
      ? checklist
      : DEFAULT_CHECKLIST
    ).map((c) => ({
      id: c.id || normName(c.label).replace(/\s+/g, '-').slice(0, 40),
      label: c.label,
      required: c.required !== false,
      done: false,
      doneAt: null,
    }));

    const now = new Date();
    const doc = {
      candidateId: candidate._id,
      candidateName: candidate['Candidate Name'] || '',
      candidateEmailId: candidate['Email ID'] || '',
      role: mockRole || candidate.Technology || '',
      endClient: candidate['End Client'] || null,
      linkedTaskIds: linkedTaskSnapshots.map((s) => s.taskId),
      linkedTaskSnapshots,
      requestedBy: { email: norm(actor.email), name: this.deriveDisplayNameFromEmail(actor.email) },
      expertEmail,
      coExpertEmails: coExpertEmails.map(norm).filter(Boolean),
      pendingCoExperts: [],
      status: 'requested',
      checklist: seededChecklist,
      callAttempts: [],
      scheduledAt: null,
      scheduleHistory: [],
      blocker: null,
      meetingTaskId: null,
      feedback: null,
      mockDebrief: { status: 'pending', generatedAt: null },
      watchers,
      statusHistory: [{ from: null, to: 'requested', at: now, by: norm(actor.email) }],
      notes: (notes || '').toString().slice(0, 2000),
      createdAt: now,
      updatedAt: now,
    };

    const created = await mockRequestModel.create(doc);
    logger.info('mock requested', {
      id: String(created._id), candidate: doc.candidateName, expert: expertEmail, by: doc.requestedBy.email,
    });
    this.notify(doc.expertEmail, {
      title: 'New mock interview assigned',
      description: `${doc.requestedBy.name} requested a mock for ${doc.candidateName}${doc.role ? ` (${doc.role})` : ''}.`,
      popup: true,
      link: '/mock-supports',
    });
    return created;
  }

  // ── reads ────────────────────────────────────────────────────────────

  async list(actor, filters = {}) {
    return mockRequestModel.list({
      viewerEmail: norm(actor.email),
      isAdmin: this.legacyRole(actor) === 'admin',
      status: filters.status,
      mine: filters.mine === true || filters.mine === 'true',
      candidateId: filters.candidateId,
    });
  }

  async getDetail(actor, id) {
    const mock = await mockRequestModel.getById(id);
    if (!mock) throw err('mock not found', 404);
    const viewer = norm(actor.email);
    const isAdmin = this.legacyRole(actor) === 'admin';
    if (!isAdmin && !(mock.watchers || []).includes(viewer)) {
      throw err('not authorized to view this mock', 403);
    }
    return mock;
  }

  // ── transitions ──────────────────────────────────────────────────────

  async assertActor(actor, mock, { expertOnly = false, leadOrAdmin = false } = {}) {
    const role = this.legacyRole(actor);
    const email = norm(actor.email);
    if (role === 'admin') return;
    if (leadOrAdmin) {
      if (LEAD_ROLES.has(role) && (mock.watchers || []).includes(email)) return;
      throw err('only a lead or admin can do this', 403);
    }
    if (expertOnly) {
      const isExpert = email === norm(mock.expertEmail)
        || (mock.coExpertEmails || []).includes(email);
      if (!isExpert) throw err('only the assigned expert can do this', 403);
      return;
    }
    if ((mock.watchers || []).includes(email)) return;
    throw err('not authorized', 403);
  }

  async pushStatus(actor, id, to, extraSet = {}, extraPush = null) {
    const mock = await mockRequestModel.getById(id);
    if (!mock) throw err('mock not found', 404);
    const allowed = TRANSITIONS[mock.status] || [];
    if (!allowed.includes(to)) {
      throw err(`cannot move from ${mock.status} to ${to}`);
    }
    const now = new Date();
    const set = { status: to, ...extraSet };
    const push = {
      statusHistory: { from: mock.status, to, at: now, by: norm(actor.email) },
      ...(extraPush || {}),
    };
    const res = await mockRequestModel.transition(id, [mock.status], set, push);
    if (res.matchedCount === 0) throw err('mock changed concurrently — retry', 409);
    return { ...mock, ...set, status: to };
  }

  async start(actor, id) {
    const mock = await mockRequestModel.getById(id);
    if (!mock) throw err('mock not found', 404);
    await this.assertActor(actor, mock, { expertOnly: true });
    return this.pushStatus(actor, id, 'in_progress');
  }

  async logCallAttempt(actor, id, { outcome, note = '', scheduledAt = null }) {
    const mock = await mockRequestModel.getById(id);
    if (!mock) throw err('mock not found', 404);
    await this.assertActor(actor, mock, { expertOnly: true });
    if (!['reached', 'no_answer', 'rescheduled'].includes(outcome)) {
      throw err('outcome must be reached / no_answer / rescheduled');
    }
    const attempt = { at: new Date(), outcome, note: (note || '').slice(0, 500), by: norm(actor.email) };
    // first attempt moves in_progress → scheduling; later attempts just append
    if (mock.status === 'in_progress') {
      await this.pushStatus(actor, id, 'scheduling', {}, { callAttempts: attempt });
    } else if (['scheduling', 'recruiter_blocker', 'scheduled'].includes(mock.status)) {
      await mockRequestModel.transition(id, [mock.status], {}, { callAttempts: attempt });
    } else {
      throw err(`cannot log a call attempt from ${mock.status}`);
    }
    if (outcome === 'reached' && scheduledAt) {
      return this.schedule(actor, id, { scheduledAt });
    }
    return mockRequestModel.getById(id);
  }

  async schedule(actor, id, { scheduledAt, reason = '' }) {
    const mock = await mockRequestModel.getById(id);
    if (!mock) throw err('mock not found', 404);
    await this.assertActor(actor, mock, { expertOnly: true });
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) throw err('invalid scheduledAt');
    const push = {};
    if (mock.scheduledAt) {
      push.scheduleHistory = {
        from: mock.scheduledAt, to: when, reason: (reason || '').slice(0, 300),
        at: new Date(), by: norm(actor.email),
      };
    }
    // scheduling/scheduled/meeting_created → scheduled (reschedule allowed)
    const from = ['scheduling', 'scheduled', 'meeting_created', 'recruiter_blocker'];
    if (!from.includes(mock.status)) throw err(`cannot schedule from ${mock.status}`);
    const res = await mockRequestModel.transition(
      id, from,
      { status: 'scheduled', scheduledAt: when },
      { statusHistory: { from: mock.status, to: 'scheduled', at: new Date(), by: norm(actor.email) }, ...push },
    );
    if (res.matchedCount === 0) throw err('mock changed concurrently — retry', 409);
    this.notifyWatchers(mock, {
      title: 'Mock scheduled',
      description: `${mock.candidateName}'s mock is scheduled for ${when.toLocaleString('en-US', { timeZone: 'America/New_York' })} EST.`,
    });
    return mockRequestModel.getById(id);
  }

  async raiseBlocker(actor, id, { note = '' }) {
    const mock = await mockRequestModel.getById(id);
    if (!mock) throw err('mock not found', 404);
    await this.assertActor(actor, mock, { expertOnly: true });
    const blocker = {
      raisedAt: new Date(), raisedBy: norm(actor.email),
      note: (note || '').slice(0, 500), resolvedAt: null, resolvedBy: null, resolution: null,
    };
    const updated = await this.pushStatus(actor, id, 'recruiter_blocker', { blocker });
    // recruiter is already in watchers; popup the whole watcher set.
    this.notifyWatchers(mock, {
      title: 'Mock blocked — candidate unreachable',
      description: `${mock.candidateName}: ${blocker.note || 'expert could not reach the candidate'}.`,
      popup: true,
    });
    return updated;
  }

  async resolveBlocker(actor, id, { resolution = '' }) {
    const mock = await mockRequestModel.getById(id);
    if (!mock) throw err('mock not found', 404);
    await this.assertActor(actor, mock); // any watcher (recruiter) or admin
    if (mock.status !== 'recruiter_blocker') throw err('mock is not blocked');
    const blocker = { ...(mock.blocker || {}), resolvedAt: new Date(), resolvedBy: norm(actor.email), resolution: (resolution || '').slice(0, 500) };
    return this.pushStatus(actor, id, 'scheduling', { blocker });
  }

  async toggleChecklist(actor, id, { itemId, done }) {
    const mock = await mockRequestModel.getById(id);
    if (!mock) throw err('mock not found', 404);
    await this.assertActor(actor, mock, { expertOnly: true });
    const checklist = (mock.checklist || []).map((c) =>
      c.id === itemId ? { ...c, done: done === true, doneAt: done === true ? new Date() : null } : c,
    );
    await mockRequestModel.update(id, { checklist });
    return mockRequestModel.getById(id);
  }

  async markConnected(actor, id) {
    const mock = await mockRequestModel.getById(id);
    if (!mock) throw err('mock not found', 404);
    await this.assertActor(actor, mock, { expertOnly: true });
    return this.pushStatus(actor, id, 'connected', { connectedAt: new Date() });
  }

  async submitFeedback(actor, id, feedback) {
    const mock = await mockRequestModel.getById(id);
    if (!mock) throw err('mock not found', 404);
    await this.assertActor(actor, mock, { expertOnly: true });
    const overall = Number(feedback?.overall);
    if (!(overall >= 1 && overall <= 5)) throw err('overall must be 1–5');
    if (!['ready', 'needs_practice', 'not_ready'].includes(feedback?.verdict)) {
      throw err('verdict must be ready / needs_practice / not_ready');
    }
    const fb = {
      overall,
      verdict: feedback.verdict,
      strengths: (feedback.strengths || '').toString().slice(0, 2000),
      improvements: (feedback.improvements || '').toString().slice(0, 2000),
      detailedNotes: (feedback.detailedNotes || '').toString().slice(0, 5000),
      checklistCoverage: (mock.checklist || []).map((c) => ({ id: c.id, label: c.label, covered: c.done === true })),
      submittedAt: new Date(),
      submittedBy: norm(actor.email),
    };
    const updated = await this.pushStatus(actor, id, 'completed', { feedback: fb });
    this.notifyWatchers(mock, {
      title: 'Mock completed',
      description: `${mock.candidateName}'s mock is complete — verdict: ${fb.verdict.replace('_', ' ')}.`,
    });
    return updated;
  }

  async cancel(actor, id, { reason = '' }) {
    const mock = await mockRequestModel.getById(id);
    if (!mock) throw err('mock not found', 404);
    await this.assertActor(actor, mock, { leadOrAdmin: true });
    if (mock.status === 'completed' || mock.status === 'cancelled') {
      throw err(`cannot cancel a ${mock.status} mock`);
    }
    return this.pushStatus(actor, id, 'cancelled', { cancelReason: (reason || '').slice(0, 500) });
  }

  // ── notifications (fire-and-forget) ──────────────────────────────────

  notify(email, payload) {
    if (!email) return;
    import('./notificationService.js')
      .then(({ notificationService }) => notificationService.createNotification(email, { type: 'info', ...payload }))
      .catch(() => {});
  }

  notifyWatchers(mock, payload) {
    import('./notificationService.js')
      .then(({ notificationService }) =>
        notificationService.broadcastToWatchers((mock.watchers || []), { type: 'info', ...payload }))
      .catch(() => {});
  }
}

export const mockRequestService = new MockRequestService();
export const _testInternals = { TRANSITIONS };
