// MockRequest model — dashboard-native mock interview lifecycle.
// Raw-driver collection (repo convention for new collections), mirroring
// the accessor + ensureIndexes shape of the other models. All business
// logic lives in mockRequestService; this is storage + indexes only.
//
// Spec: docs/superpowers/specs/2026-06-12-mock-support-design.md

import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const COLLECTION = 'mockRequests';

// Status machine — the service validates transitions; these are the
// canonical state names persisted on the document.
export const MOCK_STATUSES = [
  'requested',
  'in_progress',
  'scheduling',
  'scheduled',
  'meeting_created',
  'connected',
  'completed',
  'cancelled',
];

// Default checklist seeded at create (editable). Stable ids so feedback
// coverage can key off them.
export const DEFAULT_CHECKLIST = [
  { id: 'resume', label: 'Resume walkthrough' },
  { id: 'project', label: 'Project deep-dive' },
  { id: 'core', label: 'Core technical Q&A (role skills)' },
  { id: 'client', label: 'Client / JD-specific questions' },
  { id: 'behavioral', label: 'Behavioral / HR questions' },
  { id: 'communication', label: 'Communication & delivery coaching' },
  { id: 'ask', label: 'Questions to ask the interviewer' },
  { id: 'logistics', label: 'Logistics check (camera, audio, environment)' },
];

class MockRequestModel {
  constructor() {
    this.collection = null;
  }

  init() {
    this.collection = database.getCollection(COLLECTION);
    return this.collection;
  }

  col() {
    if (!this.collection) this.init();
    if (!this.collection) {
      const e = new Error('Database not ready');
      e.statusCode = 503;
      throw e;
    }
    return this.collection;
  }

  async ensureIndexes() {
    try {
      const col = this.col();
      await col.createIndex({ status: 1, createdAt: -1 }, { name: 'status_created' });
      await col.createIndex({ expertEmail: 1, status: 1 }, { name: 'expert_status' });
      await col.createIndex({ candidateId: 1, createdAt: -1 }, { name: 'candidate_created' });
      await col.createIndex({ watchers: 1 }, { name: 'watchers' });
      await col.createIndex({ meetingTaskId: 1 }, { name: 'meeting_task', sparse: true });
      logger.info('mockRequestModel: indexes ensured');
    } catch (err) {
      logger.error('mockRequestModel: ensureIndexes failed', { error: err.message });
    }
  }

  async create(doc) {
    const res = await this.col().insertOne(doc);
    return { _id: res.insertedId, ...doc };
  }

  async getById(id) {
    let oid;
    try { oid = new ObjectId(id); } catch { return null; }
    return this.col().findOne({ _id: oid });
  }

  /**
   * Visibility-scoped list. Admin sees all; everyone else sees mocks
   * where they are a watcher (expert, co-expert, recruiter, the chain,
   * the requesting lead). Optional status / mine / candidateId filters.
   */
  async list({ viewerEmail, isAdmin, status, mine, candidateId, limit = 100 }) {
    const q = {};
    if (!isAdmin) q.watchers = (viewerEmail || '').toLowerCase();
    if (status) q.status = status;
    if (mine) q.expertEmail = (viewerEmail || '').toLowerCase();
    if (candidateId) {
      try { q.candidateId = new ObjectId(candidateId); } catch { /* ignore bad id */ }
    }
    return this.col()
      .find(q)
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 200))
      .toArray();
  }

  async update(id, set) {
    let oid;
    try { oid = new ObjectId(id); } catch { return { matchedCount: 0 }; }
    return this.col().updateOne({ _id: oid }, { $set: { ...set, updatedAt: new Date() } });
  }

  /** Conditional update used by the status machine (optimistic from-status guard). */
  async transition(id, fromStatuses, set, push) {
    let oid;
    try { oid = new ObjectId(id); } catch { return { matchedCount: 0 }; }
    const update = { $set: { ...set, updatedAt: new Date() } };
    if (push) update.$push = push;
    return this.col().updateOne(
      { _id: oid, status: { $in: fromStatuses } },
      update,
    );
  }
}

export const mockRequestModel = new MockRequestModel();
