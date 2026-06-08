import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { candidateModel } from '../src/models/Candidate.js';

const origCollection = candidateModel.collection;
afterEach(() => { candidateModel.collection = origCollection; });

describe('getCandidateByEmail — index-friendly collation lookup', () => {
  it('queries an exact match with a case-insensitive collation (no $regex)', async () => {
    const findOne = jest.fn().mockResolvedValue({ 'Email ID': 'john@x.com', 'Candidate Name': 'John' });
    candidateModel.collection = { findOne };

    await candidateModel.getCandidateByEmail('JOHN@x.com');

    expect(findOne).toHaveBeenCalledTimes(1);
    const [filter, options] = findOne.mock.calls[0];
    expect(filter['Email ID']).toBe('JOHN@x.com');
    expect(JSON.stringify(filter)).not.toContain('$regex');
    expect(filter.docType).toEqual({ $in: [null, 'candidate'] });
    expect(options.collation).toEqual({ locale: 'en', strength: 2 });
  });

  it('returns null without querying when email is empty', async () => {
    const findOne = jest.fn();
    candidateModel.collection = { findOne };
    const result = await candidateModel.getCandidateByEmail('');
    expect(result).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });
});
