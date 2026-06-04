import { describe, it, expect } from '@jest/globals';
import { resolveSort, SORT_PRESETS } from '../src/models/Candidate.js';
import { candidateService } from '../src/services/candidateService.js';

// SP3 Phase B — date-sort presets for the Branch Candidates list.
//
// Two new whitelisted presets were added on top of the existing
// updated / name / expiringIn set:
//
//   * marketingStart → marketingStartDate DESC (newest first)
//   * poDate         → poDate DESC (newest first)
//
// Both pair with a `_last_write` DESC tiebreaker. DESC naturally sinks
// null/missing values to the bottom (Mongo treats missing as smallest),
// which is exactly what we want — most candidates have no poDate yet.
//
// resolveSort lives in the model layer (Candidate.js) and owns the
// key→Mongo-sort-object mapping. candidateService.resolveSortKey is the
// service-boundary gate that decides which key strings are even allowed
// to reach the model. A new preset must be wired in BOTH places or it is
// silently dropped at the service boundary.

describe('Candidate.resolveSort — new date presets', () => {
  it('maps marketingStart → marketingStartDate DESC with _last_write tiebreak', () => {
    expect(resolveSort('marketingStart')).toEqual({
      marketingStartDate: -1,
      _last_write: -1
    });
  });

  it('maps poDate → poDate DESC with _last_write tiebreak', () => {
    expect(resolveSort('poDate')).toEqual({ poDate: -1, _last_write: -1 });
  });

  it('leaves the existing presets unchanged', () => {
    expect(resolveSort('updated')).toEqual({ _last_write: -1 });
    expect(resolveSort('name')).toEqual({ 'Candidate Name': 1, _last_write: -1 });
    expect(resolveSort('expiringIn')).toEqual({ eadEndDate: 1, _last_write: -1 });
  });

  it('falls back to the updated default for unknown / malformed keys', () => {
    const defaultSort = { _last_write: -1 };
    expect(resolveSort('haxx')).toEqual(defaultSort);
    expect(resolveSort('')).toEqual(defaultSort);
    expect(resolveSort(undefined)).toEqual(defaultSort);
    expect(resolveSort(42)).toEqual(defaultSort);
    expect(resolveSort({ $ne: null })).toEqual(defaultSort);
    // whitelist only — an arbitrary field name must not become a sort
    expect(resolveSort('marketingStartDate')).toEqual(defaultSort);
  });

  it('exposes the new presets on the SORT_PRESETS whitelist', () => {
    expect(SORT_PRESETS.marketingStart).toEqual({
      marketingStartDate: -1,
      _last_write: -1
    });
    expect(SORT_PRESETS.poDate).toEqual({ poDate: -1, _last_write: -1 });
  });
});

describe('candidateService.resolveSortKey — new keys pass the service gate', () => {
  it('lets the new date keys through verbatim', () => {
    expect(candidateService.resolveSortKey('marketingStart')).toBe('marketingStart');
    expect(candidateService.resolveSortKey('poDate')).toBe('poDate');
  });

  it('still passes the original keys and still rejects junk', () => {
    expect(candidateService.resolveSortKey('updated')).toBe('updated');
    expect(candidateService.resolveSortKey('name')).toBe('name');
    expect(candidateService.resolveSortKey('expiringIn')).toBe('expiringIn');
    expect(candidateService.resolveSortKey('haxx')).toBeUndefined();
    expect(candidateService.resolveSortKey({ $ne: null })).toBeUndefined();
  });
});
