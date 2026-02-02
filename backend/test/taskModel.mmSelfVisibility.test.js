import { describe, it, expect } from '@jest/globals';
import { TaskModel } from '../src/models/Task.js';

describe('TaskModel MM visibility', () => {
  it('adds recruiterName derived from sender in formatTask', () => {
    const model = new TaskModel();
    const formatted = model.formatTask({
      _id: 'task-1',
      sender: 'jane.doe@example.com',
      'Date of Interview': '01/29/2026',
      'Start Time Of Interview': '10:00 AM',
      'End Time Of Interview': '11:00 AM'
    });

    expect(formatted).toBeTruthy();
    expect(formatted.recruiterName).toBe('Jane Doe');
  });

  it('includes assignedTo patterns for MM in buildUserQuery', () => {
    const model = new TaskModel();
    const query = model.buildUserQuery('mm.user@example.com', 'MM', 'Manager Name');
    const patterns = query.$or || [];

    const hasLocal = patterns.some((entry) => entry.assignedTo?.$regex === '^mm\\.user$');
    const hasEmail = patterns.some((entry) => entry.assignedTo?.$regex === '^mm\\.user@example\\.com$');

    expect(hasLocal).toBe(true);
    expect(hasEmail).toBe(true);
  });
});
