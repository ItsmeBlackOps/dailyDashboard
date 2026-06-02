import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  recordPerfMetric,
  flush,
  _state,
  _reset
} from '../src/jobs/perfMetricsBuffer.js';
import { database } from '../src/config/database.js';

const originalGetDb = database.getDb;

function mockDb(insertManyImpl) {
  const collection = {
    insertMany: jest.fn(insertManyImpl ?? (async () => ({})))
  };
  const db = { collection: jest.fn(() => collection) };
  database.getDb = jest.fn(() => db);
  return { db, collection };
}

beforeEach(() => {
  _reset();
});

afterEach(() => {
  database.getDb = originalGetDb;
  _reset();
  jest.restoreAllMocks();
});

describe('perfMetricsBuffer', () => {
  it('buffers metrics and flushes them with a single ordered:false insertMany', async () => {
    const { collection } = mockDb();

    recordPerfMetric({ path: '/api/a', durationMs: 1 });
    recordPerfMetric({ path: '/api/b', durationMs: 2 });
    expect(_state().size).toBe(2);

    const res = await flush();

    expect(collection.insertMany).toHaveBeenCalledTimes(1);
    const [batch, opts] = collection.insertMany.mock.calls[0];
    expect(batch).toHaveLength(2);
    expect(opts).toEqual({ ordered: false });
    expect(res.inserted).toBe(2);
    expect(_state().size).toBe(0);
  });

  it('is a no-op when the buffer is empty', async () => {
    const { collection } = mockDb();
    const res = await flush();
    expect(res.inserted).toBe(0);
    expect(collection.insertMany).not.toHaveBeenCalled();
  });

  it('retains the buffer when the DB is not ready (so a later tick can drain it)', async () => {
    database.getDb = jest.fn(() => null);
    recordPerfMetric({ path: '/api/x' });
    const res = await flush();
    expect(res.inserted).toBe(0);
    expect(_state().size).toBe(1);
  });

  it('drops a failing batch instead of throwing or re-buffering forever', async () => {
    const { collection } = mockDb(async () => { throw new Error('boom'); });
    recordPerfMetric({ path: '/api/y' });

    await expect(flush()).resolves.toEqual({ inserted: 0 });

    expect(collection.insertMany).toHaveBeenCalledTimes(1);
    // batch was drained (not re-buffered) so it can't loop forever
    expect(_state().size).toBe(0);
  });
});
