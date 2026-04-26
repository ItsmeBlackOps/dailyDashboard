import { describe, it, expect } from '@jest/globals';
import { TaskModel } from '../src/models/Task.js';

describe('TaskModel.buildDashboardRoleMatch', () => {
  it('includes self conditions for expert users', () => {
    const model = new TaskModel();
    const match = model.buildDashboardRoleMatch('aman.agnihotri@vizvainc.com', 'expert', '', []);

    expect(match).toBeTruthy();
    expect(Array.isArray(match.$or)).toBe(true);

    const patterns = match.$or || [];

    // Expert role uses the default path: self patterns by emailLocal, full email, and display name
    const selfByLocal = patterns.find((entry) => {
      const assignedTo = entry.assignedTo || {};
      return typeof assignedTo === 'object' && assignedTo.$regex === '^aman\\.agnihotri$';
    });
    expect(selfByLocal).toBeDefined();

    const selfByEmail = patterns.find((entry) => {
      const assignedTo = entry.assignedTo || {};
      return typeof assignedTo === 'object' && assignedTo.$regex === '^aman\\.agnihotri@vizvainc\\.com$';
    });
    expect(selfByEmail).toBeDefined();
  });
});
