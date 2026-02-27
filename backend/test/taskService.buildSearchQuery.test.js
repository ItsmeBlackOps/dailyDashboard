import { describe, it, expect } from '@jest/globals';
import { taskService } from '../src/services/taskService.js';

describe('taskService.buildSearchQuery', () => {
  it('uses sender/cc patterns for MM visibility', () => {
    const query = taskService.buildSearchQuery('mm.user@example.com', 'MM', 'Manager Name', []);
    const patterns = query.$or || [];

    const hasSender = patterns.some((entry) => Boolean(entry.sender?.$regex));
    const hasCc = patterns.some((entry) => Boolean(entry.cc?.$regex));
    const hasAssignedFamily = patterns.some((entry) =>
      Boolean(entry.assignedTo || entry.assignedToEmail || entry.assignedEmail || entry.assignedExpert)
    );

    expect(hasSender).toBe(true);
    expect(hasCc).toBe(true);
    expect(hasAssignedFamily).toBe(false);
  });
});
