import { describe, it, expect } from 'vitest';
import {
  LEGACY_ROLES,
  roleLabel,
  roleBadgeVariant,
  type LegacyRole,
} from '../roleLabels';

describe('roleLabels', () => {
  describe('roleLabel', () => {
    it('maps mm to Marketing Manager', () => {
      expect(roleLabel('mm')).toBe('Marketing Manager');
    });

    it('maps user to Expert', () => {
      expect(roleLabel('user')).toBe('Expert');
    });

    it('maps mlead to Team Lead (Marketing)', () => {
      expect(roleLabel('mlead')).toBe('Team Lead (Marketing)');
    });

    it('maps every legacy role to its expected label', () => {
      expect(roleLabel('admin')).toBe('Admin');
      expect(roleLabel('mm')).toBe('Marketing Manager');
      expect(roleLabel('mam')).toBe('Asst. Manager (Marketing)');
      expect(roleLabel('am')).toBe('Asst. Manager (Technical)');
      expect(roleLabel('mlead')).toBe('Team Lead (Marketing)');
      expect(roleLabel('lead')).toBe('Team Lead (Technical)');
      expect(roleLabel('recruiter')).toBe('Recruiter');
      expect(roleLabel('user')).toBe('Expert');
    });

    it('falls back to the raw token for an unknown role', () => {
      expect(roleLabel('superuser')).toBe('superuser');
      expect(roleLabel('')).toBe('');
    });
  });

  describe('LEGACY_ROLES', () => {
    it('contains exactly the eight legacy tokens', () => {
      expect(LEGACY_ROLES).toEqual([
        'admin',
        'mm',
        'mam',
        'am',
        'mlead',
        'lead',
        'recruiter',
        'user',
      ]);
    });

    it('gives every legacy token a non-empty label distinct from the raw token', () => {
      LEGACY_ROLES.forEach((role) => {
        const label = roleLabel(role);
        expect(label).toBeTruthy();
        expect(label).not.toBe(role);
      });
    });

    it('gives every legacy token a valid badge variant', () => {
      const valid = ['default', 'secondary', 'outline'];
      LEGACY_ROLES.forEach((role) => {
        expect(valid).toContain(roleBadgeVariant(role));
      });
    });
  });

  describe('roleBadgeVariant', () => {
    it('uses default for admin and mm', () => {
      expect(roleBadgeVariant('admin')).toBe('default');
      expect(roleBadgeVariant('mm')).toBe('default');
    });

    it('uses outline for mam and am', () => {
      expect(roleBadgeVariant('mam')).toBe('outline');
      expect(roleBadgeVariant('am')).toBe('outline');
    });

    it('uses secondary for mlead, lead, recruiter and user', () => {
      expect(roleBadgeVariant('mlead')).toBe('secondary');
      expect(roleBadgeVariant('lead')).toBe('secondary');
      expect(roleBadgeVariant('recruiter')).toBe('secondary');
      expect(roleBadgeVariant('user')).toBe('secondary');
    });

    it('falls back to secondary for an unknown role', () => {
      expect(roleBadgeVariant('superuser')).toBe('secondary');
    });
  });

  it('accepts the LegacyRole type for labels', () => {
    const role: LegacyRole = 'mm';
    expect(roleLabel(role)).toBe('Marketing Manager');
  });
});
