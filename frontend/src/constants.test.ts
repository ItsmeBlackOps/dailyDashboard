import { describe, expect, it } from 'vitest';
import { normalizeApiBase, resolveApiBase } from './constants';

describe('normalizeApiBase', () => {
  it('removes trailing slash and terminal /api segment', () => {
    expect(normalizeApiBase('https://example.com/api/')).toBe('https://example.com');
  });

  it('returns empty string for blank values', () => {
    expect(normalizeApiBase('   ')).toBe('');
    expect(normalizeApiBase(undefined)).toBe('');
  });
});

describe('resolveApiBase', () => {
  it('prefers VITE_API_BASE when set', () => {
    expect(
      resolveApiBase({
        VITE_API_BASE: 'https://primary.example.com/api',
        VITE_API_URL: 'https://fallback.example.com',
        DEV: false,
      })
    ).toBe('https://primary.example.com');
  });

  it('falls back to VITE_API_URL when VITE_API_BASE is unset', () => {
    expect(
      resolveApiBase({
        VITE_API_BASE: '',
        VITE_API_URL: 'https://fallback.example.com/api/',
        DEV: false,
      })
    ).toBe('https://fallback.example.com');
  });

  it('uses localhost default in development when nothing configured', () => {
    expect(resolveApiBase({ DEV: true })).toBe('http://localhost:3004');
  });

  it('uses same-origin relative base in production when nothing configured', () => {
    expect(resolveApiBase({ DEV: false })).toBe('');
  });
});
