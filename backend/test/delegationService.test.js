// C19 phase 1 — basic unit tests for delegationService.
//
// Covers the share-matrix validator + grant input validation. The real
// Mongo paths are mocked because Atlas isn't reachable from this dev
// env; integration tests run against a live cluster (separate suite).

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const insertOne = jest.fn().mockResolvedValue({ insertedId: 'fake-id' });
const findOne = jest.fn();
const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });
const find = jest.fn();
const createIndex = jest.fn().mockResolvedValue('ok');

jest.unstable_mockModule('../src/config/database.js', () => ({
  database: {
    getCollection: () => ({ insertOne, findOne, updateOne, updateMany, find, createIndex }),
  },
}));

const userByEmail = new Map();
jest.unstable_mockModule('../src/models/User.js', () => ({
  userModel: {
    getUserByEmail: (email) => userByEmail.get((email || '').toLowerCase()),
  },
}));

const { delegationService, _testHelpers } = await import('../src/services/delegationService.js');

beforeEach(() => {
  insertOne.mockClear();
  findOne.mockClear();
  updateOne.mockClear();
  updateMany.mockClear();
  find.mockClear();
  userByEmail.clear();
});

describe('validateShareMatrix', () => {
  const v = _testHelpers.validateShareMatrix;

  it('rejects when roles differ', () => {
    expect(v({
      ownerRole: 'teamLead', ownerTeam: 'technical',
      delegateRole: 'assistantManager', delegateTeam: 'technical',
    }).ok).toBe(false);
  });

  it('accepts same-role same-team', () => {
    expect(v({
      ownerRole: 'teamLead', ownerTeam: 'technical',
      delegateRole: 'teamLead', delegateTeam: 'technical',
    }).ok).toBe(true);
  });

  it('rejects same-role cross-team for non-managers', () => {
    expect(v({
      ownerRole: 'teamLead', ownerTeam: 'technical',
      delegateRole: 'teamLead', delegateTeam: 'marketing',
    }).ok).toBe(false);
  });

  it('allows manager cross-team (Tushar case)', () => {
    expect(v({
      ownerRole: 'manager', ownerTeam: 'marketing',
      delegateRole: 'manager', delegateTeam: 'technical',
    }).ok).toBe(true);
  });

  it('admin can share to anyone', () => {
    expect(v({
      ownerRole: 'admin', ownerTeam: null,
      delegateRole: 'recruiter', delegateTeam: 'marketing',
    }).ok).toBe(true);
  });

  it('treats legacy and new role names as equivalent', () => {
    // legacy mlead === new teamLead/marketing
    expect(v({
      ownerRole: 'mlead', ownerTeam: 'marketing',
      delegateRole: 'teamLead', delegateTeam: 'marketing',
    }).ok).toBe(true);
    // legacy mam === new assistantManager/marketing
    expect(v({
      ownerRole: 'mam', ownerTeam: 'marketing',
      delegateRole: 'assistantManager', delegateTeam: 'marketing',
    }).ok).toBe(true);
  });
});

describe('computeExpiresAt', () => {
  const c = _testHelpers.computeExpiresAt;

  it('null/undefined means forever', () => {
    expect(c(null)).toBeNull();
    expect(c(undefined)).toBeNull();
  });

  it('rejects unsupported TTLs', () => {
    expect(() => c(3)).toThrow();
    expect(() => c(365)).toThrow();
    expect(() => c('forever')).toThrow();
  });

  it('accepts the locked TTL set', () => {
    for (const days of [7, 15, 30, 180]) {
      const d = c(days);
      expect(d).toBeInstanceOf(Date);
      const ms = d.getTime() - Date.now();
      expect(ms).toBeGreaterThan((days - 1) * 24 * 60 * 60 * 1000);
      expect(ms).toBeLessThan((days + 1) * 24 * 60 * 60 * 1000);
    }
  });
});

describe('grant', () => {
  const owner = {
    email: 'bhavya.dutt@vizvainc.com', role: 'teamLead', team: 'technical', active: true,
  };
  const delegate = {
    email: 'umang.pandya@silverspaceinc.com', role: 'teamLead', team: 'technical', active: true,
  };

  beforeEach(() => {
    userByEmail.set(owner.email, owner);
    userByEmail.set(delegate.email, delegate);
  });

  it('happy path — Bhavya shares his subtree with Umang for 7 days', async () => {
    const result = await delegationService.grant(owner, {
      ownerEmail: owner.email,
      delegateEmail: delegate.email,
      scope: 'subtree',
      subtreeRootEmail: owner.email,
      ttlDays: 7,
      reason: 'PTO 7d',
    });
    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(result.ownerEmail).toBe(owner.email);
    expect(result.delegateEmail).toBe(delegate.email);
    expect(result.scope).toBe('subtree');
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.revokedAt).toBeNull();
  });

  it('rejects self-delegation', async () => {
    await expect(delegationService.grant(owner, {
      ownerEmail: owner.email, delegateEmail: owner.email,
      scope: 'subtree', subtreeRootEmail: owner.email, ttlDays: 7,
    })).rejects.toThrow(/yourself/i);
  });

  it('rejects when actor is neither owner nor admin', async () => {
    const stranger = { email: 'someone.else@vizvainc.com', role: 'teamLead', team: 'technical' };
    await expect(delegationService.grant(stranger, {
      ownerEmail: owner.email, delegateEmail: delegate.email,
      scope: 'subtree', subtreeRootEmail: owner.email, ttlDays: 7,
    })).rejects.toThrow(/owner or an admin/i);
  });

  it('rejects scope=specific without subjectEmails', async () => {
    await expect(delegationService.grant(owner, {
      ownerEmail: owner.email, delegateEmail: delegate.email,
      scope: 'specific', subjectEmails: [], ttlDays: 7,
    })).rejects.toThrow(/at least one/);
  });

  it('rejects share matrix violation (cross-team teamLead)', async () => {
    const marketingDelegate = { ...delegate, team: 'marketing' };
    userByEmail.set(marketingDelegate.email, marketingDelegate);
    await expect(delegationService.grant(owner, {
      ownerEmail: owner.email, delegateEmail: marketingDelegate.email,
      scope: 'subtree', subtreeRootEmail: owner.email, ttlDays: 7,
    })).rejects.toThrow(/share matrix violation/i);
  });

  it('admin can grant from any subtree', async () => {
    const admin = { email: 'admin@silverspaceinc.com', role: 'admin', team: null };
    userByEmail.set(admin.email, admin);
    await delegationService.grant(admin, {
      ownerEmail: owner.email, delegateEmail: delegate.email,
      scope: 'subtree', subtreeRootEmail: owner.email, ttlDays: 7,
    });
    expect(insertOne).toHaveBeenCalledTimes(1);
  });
});
