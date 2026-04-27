import { jest } from '@jest/globals';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

const mockCollection = {
  findOne: jest.fn()
};

const mockDatabase = {
  getCollection: jest.fn(() => mockCollection)
};

const mockTaskService = {
  getTaskById: jest.fn()
};

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: mockLogger
}));

jest.unstable_mockModule('../../config/database.js', () => ({
  database: mockDatabase
}));

jest.unstable_mockModule('../taskService.js', () => ({
  taskService: mockTaskService
}));

const { interviewerQuestionService } = await import('../interviewerQuestionService.js');
const { config } = await import('../../config/index.js');

describe('interviewerQuestionService', () => {
  let originalFetch;
  const originalConfig = { ...config.openai };

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  beforeEach(() => {
    interviewerQuestionService.usage.clear();
    interviewerQuestionService.transcriptsCollection = null;
    jest.clearAllMocks();
    config.openai.apiKey = 'test-key';
    config.openai.baseUrl = 'https://example.com/v1';
    config.openai.model = 'gpt-test';
    config.openai.timeoutMs = 0;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    config.openai.apiKey = originalConfig.apiKey;
    config.openai.baseUrl = originalConfig.baseUrl;
    config.openai.model = originalConfig.model;
    config.openai.timeoutMs = originalConfig.timeoutMs;
    global.fetch = originalFetch;
  });

  describe('normalizeQuestions', () => {
    it('sanitizes and normalizes interviewer questions', () => {
      const result = interviewerQuestionService.normalizeQuestions({
        'Interviewer Questions': [
          {
            question: ' <strong>Tell me about yourself?</strong> ',
            type: 'Technical',
            paraphrased: 'yes'
          },
          {
            question: 'How do you handle tight deadlines?',
            type: 'behavioral',
            paraphrased: false
          },
          {
            question: '',
            type: 'culture'
          }
        ]
      });

      expect(result).toEqual([
        {
          question: 'Tell me about yourself?',
          type: 'technical',
          paraphrased: false
        },
        {
          question: 'How do you handle tight deadlines?',
          type: 'behavioral',
          paraphrased: false
        }
      ]);
    });
  });

  describe('callOpenAI', () => {
    it('parses JSON response when OpenAI succeeds', async () => {
      const payload = {
        'Interviewer Questions': [
          { question: 'What is your experience with React?', type: 'technical', paraphrased: false }
        ]
      };

      global.fetch.mockResolvedValue({
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(payload)
                }
              }
            ]
          };
        },
        async text() {
          return '';
        }
      });

      const result = await interviewerQuestionService.callOpenAI('Transcript content');
      expect(result).toEqual(payload);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [requestUrl, requestInit] = global.fetch.mock.calls[0];
      expect(requestUrl).toBe('https://example.com/v1/chat/completions');
      expect(requestInit.method).toBe('POST');
      const body = JSON.parse(requestInit.body);
      expect(body.model).toBe('gpt-test');
      expect(body).not.toHaveProperty('max_output_tokens');
      expect(body).not.toHaveProperty('reasoning_effort');
      expect(body).not.toHaveProperty('store');
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('throws when response content is not valid JSON', async () => {
      jest.useFakeTimers();
      try {
        global.fetch.mockResolvedValue({
          ok: true,
          async json() {
            return {
              choices: [
                {
                  message: {
                    content: 'not json'
                  }
                }
              ]
            };
          },
          async text() {
            return '';
          }
        });

        const promise = interviewerQuestionService.callOpenAI('Transcript');

        await Promise.resolve();
        jest.advanceTimersByTime(2000);
        await Promise.resolve();
        jest.advanceTimersByTime(4000);
        await Promise.resolve();

        await expect(promise).rejects.toThrow(
          'OpenAI response was not valid JSON.'
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('getInterviewerQuestions', () => {
    it('returns sanitized interviewer questions with rate limit info', async () => {
      // Disable profileOnlyMode for this happy-path test
      const savedProfileOnly = config.openai.profileOnlyMode;
      config.openai.profileOnlyMode = false;
      try {
      const transcriptDoc = {
        $id: 'doc-1',
        sentences: [
          { speaker_name: 'Interviewer', raw_text: 'Can you walk me through your portfolio?' },
          { speaker_name: 'Candidate', raw_text: 'Sure, starting with the latest project…' }
        ]
      };

      const mockDatabases = {
        listDocuments: jest.fn().mockResolvedValue({ documents: [transcriptDoc] }),
        createDocument: jest.fn().mockResolvedValue({})
      };
      interviewerQuestionService.databases = mockDatabases;
      config.appwrite.databaseId = 'test-db';
      config.appwrite.transcriptsCollectionId = 'test-transcripts';

      mockTaskService.getTaskById.mockResolvedValue({
        task: {
          _id: 'task-1',
          subject: 'Sample Subject',
          transcription: true
        }
      });

      global.fetch.mockResolvedValue({
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    'Interviewer Questions': [
                      {
                        question: 'Can you walk me through your portfolio?',
                        type: 'technical',
                        paraphrased: false
                      }
                    ]
                  })
                }
              }
            ]
          };
        },
        async text() {
          return '';
        }
      });

      const result = await interviewerQuestionService.getInterviewerQuestions({
        taskId: 'task-1',
        user: {
          email: 'recruiter@example.com',
          role: 'recruiter',
          teamLead: 'lead@example.com'
        }
      });

      expect(result.questions).toEqual([
        {
          question: 'Can you walk me through your portfolio?',
          type: 'technical',
          paraphrased: false
        }
      ]);
      expect(result.rateLimit.remaining).toBe(2);
      expect(result.generatedAt).toBeTruthy();
      expect(mockDatabases.listDocuments).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(1);
      } finally {
        config.openai.profileOnlyMode = savedProfileOnly;
      }
    });
  });
});

describe('interviewerQuestionService — profileOnlyMode gate', () => {
  it('throws when config.openai.profileOnlyMode is true', async () => {
    const { config } = await import('../../config/index.js');
    const saved = config.openai.profileOnlyMode;
    config.openai.profileOnlyMode = true;

    try {
      expect(() => interviewerQuestionService.ensureFeatureEnabled()).toThrow(
        'OpenAI usage temporarily limited to candidate profile extraction.'
      );
    } finally {
      config.openai.profileOnlyMode = saved;
    }
  });

  it('does not throw when config.openai.profileOnlyMode is false and key is set', async () => {
    const { config } = await import('../../config/index.js');
    const saved = config.openai.profileOnlyMode;
    const savedKey = config.openai.apiKey;
    config.openai.profileOnlyMode = false;
    config.openai.apiKey = 'sk-test-key';

    try {
      expect(() => interviewerQuestionService.ensureFeatureEnabled()).not.toThrow();
    } finally {
      config.openai.profileOnlyMode = saved;
      config.openai.apiKey = savedKey;
    }
  });
});
