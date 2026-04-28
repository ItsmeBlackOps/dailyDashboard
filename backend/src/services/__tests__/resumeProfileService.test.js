import { jest } from '@jest/globals';

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.unstable_mockModule('../../config/index.js', () => ({
  config: {
    openai: {
      apiKey: 'test-api-key',
    },
  },
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: {
    info:  jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock openai SDK
const mockCreate = jest.fn();
jest.unstable_mockModule('openai', () => ({
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

// Mock pdf-parse (default export)
const mockPdfParse = jest.fn();
jest.unstable_mockModule('pdf-parse', () => ({
  default: mockPdfParse,
}));

// DB mock
const mockUpdateOne = jest.fn().mockResolvedValue({});
const mockFindOne   = jest.fn().mockResolvedValue(null);

jest.unstable_mockModule('../../config/database.js', () => ({
  database: {
    getDb: jest.fn(() => ({
      collection: jest.fn(() => ({
        findOne:  mockFindOne,
        updateOne: mockUpdateOne,
      })),
    })),
  },
}));

// ── Import after mocks ─────────────────────────────────────────────────────

const { resumeProfileService } = await import('../resumeProfileService.js');

// ── Helpers ────────────────────────────────────────────────────────────────

const MOCK_PROFILE_RESPONSE = {
  titles: ['Software Engineer', 'Backend Engineer', 'Java Developer', 'Platform Engineer'],
  keywords: ['microservices', 'spring boot'],
  years_min: 5,
  years_max: 8,
  baseline_skills: ['java', 'spring boot', 'kubernetes', 'postgresql'],
};

function mockFetchPdf() {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  });
}

function mockOpenAIResponse(profile = MOCK_PROFILE_RESPONSE) {
  mockCreate.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify(profile),
        },
      },
    ],
    usage: { prompt_tokens: 500, completion_tokens: 100 },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('resumeProfileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOne.mockResolvedValue(null);
    mockUpdateOne.mockResolvedValue({});
    mockPdfParse.mockResolvedValue({ text: 'John Smith\n5 years Java engineer at Acme Corp.\nSkills: Java, Spring Boot, Kubernetes, PostgreSQL, microservices.' });
    mockFetchPdf();
  });

  afterEach(() => {
    delete global.fetch;
  });

  describe('deriveAndStore', () => {
    it('calls OpenAI and stores the forgeProfile shape', async () => {
      mockOpenAIResponse();

      const profile = await resumeProfileService.deriveAndStore({
        candidateId: '507f1f77bcf86cd799439011',
        resumeUrl: 'https://example.com/resume.pdf',
      });

      // Shape check
      expect(profile).toMatchObject({
        titles: expect.arrayContaining(['Software Engineer']),
        keywords: expect.arrayContaining(['microservices']),
        years_min: 5,
        years_max: 8,
        baseline_skills: expect.arrayContaining(['java']),
        derivedFrom: 'https://example.com/resume.pdf',
      });
      expect(profile.derivedAt).toBeInstanceOf(Date);

      // Must have persisted to DB
      expect(mockUpdateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.anything() }),
        { $set: { forgeProfile: expect.objectContaining({ derivedFrom: 'https://example.com/resume.pdf' }) } }
      );
    });

    it('skips re-derivation when cached profile matches resumeUrl (force=false)', async () => {
      const cached = { ...MOCK_PROFILE_RESPONSE, derivedFrom: 'https://example.com/resume.pdf', derivedAt: new Date() };
      mockFindOne.mockResolvedValue({ forgeProfile: cached });

      mockOpenAIResponse();

      const profile = await resumeProfileService.deriveAndStore({
        candidateId: '507f1f77bcf86cd799439011',
        resumeUrl: 'https://example.com/resume.pdf',
        force: false,
      });

      expect(profile).toEqual(cached);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockUpdateOne).not.toHaveBeenCalled();
    });

    it('re-derives when force=true even if cached', async () => {
      const cached = { ...MOCK_PROFILE_RESPONSE, derivedFrom: 'https://example.com/resume.pdf', derivedAt: new Date() };
      mockFindOne.mockResolvedValue({ forgeProfile: cached });

      mockOpenAIResponse();

      await resumeProfileService.deriveAndStore({
        candidateId: '507f1f77bcf86cd799439011',
        resumeUrl: 'https://example.com/resume.pdf',
        force: true,
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockUpdateOne).toHaveBeenCalledTimes(1);
    });

    it('re-derives when resumeUrl changed', async () => {
      const cached = { ...MOCK_PROFILE_RESPONSE, derivedFrom: 'https://example.com/old-resume.pdf', derivedAt: new Date() };
      mockFindOne.mockResolvedValue({ forgeProfile: cached });

      mockOpenAIResponse();

      const profile = await resumeProfileService.deriveAndStore({
        candidateId: '507f1f77bcf86cd799439011',
        resumeUrl: 'https://example.com/new-resume.pdf',
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(profile.derivedFrom).toBe('https://example.com/new-resume.pdf');
    });

    it('throws when OpenAI returns no content', async () => {
      mockCreate.mockResolvedValue({ choices: [{ message: { content: null } }] });

      await expect(
        resumeProfileService.deriveAndStore({
          candidateId: '507f1f77bcf86cd799439011',
          resumeUrl: 'https://example.com/resume.pdf',
        })
      ).rejects.toThrow('OpenAI did not return content');
    });
  });

  describe('getCached', () => {
    it('returns forgeProfile when present', async () => {
      const fp = { titles: ['Engineer'], keywords: ['java'], years_min: 3, years_max: 6, baseline_skills: ['java'], derivedFrom: 'https://example.com/r.pdf', derivedAt: new Date() };
      mockFindOne.mockResolvedValue({ forgeProfile: fp });

      const result = await resumeProfileService.getCached('507f1f77bcf86cd799439011');
      expect(result).toEqual(fp);
    });

    it('returns null when no forgeProfile', async () => {
      mockFindOne.mockResolvedValue({ _id: 'some-id' });

      const result = await resumeProfileService.getCached('507f1f77bcf86cd799439011');
      expect(result).toBeNull();
    });

    it('returns null for null candidateId', async () => {
      const result = await resumeProfileService.getCached(null);
      expect(result).toBeNull();
    });
  });
});
