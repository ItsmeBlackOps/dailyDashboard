import { describe, it, expect, jest, afterEach } from '@jest/globals';
import {
  _tick as runTick,
  RETENTION_DAYS
} from '../src/jobs/emailOutboxJanitor.js';
import { database } from '../src/config/database.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const originalGetDb = database.getDb;

afterEach(() => {
  database.getDb = originalGetDb;
  jest.restoreAllMocks();
});

function mockDb(deleteManyImpl) {
  const collection = {
    deleteMany: jest.fn(deleteManyImpl)
  };
  const db = { collection: jest.fn(() => collection) };
  database.getDb = jest.fn(() => db);
  return { db, collection };
}

describe('emailOutboxJanitor._tick — retention sweep', () => {
  it('deletes only terminal rows whose updatedAt is older than RETENTION_DAYS', async () => {
    const { collection } = mockDb(async () => ({ deletedCount: 4 }));

    const now = new Date('2026-06-01T00:00:00Z');
    const result = await runTick(now);

    expect(result).toEqual({ deleted: 4 });
    expect(collection.deleteMany).toHaveBeenCalledTimes(1);
    const [filter] = collection.deleteMany.mock.calls[0];

    expect(filter.status).toEqual({ $in: ['sent', 'failed'] });
    expect(filter.updatedAt.$lt).toBeInstanceOf(Date);
    // cutoff exactly RETENTION_DAYS ago
    const expectedCutoff = new Date(now.getTime() - RETENTION_DAYS * MS_PER_DAY);
    expect(filter.updatedAt.$lt.getTime()).toBe(expectedCutoff.getTime());
  });

  it('skips when DB is not ready and returns deleted=0 without throwing', async () => {
    database.getDb = jest.fn(() => null);
    const result = await runTick(new Date());
    expect(result).toEqual({ deleted: 0 });
  });

  it('swallows driver errors and returns the error in the result', async () => {
    const { collection } = mockDb(async () => { throw new Error('Mongo down'); });
    const result = await runTick(new Date());
    expect(collection.deleteMany).toHaveBeenCalled();
    expect(result.deleted).toBe(0);
    expect(result.error).toBe('Mongo down');
  });

  it('reports deleted=0 when nothing matches (nothing to sweep)', async () => {
    mockDb(async () => ({ deletedCount: 0 }));
    const result = await runTick(new Date());
    expect(result).toEqual({ deleted: 0 });
  });

  it('targets the emailOutbox collection', async () => {
    const { db } = mockDb(async () => ({ deletedCount: 1 }));
    await runTick(new Date());
    expect(db.collection).toHaveBeenCalledWith('emailOutbox');
  });
});
