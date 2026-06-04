import { describe, it, expect } from '@jest/globals';
import { compareByInterviewStart } from '../src/models/Task.js';

// SP3 Phase B — the getTasksByRange post-aggregation display sort orders
// interviews by the reliable interviewStartAt (ISO string from formatTask)
// when present, falling back to the legacy parsed startTime/endTime when it
// is absent. Order is ascending (soonest first), matching today's behavior.
//
// compareByInterviewStart(a, b) is the pure comparator extracted from the
// inline tasks.sort(...) so it can be unit-tested without an Atlas connection.
// It operates on formatTask-shaped objects.

const sortByComparator = (arr) => [...arr].sort(compareByInterviewStart);

describe('compareByInterviewStart — getTasksByRange display sort (SP3 Phase B)', () => {
  it('orders by interviewStartAt ascending when all tasks have it', () => {
    const tasks = [
      { _id: 'c', interviewStartAt: '2026-06-03T15:00:00.000Z' },
      { _id: 'a', interviewStartAt: '2026-06-03T13:00:00.000Z' },
      { _id: 'b', interviewStartAt: '2026-06-03T14:00:00.000Z' }
    ];
    expect(sortByComparator(tasks).map((t) => t._id)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to parsed startTime when interviewStartAt is absent', () => {
    // 'a' has no interviewStartAt; its legacy startTime places it first.
    const tasks = [
      { _id: 'b', interviewStartAt: '2026-06-03T14:00:00.000Z' },
      { _id: 'a', startTime: new Date('2026-06-03T13:00:00.000Z') },
      { _id: 'c', interviewStartAt: '2026-06-03T15:00:00.000Z' }
    ];
    expect(sortByComparator(tasks).map((t) => t._id)).toEqual(['a', 'b', 'c']);
  });

  it('prefers interviewStartAt over a divergent legacy startTime', () => {
    // Legacy startTime would sort 'a' last, but interviewStartAt wins → 'a' first.
    const tasks = [
      {
        _id: 'a',
        interviewStartAt: '2026-06-03T13:00:00.000Z',
        startTime: new Date('2026-06-03T23:00:00.000Z')
      },
      { _id: 'b', interviewStartAt: '2026-06-03T14:00:00.000Z' }
    ];
    expect(sortByComparator(tasks).map((t) => t._id)).toEqual(['a', 'b']);
  });

  it('tiebreaks on the end value (interviewEndsAt preferred) when starts are equal', () => {
    const tasks = [
      {
        _id: 'late',
        interviewStartAt: '2026-06-03T13:00:00.000Z',
        interviewEndsAt: '2026-06-03T14:00:00.000Z'
      },
      {
        _id: 'early',
        interviewStartAt: '2026-06-03T13:00:00.000Z',
        interviewEndsAt: '2026-06-03T13:30:00.000Z'
      }
    ];
    expect(sortByComparator(tasks).map((t) => t._id)).toEqual(['early', 'late']);
  });

  it('tiebreaks on parsed endTime when starts equal and interviewEndsAt absent', () => {
    const tasks = [
      {
        _id: 'late',
        interviewStartAt: '2026-06-03T13:00:00.000Z',
        endTime: new Date('2026-06-03T14:00:00.000Z')
      },
      {
        _id: 'early',
        interviewStartAt: '2026-06-03T13:00:00.000Z',
        endTime: new Date('2026-06-03T13:30:00.000Z')
      }
    ];
    expect(sortByComparator(tasks).map((t) => t._id)).toEqual(['early', 'late']);
  });

  it('treats a task with neither start value as epoch 0 (sorts first)', () => {
    const tasks = [
      { _id: 'has', interviewStartAt: '2026-06-03T13:00:00.000Z' },
      { _id: 'none' }
    ];
    expect(sortByComparator(tasks).map((t) => t._id)).toEqual(['none', 'has']);
  });
});
