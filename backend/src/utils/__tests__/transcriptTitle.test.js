import { jest } from '@jest/globals';
import { transcriptTitlePrefix, findTranscriptByTitle } from '../transcriptTitle.js';

describe('transcriptTitlePrefix', () => {
  it('strips the trailing time portion', () => {
    expect(transcriptTitlePrefix('Interview Support - Janavi Soni - Tax Preparer - Jun 11, 2026 at 11:00 AM EST'))
      .toBe('Interview Support - Janavi Soni - Tax Preparer - Jun 11, 2026');
  });

  it('uses the LAST " at " so names/roles containing " at " survive', () => {
    expect(transcriptTitlePrefix('Interview Support - X - Analyst at Bank - Jun 11, 2026 at 03:30 PM EST'))
      .toBe('Interview Support - X - Analyst at Bank - Jun 11, 2026');
  });

  it('returns the input unchanged when there is no " at "', () => {
    expect(transcriptTitlePrefix('Some plain subject')).toBe('Some plain subject');
  });

  it('handles empty/null', () => {
    expect(transcriptTitlePrefix('')).toBe('');
    expect(transcriptTitlePrefix(null)).toBe('');
  });
});

describe('findTranscriptByTitle', () => {
  const title = 'Interview Support - Janavi Soni - Tax Preparer - Jun 11, 2026 at 11:00 AM EST';
  const rescheduled = { title: 'Interview Support - Janavi Soni - Tax Preparer - Jun 11, 2026 at 03:30 PM EST' };

  it('returns the exact match without a fallback query', async () => {
    const listDocuments = jest.fn(async () => ({ documents: [{ title }] }));
    const doc = await findTranscriptByTitle({ listDocuments }, 'db', 'tr', title);
    expect(doc.title).toBe(title);
    expect(listDocuments).toHaveBeenCalledTimes(1);
  });

  it('falls back to the date-level prefix when the exact title misses (rescheduled meeting)', async () => {
    const listDocuments = jest.fn()
      .mockResolvedValueOnce({ documents: [] })
      .mockResolvedValueOnce({ documents: [rescheduled] });
    const doc = await findTranscriptByTitle({ listDocuments }, 'db', 'tr', title);
    expect(doc.title).toBe(rescheduled.title);
    expect(listDocuments).toHaveBeenCalledTimes(2);
  });

  it('returns null when the prefix lookup errors (older Appwrite)', async () => {
    const listDocuments = jest.fn()
      .mockResolvedValueOnce({ documents: [] })
      .mockRejectedValueOnce(new Error('Invalid query: startsWith'));
    const doc = await findTranscriptByTitle({ listDocuments }, 'db', 'tr', title);
    expect(doc).toBeNull();
  });

  it('returns null for an empty title without querying', async () => {
    const listDocuments = jest.fn();
    expect(await findTranscriptByTitle({ listDocuments }, 'db', 'tr', '')).toBeNull();
    expect(listDocuments).not.toHaveBeenCalled();
  });
});
