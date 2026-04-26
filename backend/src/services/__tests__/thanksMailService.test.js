import { jest } from '@jest/globals';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { ...mockLogger, child: jest.fn(() => ({ ...mockLogger, child: jest.fn() })) },
  createTimer: jest.fn(() => ({ end: jest.fn() }))
}));

jest.unstable_mockModule('../taskService.js', () => ({
  taskService: {
    getTaskById: jest.fn(),
    getTasksForUser: jest.fn()
  }
}));

jest.unstable_mockModule('../../config/database.js', () => ({
  database: { getCollection: jest.fn() }
}));

const { thanksMailService } = await import('../thanksMailService.js');
const { config } = await import('../../config/index.js');

describe('thanksMailService', () => {
  let originalFetch;
  const originalConfig = { ...config.openai };

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  beforeEach(() => {
    config.openai.apiKey = 'test-key';
    config.openai.baseUrl = 'https://example.com/v1';
    config.openai.model = 'gpt-test';
    config.openai.timeoutMs = 0;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    config.openai.apiKey = originalConfig.apiKey;
    config.openai.baseUrl = originalConfig.baseUrl;
    config.openai.model = originalConfig.model;
    config.openai.timeoutMs = originalConfig.timeoutMs;
    global.fetch = originalFetch;
  });

  describe('renderMarkdownToHtml', () => {
    it('converts markdown to sanitized html', () => {
      const markdown = [
        'Subject: **Hello**',
        '',
        'Hi [there](https://example.com) <script>alert("xss")</script>'
      ].join('\n');

      const html = thanksMailService.renderMarkdownToHtml(markdown);

      expect(html).toContain('<strong>Hello</strong>');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).not.toContain('<script>');
    });

    it('returns empty string when markdown is blank', () => {
      expect(thanksMailService.renderMarkdownToHtml('   ')).toBe('');
    });
  });

  describe('callOpenAI', () => {
    it('returns trimmed content when OpenAI responds successfully', async () => {
      const prompt = 'Sample prompt';
      global.fetch.mockResolvedValue({
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: '  Email body  '
                }
              }
            ]
          };
        },
        async text() {
          return '';
        }
      });

      const result = await thanksMailService.callOpenAI(prompt);

      expect(result).toBe('Email body');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [requestUrl, requestInit] = global.fetch.mock.calls[0];
      expect(requestUrl).toBe('https://example.com/v1/chat/completions');
      expect(requestInit.method).toBe('POST');

      const payload = JSON.parse(requestInit.body);
      expect(payload.messages[0]).toEqual({
        role: 'system',
        content: prompt
      });
    });

    it('retries on AbortError and throws a friendly message', async () => {
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      global.fetch.mockRejectedValue(abortError);

      jest.useFakeTimers();
      try {
        const promise = thanksMailService.callOpenAI('Delayed prompt');

        // Advance past all three attempt timeouts (300000ms base + 50% per retry)
        for (let i = 0; i < 3; i += 1) {
          await Promise.resolve();
          jest.advanceTimersByTime(600000);
          await Promise.resolve();
        }

        await expect(promise).rejects.toThrow('Email generation took longer than expected. Please retry in a moment.');
        expect(global.fetch).toHaveBeenCalledTimes(3);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
