import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  computeMsUntilNextRun,
  _tick as runTick
} from '../src/jobs/candidateAlertScheduler.js';
import { database } from '../src/config/database.js';
import { userModel } from '../src/models/User.js';
import { notificationService } from '../src/services/notificationService.js';
import { graphMailService } from '../src/services/graphMailService.js';
import { domainEventBus } from '../src/events/eventBus.js';
import { DomainEvents } from '../src/events/eventTypes.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const originalGetDb = database.getDb;
const originalGetUserByEmail = userModel.getUserByEmail;
const originalBroadcastToWatchers = notificationService.broadcastToWatchers;
const originalSendApplicationMail = graphMailService.sendApplicationMail;

afterEach(() => {
  database.getDb = originalGetDb;
  userModel.getUserByEmail = originalGetUserByEmail;
  notificationService.broadcastToWatchers = originalBroadcastToWatchers;
  graphMailService.sendApplicationMail = originalSendApplicationMail;
  jest.restoreAllMocks();
});

// ---------- helpers ----------

function asyncIterableOf(items) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next() {
          if (i < items.length) {
            return Promise.resolve({ value: items[i++], done: false });
          }
          return Promise.resolve({ value: undefined, done: true });
        }
      };
    }
  };
}

function setupDb({ candidates }) {
  const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  const collection = {
    find: jest.fn(() => asyncIterableOf(candidates)),
    updateOne
  };
  database.getDb = jest.fn(() => ({
    collection: jest.fn((name) => {
      if (name === 'candidateDetails') return collection;
      throw new Error(`unexpected collection: ${name}`);
    })
  }));
  return { collection, updateOne };
}

describe('computeMsUntilNextRun', () => {
  it('returns a positive ms count strictly less than 24h', () => {
    const ms = computeMsUntilNextRun(new Date('2026-05-28T12:00:00Z'));
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(MS_PER_DAY);
  });

  it('schedules ~24h out when called exactly at 02:00 IST', () => {
    // 2026-05-28 02:00 IST == 2026-05-27T20:30:00Z (IST is UTC+5:30)
    const at0200Ist = new Date('2026-05-27T20:30:00Z');
    const ms = computeMsUntilNextRun(at0200Ist);
    // We are AT the boundary, so the next run is +24h.
    expect(Math.round(ms / 3600_000)).toBe(24);
  });
});

describe('candidateAlertScheduler tick — materialisation', () => {
  it('always $sets expiringInDays + daysInMarketing for every scanned candidate (even when not alerting)', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const eadEnd = new Date(now.getTime() + 100 * MS_PER_DAY); // 100 days away — no alert
    const marketingStart = new Date(now.getTime() - 14 * MS_PER_DAY);
    const { updateOne } = setupDb({
      candidates: [{
        _id: 'cand1',
        'Candidate Name': 'Far Future',
        Recruiter: 'rec@co.com', recruiter: 'rec@co.com',
        teamLead: 'lead@co.com',
        eadEndDate: eadEnd,
        marketingStartDate: marketingStart,
        lastEadAlertAt: null
      }]
    });

    const result = await runTick(now);
    expect(result.scanned).toBe(1);
    expect(result.alerted).toBe(0);

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.expiringInDays).toBe(100);
    expect(update.$set.daysInMarketing).toBe(14);
    expect(update.$set.lastEadAlertAt).toBeUndefined();
  });
});

describe('candidateAlertScheduler tick — alert behaviour', () => {
  beforeEach(() => {
    notificationService.broadcastToWatchers = jest.fn().mockResolvedValue([]);
    graphMailService.sendApplicationMail = jest.fn().mockResolvedValue({});
    userModel.getUserByEmail = jest.fn(() => null);
    jest.spyOn(domainEventBus, 'publish').mockImplementation(() => {});
  });

  it('alerts when expiringInDays < 30 AND no prior lastEadAlertAt', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const eadEnd = new Date(now.getTime() + 20 * MS_PER_DAY); // 20 days
    const { updateOne } = setupDb({
      candidates: [{
        _id: 'cand1',
        'Candidate Name': 'Soon Expiring',
        Recruiter: 'rec@co.com', recruiter: 'rec@co.com',
        teamLead: 'lead@co.com',
        eadEndDate: eadEnd,
        lastEadAlertAt: null
      }]
    });

    const result = await runTick(now);
    expect(result.alerted).toBe(1);
    expect(updateOne.mock.calls[0][1].$set.lastEadAlertAt).toEqual(now);
    expect(notificationService.broadcastToWatchers).toHaveBeenCalledTimes(1);
    const [recipients] = notificationService.broadcastToWatchers.mock.calls[0];
    expect(recipients).toEqual(expect.arrayContaining(['rec@co.com', 'lead@co.com']));
    expect(domainEventBus.publish).toHaveBeenCalledWith(
      DomainEvents.CandidateEadExpiring,
      expect.objectContaining({ candidateId: 'cand1', expiringInDays: 20 })
    );
  });

  it('suppresses the alert inside the 7-day dedupe window', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const lastAlert = new Date(now.getTime() - 3 * MS_PER_DAY); // 3 days ago
    setupDb({
      candidates: [{
        _id: 'cand1',
        'Candidate Name': 'Recently Alerted',
        Recruiter: 'rec@co.com', recruiter: 'rec@co.com',
        teamLead: 'lead@co.com',
        eadEndDate: new Date(now.getTime() + 5 * MS_PER_DAY),
        lastEadAlertAt: lastAlert
      }]
    });

    const result = await runTick(now);
    expect(result.alerted).toBe(0);
    expect(notificationService.broadcastToWatchers).not.toHaveBeenCalled();
    expect(graphMailService.sendApplicationMail).not.toHaveBeenCalled();
  });

  it('re-alerts after the 7-day dedupe window has elapsed', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const lastAlert = new Date(now.getTime() - 8 * MS_PER_DAY); // 8 days ago
    setupDb({
      candidates: [{
        _id: 'cand1',
        'Candidate Name': 'Stale Alert',
        Recruiter: 'rec@co.com', recruiter: 'rec@co.com',
        teamLead: 'lead@co.com',
        eadEndDate: new Date(now.getTime() + 10 * MS_PER_DAY),
        lastEadAlertAt: lastAlert
      }]
    });

    const result = await runTick(now);
    expect(result.alerted).toBe(1);
    expect(notificationService.broadcastToWatchers).toHaveBeenCalledTimes(1);
  });

  it('skips alert when expiringInDays >= 30', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    setupDb({
      candidates: [{
        _id: 'cand1',
        Recruiter: 'rec@co.com', recruiter: 'rec@co.com',
        teamLead: 'lead@co.com',
        eadEndDate: new Date(now.getTime() + 40 * MS_PER_DAY),
        lastEadAlertAt: null
      }]
    });
    const result = await runTick(now);
    expect(result.alerted).toBe(0);
    expect(notificationService.broadcastToWatchers).not.toHaveBeenCalled();
  });

  it('sends Graph email ONLY to recipients with preferences.eadEmailAlerts === true', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    userModel.getUserByEmail = jest.fn((email) => {
      const e = (email || '').toLowerCase();
      if (e === 'rec@co.com') {
        return { email: 'rec@co.com', preferences: { eadEmailAlerts: true } };
      }
      if (e === 'lead@co.com') {
        return { email: 'lead@co.com', preferences: { eadEmailAlerts: false } };
      }
      return null;
    });
    setupDb({
      candidates: [{
        _id: 'cand1',
        'Candidate Name': 'Opt-in Test',
        Recruiter: 'rec@co.com', recruiter: 'rec@co.com',
        teamLead: 'lead@co.com',
        eadEndDate: new Date(now.getTime() + 5 * MS_PER_DAY),
        lastEadAlertAt: null
      }]
    });
    const result = await runTick(now);
    expect(result.alerted).toBe(1);
    expect(graphMailService.sendApplicationMail).toHaveBeenCalledTimes(1);
    const payload = graphMailService.sendApplicationMail.mock.calls[0][0];
    expect(payload.message.toRecipients).toEqual([
      { emailAddress: { address: 'rec@co.com' } }
    ]);
  });

  it('does not break the tick when a per-recipient email send fails', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    userModel.getUserByEmail = jest.fn(() => ({
      preferences: { eadEmailAlerts: true }
    }));
    graphMailService.sendApplicationMail = jest
      .fn()
      .mockRejectedValue(new Error('Graph timeout'));
    setupDb({
      candidates: [{
        _id: 'cand1',
        Recruiter: 'rec@co.com', recruiter: 'rec@co.com',
        teamLead: 'lead@co.com',
        eadEndDate: new Date(now.getTime() + 5 * MS_PER_DAY),
        lastEadAlertAt: null
      }]
    });
    const result = await runTick(now);
    expect(result.alerted).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('skips alert when neither recruiter nor team lead is set (still materialises)', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const { updateOne } = setupDb({
      candidates: [{
        _id: 'cand1',
        Recruiter: '', recruiter: '',
        teamLead: '',
        eadEndDate: new Date(now.getTime() + 5 * MS_PER_DAY),
        lastEadAlertAt: null
      }]
    });
    const result = await runTick(now);
    expect(result.scanned).toBe(1);
    expect(result.alerted).toBe(0);
    expect(notificationService.broadcastToWatchers).not.toHaveBeenCalled();
    // Derived fields still set.
    expect(updateOne.mock.calls[0][1].$set.expiringInDays).toBe(5);
  });
});

describe('candidateAlertScheduler tick — resilience', () => {
  it('counts per-candidate errors without bailing on the rest of the tick', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    notificationService.broadcastToWatchers = jest.fn().mockResolvedValue([]);
    graphMailService.sendApplicationMail = jest.fn().mockResolvedValue({});
    userModel.getUserByEmail = jest.fn(() => null);
    jest.spyOn(domainEventBus, 'publish').mockImplementation(() => {});

    // Two candidates — the first throws inside updateOne; the second succeeds.
    const updateOne = jest.fn()
      .mockRejectedValueOnce(new Error('Mongo conflict'))
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });
    const collection = {
      find: jest.fn(() => asyncIterableOf([
        {
          _id: 'broken',
          Recruiter: 'rec@co.com', recruiter: 'rec@co.com',
          teamLead: 'lead@co.com',
          eadEndDate: new Date(now.getTime() + 10 * MS_PER_DAY),
          lastEadAlertAt: null
        },
        {
          _id: 'ok',
          Recruiter: 'rec@co.com', recruiter: 'rec@co.com',
          teamLead: 'lead@co.com',
          eadEndDate: new Date(now.getTime() + 5 * MS_PER_DAY),
          lastEadAlertAt: null
        }
      ])),
      updateOne
    };
    database.getDb = jest.fn(() => ({
      collection: jest.fn(() => collection)
    }));

    const result = await runTick(now);
    expect(result.scanned).toBe(2);
    expect(result.errors).toBe(1);
    expect(result.alerted).toBe(1);
  });

  it('returns zeros + does not throw when DB is not ready', async () => {
    database.getDb = jest.fn(() => null);
    const result = await runTick(new Date());
    expect(result).toEqual({ scanned: 0, alerted: 0, errors: 0 });
  });
});
