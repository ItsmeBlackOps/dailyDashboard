import { describe, it, expect } from '@jest/globals';
import { taskService } from '../src/services/taskService.js';

describe('taskService.visibility', () => {
  it('uses sender/cc family only for MAM/MM/mlead visibility match', () => {
    const query = taskService.buildTaskVisibilityMatch('mam.user@vizvainc.com', 'mam');
    const patterns = query.$or || [];

    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.every((entry) => entry.sender || entry.cc)).toBe(true);
    expect(patterns.some((entry) => entry.sender?.$regex)).toBe(true);
    expect(patterns.some((entry) => entry.cc?.$regex)).toBe(true);
    expect(patterns.some((entry) => entry.assignedTo || entry.assignedToEmail || entry.assignedEmail || entry.assignedExpert)).toBe(false);
  });

  it('uses assigned-related family for AM/lead visibility match', () => {
    const query = taskService.buildTaskVisibilityMatch('lead.user@vizvainc.com', 'lead');
    const patterns = query.$or || [];

    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.some((entry) => entry.assignedTo || entry.assignedToEmail || entry.assignedEmail || entry.assignedExpert)).toBe(true);
    expect(patterns.some((entry) => entry.sender || entry.cc)).toBe(false);
  });

  it('grants MAM access only when sender/cc matches hierarchy/self', () => {
    const visible = taskService.isTaskVisibleToUser(
      { sender: 'mam.user@vizvainc.com', cc: '' },
      'mam.user@vizvainc.com',
      'mam'
    );
    const hidden = taskService.isTaskVisibleToUser(
      { sender: 'someone.else@example.com', cc: '' },
      'mam.user@vizvainc.com',
      'mam'
    );

    expect(visible).toBe(true);
    expect(hidden).toBe(false);
  });

  it('grants lead access only when assigned fields match hierarchy/self', () => {
    const visible = taskService.isTaskVisibleToUser(
      { assignedTo: 'lead.user@vizvainc.com', sender: 'unrelated@example.com' },
      'lead.user@vizvainc.com',
      'lead'
    );
    const hidden = taskService.isTaskVisibleToUser(
      { sender: 'lead.user@vizvainc.com', assignedTo: 'other.user@example.com' },
      'lead.user@vizvainc.com',
      'lead'
    );

    expect(visible).toBe(true);
    expect(hidden).toBe(false);
  });
});
