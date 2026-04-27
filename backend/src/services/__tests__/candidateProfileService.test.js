/**
 * Tests for candidateProfileService.js
 *
 * Mocks:
 *  - openai module (OpenAI class + zodResponseFormat)
 *  - pdf-parse module
 *  - global fetch (for PDF download)
 */

import { jest } from '@jest/globals';

// ---------------------------------------------------------------------------
// Build a minimal valid profile that OpenAI would return (already parsed)
// ---------------------------------------------------------------------------
const MOCK_PARSED_PROFILE = {
  roleFamily: 'backend',
  seniorityBand: 'senior',
  yearsExperience: 8,
  workAuthorization: 'h1b',
  employmentTypes: ['full_time', 'contract_c2c'],
  locations: ['United States', 'Remote', 'NJ'],
  remotePreference: 'hybrid_ok',
  targetTitles: ['Senior Software Engineer', 'Backend Engineer'],
  coreSkills: ['Node.js', 'MongoDB', 'Express', 'REST APIs'],
  secondarySkills: ['Docker', 'AWS', 'Redis'],
  domainExpertise: ['FinTech', 'Healthcare IT'],
  educationLevel: 'bs',
};

const MOCK_COMPLETION = {
  choices: [{
    message: {
      content: null,
      role: 'assistant',
      parsed: MOCK_PARSED_PROFILE,
    },
    finish_reason: 'stop',
  }],
  usage: {
    prompt_tokens: 1200,
    completion_tokens: 280,
  },
};

// Mock PDF buffer (arbitrary bytes that we'll fake-parse)
const FAKE_PDF_BUFFER = Buffer.from('%PDF-1.4 fake pdf content with resume data Node.js MongoDB Express developer 8 years H1B NJ');

// ---------------------------------------------------------------------------
// Mock: openai
// ---------------------------------------------------------------------------
const mockParse = jest.fn().mockResolvedValue(MOCK_COMPLETION);
const MockOpenAI = jest.fn().mockImplementation(() => ({
  chat: {
    completions: {
      parse: mockParse,
    },
  },
}));

await jest.unstable_mockModule('openai', () => ({
  default: MockOpenAI,
  OpenAI: MockOpenAI,
}));

await jest.unstable_mockModule('openai/helpers/zod', () => ({
  zodResponseFormat: jest.fn((schema, name) => ({ __mocked: true, name })),
}));

// Mock: pdf-parse
await jest.unstable_mockModule('pdf-parse', () => ({
  default: jest.fn().mockResolvedValue({ text: 'Resume: John Doe, 8 years backend Node.js MongoDB H1B NJ Remote' }),
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER setting up mocks
// ---------------------------------------------------------------------------
const { candidateProfileService } = await import('../candidateProfileService.js');

// ---------------------------------------------------------------------------
// Helper: mock fetch for PDF download
// ---------------------------------------------------------------------------
function mockFetch(buffer) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  });
}

const FAKE_CANDIDATE = {
  _id: '64b1234567890abcdef12345',
  email: 'john.doe@example.com',
  'Candidate Name': 'John Doe',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('CandidateProfileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch(FAKE_PDF_BUFFER);
    // Ensure service looks enabled for most tests
    candidateProfileService.enabled = true;
    candidateProfileService.client = { chat: { completions: { parse: mockParse } } };
  });

  describe('extractFromResume', () => {
    it('extracts a valid profile from a resume URL', async () => {
      const { profile, tokensUsed } = await candidateProfileService.extractFromResume({
        resumeUrl: 'https://example.com/resume.pdf',
        candidateDoc: FAKE_CANDIDATE,
      });

      // Shape checks
      expect(profile.candidateEmail).toBe('john.doe@example.com');
      expect(profile.candidateName).toBe('John Doe');
      expect(profile.roleFamily).toBe('backend');
      expect(profile.seniorityBand).toBe('senior');
      expect(profile.yearsExperience).toBe(8);
      expect(profile.workAuthorization).toBe('h1b');
      expect(profile.coreSkills).toContain('Node.js');
      expect(profile.resumeHash).toMatch(/^[a-f0-9]{64}$/);
      expect(profile.resumeUrl).toBe('https://example.com/resume.pdf');
      expect(profile.extractedBy).toBe(candidateProfileService.model);
      expect(profile.extractedAt).toBeInstanceOf(Date);
      expect(profile.inputTokens).toBe(1200);
      expect(profile.outputTokens).toBe(280);
      expect(profile.approxCostUsd).toBeGreaterThan(0);

      // tokensUsed
      expect(tokensUsed.inputTokens).toBe(1200);
      expect(tokensUsed.outputTokens).toBe(280);

      // OpenAI parse was called once
      expect(mockParse).toHaveBeenCalledTimes(1);
    });

    it('generates a stable resumeHash for the same content (idempotency)', async () => {
      const { profile: p1 } = await candidateProfileService.extractFromResume({
        resumeUrl: 'https://example.com/resume.pdf',
        candidateDoc: FAKE_CANDIDATE,
      });

      mockParse.mockClear();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => FAKE_PDF_BUFFER.buffer.slice(
          FAKE_PDF_BUFFER.byteOffset,
          FAKE_PDF_BUFFER.byteOffset + FAKE_PDF_BUFFER.byteLength
        ),
      });

      const { profile: p2 } = await candidateProfileService.extractFromResume({
        resumeUrl: 'https://example.com/resume.pdf',
        candidateDoc: FAKE_CANDIDATE,
      });

      expect(p1.resumeHash).toBe(p2.resumeHash);
    });

    it('throws when OPENAI_API_KEY is not set (service disabled)', async () => {
      const originalEnabled = candidateProfileService.enabled;
      candidateProfileService.enabled = false;

      await expect(
        candidateProfileService.extractFromResume({
          resumeUrl: 'https://example.com/resume.pdf',
          candidateDoc: FAKE_CANDIDATE,
        })
      ).rejects.toThrow('CandidateProfileService is not configured');

      candidateProfileService.enabled = originalEnabled;
    });

    it('throws when resumeUrl is missing', async () => {
      await expect(
        candidateProfileService.extractFromResume({
          resumeUrl: '',
          candidateDoc: FAKE_CANDIDATE,
        })
      ).rejects.toThrow('resumeUrl is required');
    });

    it('throws when PDF download fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(
        candidateProfileService.extractFromResume({
          resumeUrl: 'https://example.com/missing.pdf',
          candidateDoc: FAKE_CANDIDATE,
        })
      ).rejects.toThrow('Failed to download resume (404)');
    });

    it('throws when OpenAI returns no parsed content', async () => {
      mockParse.mockResolvedValueOnce({
        choices: [{ message: { content: null, parsed: null }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      });

      await expect(
        candidateProfileService.extractFromResume({
          resumeUrl: 'https://example.com/resume.pdf',
          candidateDoc: FAKE_CANDIDATE,
        })
      ).rejects.toThrow('OpenAI did not return a parseable structured response');
    });
  });
});
