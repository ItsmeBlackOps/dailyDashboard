import { parseAiJson } from '../aiJson.js';

describe('parseAiJson', () => {
  it('parses bare JSON', () => {
    expect(parseAiJson('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
  });

  it('strips a ```json fence', () => {
    expect(parseAiJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strips a bare ``` fence', () => {
    expect(parseAiJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('handles the exact OpusMax fenced shape (multi-line, indented)', () => {
    const fenced = '```json\n{\n  "roleFamily": "backend",\n  "yearsExperience": 8,\n  "coreSkills": ["Node.js", "MongoDB"]\n}\n```';
    expect(parseAiJson(fenced)).toEqual({
      roleFamily: 'backend',
      yearsExperience: 8,
      coreSkills: ['Node.js', 'MongoDB'],
    });
  });

  it('parses a fenced JSON array', () => {
    expect(parseAiJson('```json\n[1,2,3]\n```')).toEqual([1, 2, 3]);
  });

  it('extracts a JSON object embedded in prose', () => {
    expect(parseAiJson('Here you go: {"a":1}')).toEqual({ a: 1 });
  });

  it('throws on null/undefined content', () => {
    expect(() => parseAiJson(null)).toThrow();
    expect(() => parseAiJson(undefined)).toThrow();
  });

  it('throws on content with no JSON', () => {
    expect(() => parseAiJson('not json at all')).toThrow();
  });
});
