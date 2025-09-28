import { describe, expect, it } from 'vitest';
import { deriveDisplayNameFromEmail, formatNameInput } from './userNames';

describe('userNames utilities', () => {
  it('derives display names from email addresses', () => {
    expect(deriveDisplayNameFromEmail('tushar.ahuja@silverspaceinc.com')).toBe('Tushar Ahuja');
  });

  it('returns empty string when email is missing', () => {
    expect(deriveDisplayNameFromEmail('')).toBe('');
    expect(deriveDisplayNameFromEmail(undefined)).toBe('');
  });

  it('formats plain name inputs by trimming whitespace', () => {
    expect(formatNameInput('  Harsh    Patel  ')).toBe('Harsh Patel');
  });

  it('converts email inputs to display names when formatting names', () => {
    expect(formatNameInput('brhamdev.sharma@vizvainc.com')).toBe('Brhamdev Sharma');
  });
});
