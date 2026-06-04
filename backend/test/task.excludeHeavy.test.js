import { describe, it, expect } from '@jest/globals';
import { TASK_EXCLUDE_HEAVY } from '../src/models/Task.js';
describe('TASK_EXCLUDE_HEAVY', () => {
  it('is a pure exclusion projection for the two heavy fields', () => {
    expect(TASK_EXCLUDE_HEAVY).toEqual({ replies: 0, body: 0 });
  });
});
