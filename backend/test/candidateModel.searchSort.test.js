import { describe, it, expect, jest } from '@jest/globals';
import { CandidateModel } from '../src/models/Candidate.js';

// PRT Phase 5 — model-level checks for the Mongo filter shape produced
// by the three list-fetch methods. We don't run against a live DB; we
// stub the collection and inspect the args .find(...) saw.

function makeStubbedModel(returnedDocs = []) {
  const cursor = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(returnedDocs)
  };
  const collection = {
    find: jest.fn(() => cursor)
  };
  const model = new CandidateModel();
  model.collection = collection;
  return { model, collection, cursor };
}

describe('CandidateModel.getCandidatesByBranch', () => {
  it('builds an $or across Candidate Name, Email ID and Recruiter when search is given', async () => {
    const { model, collection } = makeStubbedModel();
    await model.getCandidatesByBranch('GGR', { search: 'jane' });
    const [filter] = collection.find.mock.calls[0];
    expect(filter.Branch).toBe('GGR');
    const fields = filter.$or.map((c) => Object.keys(c)[0]);
    expect(fields).toEqual(expect.arrayContaining(['Candidate Name', 'Email ID', 'Recruiter']));
    for (const clause of filter.$or) {
      const v = Object.values(clause)[0];
      expect(v.$regex).toBe('jane');
      expect(v.$options).toBe('i');
    }
  });

  it('omits the $or when no search is provided', async () => {
    const { model, collection } = makeStubbedModel();
    await model.getCandidatesByBranch('GGR', {});
    const [filter] = collection.find.mock.calls[0];
    expect(filter.$or).toBeUndefined();
  });

  it('sort:expiringIn keys the cursor on eadEndDate ascending', async () => {
    const { model, cursor } = makeStubbedModel();
    await model.getCandidatesByBranch('GGR', { sort: 'expiringIn' });
    const [sortArg] = cursor.sort.mock.calls[0];
    expect(sortArg.eadEndDate).toBe(1);
  });

  it('sort:name keys the cursor on Candidate Name ascending', async () => {
    const { model, cursor } = makeStubbedModel();
    await model.getCandidatesByBranch('GGR', { sort: 'name' });
    const [sortArg] = cursor.sort.mock.calls[0];
    expect(sortArg['Candidate Name']).toBe(1);
  });

  it('unknown sort key falls back to _last_write desc', async () => {
    const { model, cursor } = makeStubbedModel();
    await model.getCandidatesByBranch('GGR', { sort: 'bogus' });
    const [sortArg] = cursor.sort.mock.calls[0];
    expect(sortArg._last_write).toBe(-1);
  });
});

describe('CandidateModel.getCandidatesByRecruiters', () => {
  it('combines the recruiter-scope OR and the search OR via $and', async () => {
    const { model, collection } = makeStubbedModel();
    await model.getCandidatesByRecruiters(['rec@co.com'], { search: 'jane' });
    const [filter] = collection.find.mock.calls[0];
    expect(Array.isArray(filter.$and)).toBe(true);
    expect(filter.$and).toHaveLength(2);
    // First clause is the recruiter-scope OR, second is the search OR.
    const recruiterClauseFields = filter.$and[0].$or.map((c) => Object.keys(c)[0]);
    const searchClauseFields = filter.$and[1].$or.map((c) => Object.keys(c)[0]);
    expect(recruiterClauseFields).toContain('Recruiter');
    expect(searchClauseFields).toEqual(expect.arrayContaining(['Candidate Name', 'Email ID', 'Recruiter']));
    // and the top-level $or has been removed in favour of $and
    expect(filter.$or).toBeUndefined();
  });

  it('keeps the legacy top-level $or when no search is supplied', async () => {
    const { model, collection } = makeStubbedModel();
    await model.getCandidatesByRecruiters(['rec@co.com'], {});
    const [filter] = collection.find.mock.calls[0];
    expect(Array.isArray(filter.$or)).toBe(true);
    expect(filter.$and).toBeUndefined();
  });
});

describe('CandidateModel.getAllCandidates', () => {
  it('applies the same search OR across Name / Email / Recruiter', async () => {
    const { model, collection } = makeStubbedModel();
    await model.getAllCandidates({ search: 'data@co.com' });
    const [filter] = collection.find.mock.calls[0];
    const fields = filter.$or.map((c) => Object.keys(c)[0]);
    expect(fields).toEqual(expect.arrayContaining(['Candidate Name', 'Email ID', 'Recruiter']));
  });
});
