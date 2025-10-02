import { describe, it, expect } from '@jest/globals';
import { TaskModel } from '../src/models/Task.js';

describe('TaskModel.buildDashboardRoleMatch', () => {
  it('includes self and unassigned conditions for expert users', () => {
    const model = new TaskModel();
    const match = model.buildDashboardRoleMatch('aman.agnihotri@vizvainc.com', 'expert', '', []);

    expect(match).toBeTruthy();
    expect(Array.isArray(match.$or)).toBe(true);

    const patterns = match.$or || [];

    const selfPattern = patterns.find((entry) => {
      const assignedTo = entry.assignedTo || {};
      return typeof assignedTo === 'object' && assignedTo.$regex === '^aman\\.agnihotri$';
    });
    expect(selfPattern).toBeDefined();

    const unassignedExists = patterns.find((entry) => entry.assignedTo?.$exists === false);
    expect(unassignedExists).toBeDefined();

    const unassignedRegex = patterns.find((entry) => {
      const assignedTo = entry.assignedTo || {};
      return typeof assignedTo === 'object' && assignedTo.$regex === '^\\s*(?:not\\s+assigned)?\\s*$' && assignedTo.$options === 'i';
    });
    expect(unassignedRegex).toBeDefined();
  });
});
