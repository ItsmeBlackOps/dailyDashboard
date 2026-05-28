import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ObjectId } from 'mongodb';
import {
  EmailOutboxRepository,
  STATUS_PENDING,
  STATUS_SENDING,
  STATUS_SENT,
  STATUS_FAILED,
  DEFAULT_BACKOFF_SCHEDULE_MS
} from '../src/services/emailOutboxRepository.js';
import { database } from '../src/config/database.js';

const MS_PER_HOUR = 60 * 60 * 1000;

// ---- in-memory collection mock --------------------------------------------
//
// We don't try to emulate Mongo perfectly — just enough to test the
// transitions: findOneAndUpdate returns the post-update row (returnDocument:
// 'after' style), insertOne returns an id, findOne returns the latest row,
// updateMany flips matches. Concurrency is single-threaded so we don't need
// real atomicity.
function createMockCollection(seed = []) {
  const rows = seed.map((r) => ({ _id: r._id ?? new ObjectId(), ...r }));

  const matches = (row, filter) => {
    for (const [k, v] of Object.entries(filter || {})) {
      if (k === '_id') {
        if (String(row._id) !== String(v)) return false;
        continue;
      }
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('$lte' in v && !(row[k] <= v.$lte)) return false;
        if ('$lt' in v && !(row[k] < v.$lt)) return false;
        if ('$gt' in v && !(row[k] > v.$gt)) return false;
        if ('$gte' in v && !(row[k] >= v.$gte)) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };

  return {
    rows,
    async insertOne(doc) {
      const _id = new ObjectId();
      rows.push({ _id, ...doc });
      return { insertedId: _id };
    },
    async findOne(filter, _options) {
      return rows.find((r) => matches(r, filter)) || null;
    },
    async findOneAndUpdate(filter, update, options = {}) {
      const idx = rows.findIndex((r) => matches(r, filter));
      if (idx === -1) return { value: null };
      const before = rows[idx];
      const after = { ...before, ...(update.$set || {}) };
      rows[idx] = after;
      void options;
      return { value: after };
    },
    async updateMany(filter, update) {
      let modified = 0;
      for (let i = 0; i < rows.length; i++) {
        if (matches(rows[i], filter)) {
          rows[i] = { ...rows[i], ...(update.$set || {}) };
          modified += 1;
        }
      }
      return { modifiedCount: modified };
    },
    async createIndex() {
      return null;
    }
  };
}

let mockCollection;
let originalGetDb;

beforeEach(() => {
  mockCollection = createMockCollection();
  originalGetDb = database.getDb;
  database.getDb = jest.fn(() => ({
    collection: jest.fn(() => mockCollection)
  }));
});

afterEach(() => {
  database.getDb = originalGetDb;
  jest.restoreAllMocks();
});

async function freshRepo() {
  const repo = new EmailOutboxRepository();
  await repo.initialize();
  return repo;
}

const stdPayload = () => ({
  message: { subject: 'x', body: { contentType: 'HTML', content: '<p>y</p>' } },
  saveToSentItems: false
});
const stdAudit = () => ({
  sender: 'mm@co.com',
  to: ['rec@co.com'],
  cc: ['lead@co.com'],
  bcc: [],
  subject: 'x',
  attachmentIds: ['a1']
});

describe('EmailOutboxRepository.enqueue', () => {
  it('inserts a pending row with attempts=0 and availableAt=now', async () => {
    const repo = await freshRepo();
    const row = await repo.enqueue({
      candidateId: 'cand1',
      payload: stdPayload(),
      audit: stdAudit(),
      enqueuedBy: 'mm@co.com'
    });
    expect(row.status).toBe(STATUS_PENDING);
    expect(row.attempts).toBe(0);
    expect(row.availableAt).toBeInstanceOf(Date);
    expect(row.expiresAt.getTime() - row.enqueuedAt.getTime()).toBeGreaterThan(23 * MS_PER_HOUR);
    expect(row._id).toBeTruthy();
  });

  it('rejects when required fields are missing', async () => {
    const repo = await freshRepo();
    await expect(
      repo.enqueue({ candidateId: '', payload: stdPayload(), audit: stdAudit(), enqueuedBy: 'x' })
    ).rejects.toThrow(/candidateId/);
    await expect(
      repo.enqueue({ candidateId: 'c', payload: null, audit: stdAudit(), enqueuedBy: 'x' })
    ).rejects.toThrow(/payload/);
    await expect(
      repo.enqueue({ candidateId: 'c', payload: stdPayload(), audit: stdAudit(), enqueuedBy: '' })
    ).rejects.toThrow(/enqueuedBy/);
  });
});

describe('EmailOutboxRepository.claimPendingBatch', () => {
  it('atomically flips pending → sending, one row at a time', async () => {
    const repo = await freshRepo();
    await repo.enqueue({ candidateId: 'c1', payload: stdPayload(), audit: stdAudit(), enqueuedBy: 'x' });
    await repo.enqueue({ candidateId: 'c2', payload: stdPayload(), audit: stdAudit(), enqueuedBy: 'x' });
    const claimed = await repo.claimPendingBatch(10);
    expect(claimed).toHaveLength(2);
    for (const c of claimed) {
      expect(c.status).toBe(STATUS_SENDING);
      expect(c.startedAt).toBeInstanceOf(Date);
    }
    // A second claim returns nothing — everything is already in 'sending'.
    const claimed2 = await repo.claimPendingBatch(10);
    expect(claimed2).toEqual([]);
  });

  it('skips rows whose availableAt is in the future', async () => {
    const repo = await freshRepo();
    const row = await repo.enqueue({ candidateId: 'c1', payload: stdPayload(), audit: stdAudit(), enqueuedBy: 'x' });
    // Manually push availableAt 1h into the future to simulate a backoff.
    const r = mockCollection.rows.find((x) => x._id === row._id);
    r.availableAt = new Date(Date.now() + MS_PER_HOUR);
    const claimed = await repo.claimPendingBatch(10);
    expect(claimed).toEqual([]);
  });
});

describe('EmailOutboxRepository.markSent', () => {
  it('flips status → sent and stamps sentAt', async () => {
    const repo = await freshRepo();
    const row = await repo.enqueue({ candidateId: 'c1', payload: stdPayload(), audit: stdAudit(), enqueuedBy: 'x' });
    const sent = await repo.markSent(row._id, { graphMessageId: 'g123' });
    expect(sent.status).toBe(STATUS_SENT);
    expect(sent.sentAt).toBeInstanceOf(Date);
    expect(sent.graphMessageId).toBe('g123');
  });
});

describe('EmailOutboxRepository.markRetryOrFail', () => {
  it('returns to pending with the next backoff availableAt when retries remain', async () => {
    const repo = await freshRepo();
    const row = await repo.enqueue({ candidateId: 'c1', payload: stdPayload(), audit: stdAudit(), enqueuedBy: 'x' });
    const updated = await repo.markRetryOrFail(row._id, 'transient 503');
    expect(updated.status).toBe(STATUS_PENDING);
    expect(updated.attempts).toBe(1);
    expect(updated.lastError).toBe('transient 503');
    expect(updated.availableAt.getTime()).toBeGreaterThan(Date.now());
    // backoff index 1 = 60_000 ms.
    expect(updated.availableAt.getTime() - Date.now()).toBeLessThan(DEFAULT_BACKOFF_SCHEDULE_MS[1] + 1000);
  });

  it('flips to failed once attempts >= maxAttempts', async () => {
    const repo = await freshRepo();
    const row = await repo.enqueue({ candidateId: 'c1', payload: stdPayload(), audit: stdAudit(), enqueuedBy: 'x' });
    // Force attempts up to the limit so the next markRetryOrFail tips into failed.
    const r = mockCollection.rows.find((x) => x._id === row._id);
    r.attempts = row.maxAttempts - 1;
    const updated = await repo.markRetryOrFail(row._id, 'still failing');
    expect(updated.status).toBe(STATUS_FAILED);
    expect(updated.attempts).toBe(row.maxAttempts);
    expect(updated.failedAt).toBeInstanceOf(Date);
  });

  it('flips to failed once expiresAt has elapsed regardless of attempts', async () => {
    const repo = await freshRepo();
    const row = await repo.enqueue({ candidateId: 'c1', payload: stdPayload(), audit: stdAudit(), enqueuedBy: 'x' });
    const r = mockCollection.rows.find((x) => x._id === row._id);
    r.expiresAt = new Date(Date.now() - 1000); // already expired
    const updated = await repo.markRetryOrFail(row._id, 'late retry');
    expect(updated.status).toBe(STATUS_FAILED);
  });

  it('truncates lastError to 1000 chars to bound storage', async () => {
    const repo = await freshRepo();
    const row = await repo.enqueue({ candidateId: 'c1', payload: stdPayload(), audit: stdAudit(), enqueuedBy: 'x' });
    const huge = 'x'.repeat(5000);
    const updated = await repo.markRetryOrFail(row._id, huge);
    expect(updated.lastError.length).toBeLessThanOrEqual(1000);
  });
});
