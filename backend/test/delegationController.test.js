// C19 phase 3 — controller behavior under common payloads.
// Service is mocked; we're verifying status codes + payload shape.

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const grant = jest.fn();
const revoke = jest.fn();
const listActiveForOwner = jest.fn();
const listActiveForUser = jest.fn();

jest.unstable_mockModule('../src/services/delegationService.js', () => ({
  delegationService: { grant, revoke, listActiveForOwner, listActiveForUser },
}));

const { delegationController } = await import('../src/controllers/delegationController.js');

const makeRes = () => {
  const r = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r;
};

beforeEach(() => {
  grant.mockClear(); revoke.mockClear();
  listActiveForOwner.mockClear(); listActiveForUser.mockClear();
});

describe('grant controller', () => {
  it('201 on success, default ownerEmail = actor.email', async () => {
    grant.mockResolvedValue({ _id: 'x', ownerEmail: 'b@x.com' });
    const req = {
      user: { email: 'b@x.com', role: 'teamLead', team: 'technical' },
      body: { delegateEmail: 'u@x.com', scope: 'subtree', subtreeRootEmail: 'b@x.com', ttlDays: 7 },
    };
    const res = makeRes();
    delegationController.grant(req, res);
    await new Promise((r) => setImmediate(r));
    expect(grant).toHaveBeenCalledWith(req.user, expect.objectContaining({
      ownerEmail: 'b@x.com', delegateEmail: 'u@x.com', scope: 'subtree', ttlDays: 7,
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('403 on share matrix violation', async () => {
    grant.mockRejectedValue(new Error('share matrix violation: cross-team'));
    const req = {
      user: { email: 'b@x.com', role: 'teamLead', team: 'technical' },
      body: { delegateEmail: 'u@x.com', scope: 'subtree', subtreeRootEmail: 'b@x.com', ttlDays: 7 },
    };
    const res = makeRes();
    delegationController.grant(req, res);
    await new Promise((r) => setImmediate(r));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('400 on missing fields', async () => {
    grant.mockRejectedValue(new Error('scope must be specific or subtree'));
    const req = {
      user: { email: 'b@x.com', role: 'teamLead' },
      body: { delegateEmail: 'u@x.com' },
    };
    const res = makeRes();
    delegationController.grant(req, res);
    await new Promise((r) => setImmediate(r));
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('mine controller', () => {
  it('returns owned + delegated lists', async () => {
    listActiveForOwner.mockResolvedValue([{ _id: '1' }]);
    listActiveForUser.mockResolvedValue([{ _id: '2' }]);
    const req = { user: { email: 'b@x.com', role: 'teamLead' } };
    const res = makeRes();
    delegationController.mine(req, res);
    await new Promise((r) => setImmediate(r));
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      owned: [{ _id: '1' }],
      delegated: [{ _id: '2' }],
    });
  });
});

describe('owned controller', () => {
  it('non-admin can only inspect their own outbound grants', async () => {
    const req = {
      user: { email: 'b@x.com', role: 'teamLead' },
      query: { ownerEmail: 'someone.else@x.com' },
    };
    const res = makeRes();
    delegationController.owned(req, res);
    await new Promise((r) => setImmediate(r));
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('admin can inspect anyone', async () => {
    listActiveForOwner.mockResolvedValue([{ _id: '1' }]);
    const req = {
      user: { email: 'admin@x.com', role: 'admin' },
      query: { ownerEmail: 'someone.else@x.com' },
    };
    const res = makeRes();
    delegationController.owned(req, res);
    await new Promise((r) => setImmediate(r));
    expect(listActiveForOwner).toHaveBeenCalledWith('someone.else@x.com');
    expect(res.json).toHaveBeenCalledWith({
      success: true, ownerEmail: 'someone.else@x.com', delegations: [{ _id: '1' }],
    });
  });

  it('without ownerEmail query, returns the caller\'s own outbound grants', async () => {
    listActiveForOwner.mockResolvedValue([]);
    const req = { user: { email: 'b@x.com', role: 'teamLead' }, query: {} };
    const res = makeRes();
    delegationController.owned(req, res);
    await new Promise((r) => setImmediate(r));
    expect(listActiveForOwner).toHaveBeenCalledWith('b@x.com');
  });
});

describe('transfer controller', () => {
  it('200 on success', async () => {
    const transfer = jest.fn().mockResolvedValue({
      subjectEmail: 's@x.com', from: 'Old Lead', to: 'New Lead',
      transferredAt: new Date(), transferredBy: 'a@x.com',
    });
    // patch service mock for this test
    const mod = await import('../src/services/delegationService.js');
    mod.delegationService.transfer = transfer;
    const req = {
      user: { email: 'a@x.com', role: 'manager', team: 'marketing' },
      body: { subjectEmail: 's@x.com', toTeamLeadDisplayName: 'New Lead', reason: 'reorg' },
    };
    const res = makeRes();
    delegationController.transfer(req, res);
    await new Promise((r) => setImmediate(r));
    expect(transfer).toHaveBeenCalledWith(req.user, expect.objectContaining({
      subjectEmail: 's@x.com', toTeamLeadDisplayName: 'New Lead', reason: 'reorg',
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('403 when subject is not in authority', async () => {
    const transfer = jest.fn().mockRejectedValue(new Error('subject is not in your authority'));
    const mod = await import('../src/services/delegationService.js');
    mod.delegationService.transfer = transfer;
    const req = {
      user: { email: 'a@x.com', role: 'teamLead', team: 'technical' },
      body: { subjectEmail: 's@x.com', toTeamLeadDisplayName: 'New Lead' },
    };
    const res = makeRes();
    delegationController.transfer(req, res);
    await new Promise((r) => setImmediate(r));
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('400 when no-op (already on that teamLead)', async () => {
    const transfer = jest.fn().mockRejectedValue(new Error('subject is already on that teamLead'));
    const mod = await import('../src/services/delegationService.js');
    mod.delegationService.transfer = transfer;
    const req = {
      user: { email: 'a@x.com', role: 'admin' },
      body: { subjectEmail: 's@x.com', toTeamLeadDisplayName: 'Same Lead' },
    };
    const res = makeRes();
    delegationController.transfer(req, res);
    await new Promise((r) => setImmediate(r));
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('revoke controller', () => {
  it('200 on success', async () => {
    revoke.mockResolvedValue({ _id: 'x', revokedAt: new Date() });
    const req = { user: { email: 'b@x.com', role: 'teamLead' }, params: { id: 'x' }, body: {} };
    const res = makeRes();
    delegationController.revoke(req, res);
    await new Promise((r) => setImmediate(r));
    expect(revoke).toHaveBeenCalledWith(req.user, 'x', '');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('403 when only owner-or-admin allowed', async () => {
    revoke.mockRejectedValue(new Error('only the owner or an admin can revoke'));
    const req = { user: { email: 'b@x.com', role: 'teamLead' }, params: { id: 'x' }, body: {} };
    const res = makeRes();
    delegationController.revoke(req, res);
    await new Promise((r) => setImmediate(r));
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
