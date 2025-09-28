import { describe, it, expect } from '@jest/globals';
import { UserService } from '../src/services/userService.js';

const service = new UserService();

describe('UserService managerial access', () => {
  it('treats MM aliases as managers for basic permission checks', () => {
    expect(service.canManageUsers('MM')).toBe(true);
    expect(service.canManageUsers('mm')).toBe(true);
  });

  it('allows MM roles to view other role rosters', () => {
    expect(service.canViewUsersByRole('MM', 'user')).toBe(true);
    expect(service.canViewUsersByRole('mm', 'expert')).toBe(true);
  });

  it('allows MM roles to view stats and search', () => {
    expect(service.canViewStats('MM')).toBe(true);
    expect(service.canSearchUsers('MM')).toBe(true);
  });

  it('permits MM roles to initiate provisioning and manage their direct reports', () => {
    expect(service.canInitiateProvisioning('MM')).toBe(true);
    expect(service.canManageTargetRole('MM', 'recruiter')).toBe(true);
    expect(service.canManageTargetRole('MM', 'mam')).toBe(true);
    expect(service.canManageTargetRole('MM', 'user')).toBe(false);
  });

  it('respects MM hierarchy limits during role creation', () => {
    expect(service.canCreateRole('MM', 'MAM')).toBe(true);
    expect(service.canCreateRole('MM', 'recruiter')).toBe(false);
    expect(service.canCreateRole('MM', 'admin')).toBe(false);
  });

  it('still prevents non-manager roles from elevated permissions', () => {
    expect(service.canManageUsers('user')).toBe(false);
    expect(service.canViewUsersByRole('user', 'lead')).toBe(false);
  });
});
