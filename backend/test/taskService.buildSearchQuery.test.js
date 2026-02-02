import { describe, it, expect } from '@jest/globals';
import { taskService } from '../src/services/taskService.js';

describe('taskService.buildSearchQuery', () => {
  it('includes assignedTo patterns for MM to see own tasks', () => {
    const query = taskService.buildSearchQuery('mm.user@example.com', 'MM', 'Manager Name', []);
    const patterns = query.$or || [];

    const hasLocal = patterns.some((entry) => entry.assignedTo?.$regex === '^mm\\.user$');
    const hasEmail = patterns.some((entry) => entry.assignedTo?.$regex === '^mm\\.user@example\\.com$');

    expect(hasLocal).toBe(true);
    expect(hasEmail).toBe(true);
  });
});
