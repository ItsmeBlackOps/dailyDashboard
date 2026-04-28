import { jest } from '@jest/globals';

// ── Mocks (must be declared before any import of the module under test) ──────

jest.unstable_mockModule('../../config/index.js', () => ({
  config: {
    scraperService: {
      url: 'http://scraper:8001',
      timeoutMs: 600000,
    },
    forgeAiService: {
      url: 'http://forge-ai:8002',
      timeoutMs: 600000,
    },
    jobSearch: {
      cacheTtlHours: 24,
    },
  },
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ── DB mock helpers ───────────────────────────────────────────────────────────

const makeCollection = (overrides = {}) => ({
  createIndex: jest.fn().mockResolvedValue({}),
  findOne: jest.fn().mockResolvedValue(null),
  insertOne: jest.fn().mockResolvedValue({ insertedId: { toString: () => 'mock-id-001' } }),
  updateOne: jest.fn().mockResolvedValue({}),
  countDocuments: jest.fn().mockResolvedValue(0),
  find: jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    project: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue([]),
  }),
  ...overrides,
});

const mockCollections = {};
const mockGetCollection = jest.fn((name) => {
  if (!mockCollections[name]) {
    mockCollections[name] = makeCollection();
  }
  return mockCollections[name];
});

jest.unstable_mockModule('../../config/database.js', () => ({
  database: {
    getDb: jest.fn(() => ({
      collection: mockGetCollection,
    })),
  },
}));

jest.unstable_mockModule('../resumeTailorService.js', () => ({
  resumeTailorService: {
    tailor: jest.fn().mockResolvedValue({
      tailoredResumeUrl: 'https://example.com/tailored.pdf',
      tailoredResumeText: 'Tailored resume text',
    }),
  },
}));

jest.unstable_mockModule('../resumeProfileService.js', () => ({
  resumeProfileService: {
    enabled: false,
    deriveAndStore: jest.fn().mockResolvedValue(null),
    getCached: jest.fn().mockResolvedValue(null),
  },
}));

// ── Import module under test (after mocks) ────────────────────────────────────

const { jobSearchService } = await import('../jobSearchService.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetch(overrides = {}) {
  const defaults = {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify([])),
    json: () => Promise.resolve([]),
  };
  return jest.fn().mockResolvedValue({ ...defaults, ...overrides });
}

function resetCollections() {
  for (const key of Object.keys(mockCollections)) {
    delete mockCollections[key];
  }
  jobSearchService._indexesEnsured = false;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('jobSearchService', () => {
  let mockIo;

  beforeEach(() => {
    mockIo = { emit: jest.fn() };
    jobSearchService.setupRealtimeUpdates(mockIo);
    resetCollections();
  });

  afterEach(() => {
    delete global.fetch;
    jest.clearAllMocks();
  });

  // ── computeFilterHash ──────────────────────────────────────────────────────

  describe('computeFilterHash', () => {
    it('is deterministic for the same filters', () => {
      const h1 = jobSearchService.computeFilterHash({ keyword: 'engineer', location: 'NYC' });
      const h2 = jobSearchService.computeFilterHash({ keyword: 'engineer', location: 'NYC' });
      expect(h1).toBe(h2);
    });

    it('is insensitive to key order', () => {
      const h1 = jobSearchService.computeFilterHash({ keyword: 'engineer', location: 'NYC' });
      const h2 = jobSearchService.computeFilterHash({ location: 'NYC', keyword: 'engineer' });
      expect(h1).toBe(h2);
    });

    it('is insensitive to string casing', () => {
      const h1 = jobSearchService.computeFilterHash({ keyword: 'Engineer' });
      const h2 = jobSearchService.computeFilterHash({ keyword: 'engineer' });
      expect(h1).toBe(h2);
    });

    it('produces different hashes for different filters', () => {
      const h1 = jobSearchService.computeFilterHash({ keyword: 'engineer' });
      const h2 = jobSearchService.computeFilterHash({ keyword: 'manager' });
      expect(h1).not.toBe(h2);
    });
  });

  // ── getOrFetchListings ─────────────────────────────────────────────────────

  describe('getOrFetchListings', () => {
    it('returns cached results when within TTL', async () => {
      const cachedJobs = [{ title: 'Engineer', company: 'Acme', url: 'https://example.com/1' }];
      const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1h from now

      mockCollections['jobSearchCache'] = makeCollection({
        findOne: jest.fn().mockResolvedValue({
          filterHash: 'abc',
          results: cachedJobs,
          expiresAt: futureDate,
        }),
      });

      global.fetch = jest.fn(); // should NOT be called

      const results = await jobSearchService.getOrFetchListings({ keyword: 'engineer' });

      expect(results).toEqual(cachedJobs);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('calls scraper on cache miss and stores results', async () => {
      const scraperJobs = [
        { title: 'Dev', company: 'Corp', location: 'NYC', remote_type: 'remote', ats: 'linkedin',
          url: 'https://linkedin.com/jobs/1', date_posted: '2026-01-01', skills: ['js'], snippet: 'Good job' },
      ];
      const scraperResponse = { success: true, result: { samples: scraperJobs }, stderr_tail: '' };

      mockCollections['jobSearchCache'] = makeCollection({
        findOne: jest.fn().mockResolvedValue(null), // cache miss
        updateOne: jest.fn().mockResolvedValue({}),
      });

      global.fetch = mockFetch({
        json: () => Promise.resolve(scraperResponse),
      });

      const results = await jobSearchService.getOrFetchListings(
        { keyword: 'dev' },
        { candidateId: 'cand-1', resumeUrl: 'https://example.com/resume.pdf' }
      );

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [calledUrl] = global.fetch.mock.calls[0];
      expect(calledUrl).toBe('http://scraper:8001/find-jobs');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Dev');
      expect(mockCollections['jobSearchCache'].updateOne).toHaveBeenCalled();
    });

    it('calls scraper when cached record is expired', async () => {
      const pastDate = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
      mockCollections['jobSearchCache'] = makeCollection({
        findOne: jest.fn().mockResolvedValue({
          filterHash: 'abc',
          results: [],
          expiresAt: pastDate, // expired
        }),
        updateOne: jest.fn().mockResolvedValue({}),
      });

      global.fetch = mockFetch({
        json: () => Promise.resolve({ success: true, result: { samples: [] }, stderr_tail: '' }),
      });

      await jobSearchService.getOrFetchListings(
        { keyword: 'manager' },
        { candidateId: 'cand-1', resumeUrl: 'https://example.com/resume.pdf' }
      );

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  // ── startSearch ────────────────────────────────────────────────────────────

  describe('startSearch', () => {
    it('creates session row, returns sessionId, and emits jobSearchStarted', async () => {
      jest.useFakeTimers();

      mockCollections['jobSearchSessions'] = makeCollection({
        insertOne: jest.fn().mockResolvedValue({ insertedId: { toString: () => 'session-xyz' } }),
      });

      const result = await jobSearchService.startSearch({
        candidateId: 'cand-1',
        candidateName: 'Alice',
        filters: { keyword: 'engineer' },
        requestedBy: 'admin@example.com',
      });

      // Verify return value and insert before setImmediate fires
      expect(result).toEqual({ sessionId: 'session-xyz' });
      expect(mockCollections['jobSearchSessions'].insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          candidateId: 'cand-1',
          status: 'pending',
          requestedBy: 'admin@example.com',
        })
      );
      expect(mockIo.emit).toHaveBeenCalledWith('jobSearchStarted', expect.objectContaining({
        sessionId: 'session-xyz',
        candidateId: 'cand-1',
      }));

      jest.useRealTimers();
    });
  });

  // ── triggerTailor ──────────────────────────────────────────────────────────

  describe('triggerTailor', () => {
    it('creates tailoredResumes row and emits tailorResumeStarted', async () => {
      jest.useFakeTimers();

      mockCollections['tailoredResumes'] = makeCollection({
        insertOne: jest.fn().mockResolvedValue({ insertedId: { toString: () => 'tailor-abc' } }),
      });

      const result = await jobSearchService.triggerTailor({
        sessionId: 'session-xyz',
        jobId: 'https://linkedin.com/jobs/1',
        requestedBy: 'user@example.com',
      });

      expect(result).toEqual({ tailoredId: 'tailor-abc' });
      expect(mockCollections['tailoredResumes'].insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-xyz',
          jobId: 'https://linkedin.com/jobs/1',
          status: 'pending',
          requestedBy: 'user@example.com',
        })
      );
      expect(mockIo.emit).toHaveBeenCalledWith('tailorResumeStarted', expect.objectContaining({
        tailoredId: 'tailor-abc',
        sessionId: 'session-xyz',
      }));

      jest.useRealTimers();
    });
  });
});
