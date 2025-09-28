import { describe, it, expect } from '@jest/globals';
import { hasAnyRole, hasManagerPrivileges, isManagerRole, rolesMatch } from '../src/utils/roles.js';

describe('role utility helpers', () => {
  it('treats MM as a manager when checking allowed roles', () => {
    expect(hasAnyRole('MM', ['manager'])).toBe(true);
    expect(hasAnyRole('mm', ['manager'])).toBe(true);
    expect(hasAnyRole('manager', ['MM'])).toBe(true);
  });

  it('identifies manager aliases', () => {
    expect(isManagerRole('MM')).toBe(true);
    expect(isManagerRole('mm')).toBe(true);
    expect(isManagerRole('manager')).toBe(true);
    expect(isManagerRole('admin')).toBe(false);
  });

  it('grants manager privileges to managers and admins only', () => {
    expect(hasManagerPrivileges('MM')).toBe(true);
    expect(hasManagerPrivileges('manager')).toBe(true);
    expect(hasManagerPrivileges('admin')).toBe(true);
    expect(hasManagerPrivileges('user')).toBe(false);
  });

  it('keeps unrelated roles distinct', () => {
    expect(rolesMatch('MM', 'am')).toBe(false);
    expect(rolesMatch('lead', 'manager')).toBe(false);
  });
});
