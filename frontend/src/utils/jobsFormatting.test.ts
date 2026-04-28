import { describe, it, expect } from 'vitest';
import { shortLoc, relTime } from './jobsFormatting';

const NOW = new Date('2026-04-27T12:00:00Z');

describe('shortLoc', () => {
  it('returns — for empty', () => {
    expect(shortLoc(null)).toBe('—');
    expect(shortLoc('')).toBe('—');
  });

  it('shortens 3-part US address', () => {
    expect(shortLoc('Stamford, Connecticut, United States')).toBe('Stamford, CT');
  });

  it('handles remote location', () => {
    expect(shortLoc('Remote, United States')).toBe('Remote · United States');
    expect(shortLoc('Remote')).toBe('Remote');
  });

  it('handles 2-part location', () => {
    expect(shortLoc('New York, NY')).toBe('New York, NY');
  });
});

describe('relTime', () => {
  it('just now for < 60s', () => {
    const d = new Date(NOW.getTime() - 30_000);
    expect(relTime(d, NOW)).toBe('just now');
  });

  it('minutes ago', () => {
    const d = new Date(NOW.getTime() - 5 * 60 * 1000);
    expect(relTime(d, NOW)).toBe('5m ago');
  });

  it('hours ago', () => {
    const d = new Date(NOW.getTime() - 3 * 3600 * 1000);
    expect(relTime(d, NOW)).toBe('3h ago');
  });

  it('days ago', () => {
    const d = new Date(NOW.getTime() - 3 * 86400 * 1000);
    expect(relTime(d, NOW)).toBe('3d ago');
  });

  it('weeks ago', () => {
    const d = new Date(NOW.getTime() - 14 * 86400 * 1000);
    expect(relTime(d, NOW)).toBe('2w ago');
  });
});
