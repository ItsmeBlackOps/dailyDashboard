import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import moment from 'moment-timezone';
import { taskService } from '../src/services/taskService.js';

const TIMEZONE = 'America/New_York';

/**
 * DASH-S1 / SP3 — the Tasks query must filter the interview-date path on the
 * indexed BSON Date `interviewStartAt` (NOT a $dateFromString/$expr parse of
 * the "Date of Interview" MM/DD/YYYY string), anchor day boundaries to
 * America/New_York, and sort by `interviewStartAt`.
 *
 * These tests are hermetic: we stub `resolveTaskVisibilityScope` (so it never
 * touches Atlas) and capture the aggregation pipeline by monkey-patching the
 * collection's `aggregate`. We assert on the pipeline shape only — no DB.
 */

// Walk an arbitrary object/array tree and collect every object key seen.
function collectKeys(node, acc = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, acc);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      acc.add(k);
      collectKeys(v, acc);
    }
  }
  return acc;
}

function firstMatch(pipeline) {
  const stage = pipeline.find((s) => s && Object.prototype.hasOwnProperty.call(s, '$match') && Object.keys(s.$match).length > 0);
  return stage ? stage.$match : undefined;
}

function sortStage(pipeline) {
  const stage = pipeline.find((s) => s && Object.prototype.hasOwnProperty.call(s, '$sort'));
  return stage ? stage.$sort : undefined;
}

describe('taskService interview-date filter — interviewStartAt (index-backed, EST-anchored)', () => {
  let captured;
  let scopeSpy;
  let formatSpy;
  let aggregateMock;
  let originalCollection;

  beforeEach(() => {
    captured = [];

    // Self-only scope, no DB.
    scopeSpy = jest
      .spyOn(taskService, 'resolveTaskVisibilityScope')
      .mockReturnValue({
        emails: ['expert@example.com'],
        locals: ['expert'],
        displayNames: ['expert'],
        escaped: { emails: ['expert@example\\.com'], locals: ['expert'], displayNames: ['expert'] }
      });

    // Pass-through formatter so the .map() after aggregate doesn't choke.
    formatSpy = jest
      .spyOn(taskService.taskModel, 'formatTask')
      .mockImplementation((doc) => doc);

    // `taskModel.collection` is null until a DB connect happens, so we can't
    // spyOn it. Swap in a stub that captures every pipeline handed to
    // aggregate and returns an empty result set. Restored in afterEach.
    originalCollection = taskService.taskModel.collection;
    aggregateMock = jest.fn((pipeline) => {
      captured.push(pipeline);
      return { toArray: async () => [] };
    });
    taskService.taskModel.collection = { aggregate: aggregateMock };
  });

  afterEach(() => {
    scopeSpy.mockRestore();
    formatSpy.mockRestore();
    taskService.taskModel.collection = originalCollection;
  });

  it('getTasksByRange (day preset) builds an interviewStartAt range match, no $dateFromString', async () => {
    await taskService.getTasksByRange('expert@example.com', 'user', null, null, {
      range: 'day'
    });

    expect(aggregateMock).toHaveBeenCalled();
    const pipeline = captured[0];
    const match = firstMatch(pipeline);

    // Filters on the indexed BSON Date, with a real Date range.
    expect(match).toBeDefined();
    expect(match.interviewStartAt).toBeDefined();
    expect(match.interviewStartAt.$gte).toBeInstanceOf(Date);
    expect(match.interviewStartAt.$lt).toBeInstanceOf(Date);

    // The legacy parse approach is gone everywhere in the pipeline.
    const keys = collectKeys(pipeline);
    expect(keys.has('$dateFromString')).toBe(false);
    expect(match.$expr).toBeUndefined();
    expect(match['Date of Interview']).toBeUndefined();
  });

  it('anchors the day boundaries to America/New_York regardless of server clock', async () => {
    await taskService.getTasksByRange('expert@example.com', 'user', null, null, {
      range: 'day'
    });

    const match = firstMatch(captured[0]);
    const expectedStart = moment.tz(TIMEZONE).startOf('day');
    const expectedEnd = expectedStart.clone().add(1, 'day');

    // Boundaries equal Eastern start-of-day / start-of-next-day (to the day).
    expect(moment(match.interviewStartAt.$gte).tz(TIMEZONE).format('YYYY-MM-DD'))
      .toBe(expectedStart.format('YYYY-MM-DD'));
    expect(match.interviewStartAt.$gte.getTime()).toBe(expectedStart.toDate().getTime());
    expect(match.interviewStartAt.$lt.getTime()).toBe(expectedEnd.toDate().getTime());
  });

  it('sorts by interviewStartAt (so the interviewStartAt:1 index serves filter + sort)', async () => {
    await taskService.getTasksByRange('expert@example.com', 'user', null, null, {
      range: 'day'
    });

    const sort = sortStage(captured[0]);
    expect(sort).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(sort, 'interviewStartAt')).toBe(true);
    // First (primary) sort key is interviewStartAt, not _id.
    expect(Object.keys(sort)[0]).toBe('interviewStartAt');
  });

  it('getTasksByRange (upcoming) filters interviewStartAt with a $gte and no $dateFromString', async () => {
    await taskService.getTasksByRange('expert@example.com', 'user', null, null, {
      upcoming: true
    });

    const match = firstMatch(captured[0]);
    expect(match.interviewStartAt).toBeDefined();
    expect(match.interviewStartAt.$gte).toBeInstanceOf(Date);

    const keys = collectKeys(captured[0]);
    expect(keys.has('$dateFromString')).toBe(false);
    expect(match.$expr).toBeUndefined();
  });

  it('searchTasks (upcoming) filters interviewStartAt with no $dateFromString/$expr', async () => {
    await taskService.searchTasks('expert@example.com', 'user', null, null, {
      upcoming: true
    });

    const match = firstMatch(captured[0]);
    expect(match.interviewStartAt).toBeDefined();
    expect(match.interviewStartAt.$gte).toBeInstanceOf(Date);

    const keys = collectKeys(captured[0]);
    expect(keys.has('$dateFromString')).toBe(false);
    expect(match.$expr).toBeUndefined();

    const sort = sortStage(captured[0]);
    expect(Object.keys(sort)[0]).toBe('interviewStartAt');
  });
});
