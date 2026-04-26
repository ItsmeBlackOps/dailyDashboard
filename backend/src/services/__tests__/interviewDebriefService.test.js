import { jest } from '@jest/globals';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }))
};

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: mockLogger,
  createTimer: () => ({ end: jest.fn() })
}));

const { interviewDebriefService } = await import('../interviewDebriefService.js');
const { config } = await import('../../config/index.js');

describe('interviewDebriefService', () => {
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

  it('builds transcript script with timestamp and speaker', () => {
    const script = interviewDebriefService.buildTranscriptScript([
      {
        start_time: 75,
        speaker_name: 'Interviewer',
        raw_text: 'Can you explain your Java project?'
      },
      {
        start: 100,
        speaker_name: 'Candidate',
        raw_text: 'Yes, I built a microservice in Spring Boot.'
      }
    ]);

    expect(script).toContain('[01:15] Interviewer: Can you explain your Java project?');
    expect(script).toContain('[01:40] Candidate: Yes, I built a microservice in Spring Boot.');
  });

  it('injects task fields into the prompt', () => {
    const prompt = interviewDebriefService.buildPrompt(
      {
        'Candidate Name': 'Aditi Sharma',
        'Job Title': 'Java Developer',
        'End Client': 'Acme',
        'Interview Round': 'Recruiter Screen',
        'Date of Interview': '02/27/2026',
        'Start Time Of Interview': '10:00 AM',
        jobDescriptionText: 'Java 8, Spring Boot, React'
      },
      '[00:10] Interviewer: Tell me about your Java work.'
    );

    expect(prompt).toContain('1. Candidate: Aditi Sharma');
    expect(prompt).toContain('2. Role: Java Developer');
    expect(prompt).toContain('3. Company/Client: Acme');
    expect(prompt).toContain('4. Interview type/round: Recruiter Screen');
    expect(prompt).toContain('6. Job requirements (paste): Java 8, Spring Boot, React');
    expect(prompt).toContain('[00:10] Interviewer: Tell me about your Java work.');
  });

  it('returns trimmed text from OpenAI response', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: '  1) Overall Score\n- Score: 8/10  '
              }
            }
          ]
        };
      },
      async text() {
        return '';
      }
    });

    const result = await interviewDebriefService.callOpenAi('sample prompt');
    expect(result).toBe('1) Overall Score\n- Score: 8/10');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = global.fetch.mock.calls[0];
    expect(requestUrl).toBe('https://example.com/v1/chat/completions');
    expect(requestInit.method).toBe('POST');
  });
});
