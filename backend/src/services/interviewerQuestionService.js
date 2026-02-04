import { config } from '../config/index.js';
import { database } from '../config/database.js';
import { Client, Databases, Query } from 'node-appwrite';
import { taskService } from './taskService.js';
import { logger } from '../utils/logger.js';
import sanitizeHtml from 'sanitize-html';

const ALLOWED_ROLES = new Set(['recruiter', 'mlead', 'mam', 'mm']);
const WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_REQUESTS_PER_WINDOW = 3;
const TRANSCRIPT_SENTENCE_LIMIT = 400;
const TRANSCRIPT_CHAR_LIMIT = 15000;
const DEFAULT_OPENAI_TIMEOUT_MS = 300000;
const OPENAI_MAX_ATTEMPTS = 3;
const OPENAI_RETRY_BACKOFF_MS = 2000;

const QUESTION_TYPES = new Set([
  'behavioral',
  'technical',
  'managerial',
  'process',
  'culture',
  'other'
]);

const SYSTEM_PROMPT = `You are an Expert Interview Notes Extractor focused solely on identifying INTERVIEWER QUESTIONS from an interview transcript.

Extract only what the INTERVIEWER asked — no candidate responses or unrelated narration.

🎯 Goal: Identify all interviewer questions (verbatim if possible) and organize them cleanly.

🧠 Extraction Rules:
- Include exact quotes wherever possible.
- If paraphrasing is necessary, add "paraphrased": true.
- Deduplicate similar or repeated questions; keep the clearest version.
- Tag each question by type: behavioral | technical | managerial | process | culture | other.
- Exclude follow-up filler questions like "Got it?" or "Anything else?".

✅ Output Format (respond with pure JSON, no Markdown or commentary):
{
  "Interviewer Questions": [
    {
      "question": "<Exact interviewer question>",
      "type": "behavioral | technical | managerial | process | culture | other",
      "paraphrased": false
    }
  ]
}

If no interviewer questions are found, return an empty array. Always return valid JSON that matches this schema.`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class InterviewerQuestionService {
  constructor() {
    this.usage = new Map();
    // Appwrite Initialization
    if (config.appwrite.endpoint && config.appwrite.projectId && config.appwrite.apiKey) {
      this.client = new Client()
        .setEndpoint(config.appwrite.endpoint)
        .setProject(config.appwrite.projectId)
        .setKey(config.appwrite.apiKey);
      this.databases = new Databases(this.client);
    } else {
      logger.warn('Appwrite not configured. Transcript fetching will fail if attempted.');
      this.databases = null;
    }
  }

  ensureFeatureEnabled() {
    if (!config.openai?.apiKey) {
      const error = new Error('Question extraction is not configured. Please set OPENAI_API_KEY.');
      error.statusCode = 503;
      throw error;
    }
  }

  ensureRoleAllowed(role) {
    const normalized = (role || '').toLowerCase();
    if (!ALLOWED_ROLES.has(normalized)) {
      const error = new Error('Only recruiters and interview support leads can extract interviewer questions.');
      error.statusCode = 403;
      throw error;
    }
  }

  cleanupUsage(email) {
    const now = Date.now();
    const entries = this.usage.get(email) || [];
    const recent = entries.filter((timestamp) => now - timestamp < WINDOW_MS);
    if (recent.length === 0) {
      this.usage.delete(email);
    } else {
      this.usage.set(email, recent);
    }
    return recent;
  }

  enforceRateLimit(email) {
    const normalizedEmail = (email || '').toLowerCase();
    const recent = this.cleanupUsage(normalizedEmail);
    if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
      const error = new Error('Rate limit exceeded. Please try again later.');
      error.statusCode = 429;
      error.retryAfter = new Date(recent[0] + WINDOW_MS).toISOString();
      throw error;
    }
    const now = Date.now();
    recent.push(now);
    this.usage.set(normalizedEmail, recent);
    const oldest = recent[0];
    const remaining = Math.max(0, MAX_REQUESTS_PER_WINDOW - recent.length);
    return {
      remaining,
      resetAt: new Date(oldest + WINDOW_MS).toISOString()
    };
  }

  async fetchTranscript(task) {
    if (!this.databases) {
      logger.error('Appwrite database client not initialized');
      return null;
    }

    const title = (task.subject || task.Subject || task.title || '').trim();
    if (!title) {
      return null;
    }

    try {
      const { databaseId, transcriptsCollectionId } = config.appwrite;

      logger.debug('Querying Appwrite for transcript', {
        databaseId,
        collectionId: transcriptsCollectionId,
        query: { title },
        queryType: 'Query.equal'
      });

      const response = await this.databases.listDocuments(
        databaseId,
        transcriptsCollectionId,
        [Query.equal('title', title)]
      );

      if (response && response.documents.length > 0) {
        logger.debug('Transcript found', {
          title,
          documentId: response.documents[0].$id,
          documentsCount: response.documents.length
        });
        return response.documents[0];
      }

      logger.debug('No transcript found', { title });
    } catch (error) {
      logger.error('Failed to fetch transcript from Appwrite', {
        error: error.message,
        title
      });
    }

    return null;
  }

  buildTranscriptScript(sentences = []) {
    if (!Array.isArray(sentences) || sentences.length === 0) {
      return '';
    }

    const limited = sentences
      .filter((entry) => entry && (typeof entry.raw_text === 'string' || typeof entry.text === 'string'))
      .slice(0, TRANSCRIPT_SENTENCE_LIMIT);

    const lines = limited
      .map((entry) => {
        const speakerName = (entry.speaker_name || '').toString().trim();
        const fallbackSpeaker = typeof entry.speaker_id === 'number' ? `Speaker ${entry.speaker_id}` : '';
        const body = (entry.raw_text || entry.text || '').toString().replace(/\s+/g, ' ').trim();
        if (!body) {
          return null;
        }
        const prefix = speakerName || fallbackSpeaker;
        return prefix ? `${prefix}: ${body}` : body;
      })
      .filter(Boolean);

    if (lines.length === 0) {
      return '';
    }

    let script = lines.join('\n');
    if (script.length > TRANSCRIPT_CHAR_LIMIT) {
      script = `${script.slice(0, TRANSCRIPT_CHAR_LIMIT)}\n…`;
    }
    return script;
  }

  normalizeQuestions(payload) {
    const questions = Array.isArray(payload?.['Interviewer Questions'])
      ? payload['Interviewer Questions']
      : [];

    return questions
      .map((entry) => {
        const rawQuestion = typeof entry?.question === 'string' ? entry.question.trim() : '';
        if (!rawQuestion) {
          return null;
        }

        const sanitizedQuestion = sanitizeHtml(rawQuestion, {
          allowedTags: [],
          allowedAttributes: {}
        }).trim();

        if (!sanitizedQuestion) {
          return null;
        }

        const rawType = typeof entry?.type === 'string' ? entry.type.trim().toLowerCase() : 'other';
        const normalizedType = QUESTION_TYPES.has(rawType) ? rawType : 'other';
        const paraphrased = entry?.paraphrased === true;

        return {
          question: sanitizedQuestion.slice(0, 2000),
          type: normalizedType,
          paraphrased
        };
      })
      .filter(Boolean);
  }

  async callOpenAI(transcriptScript) {
    const { apiKey, baseUrl, model, timeoutMs } = config.openai;
    const configuredTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
    const baseTimeout = Math.max(DEFAULT_OPENAI_TIMEOUT_MS, configuredTimeout);

    let lastError;

    for (let attempt = 1; attempt <= OPENAI_MAX_ATTEMPTS; attempt += 1) {
      const attemptTimeout = Math.round(baseTimeout + (attempt - 1) * (baseTimeout * 0.5));
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), attemptTimeout);

      try {
        const requestBody = {
          model: config.openai.model || 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: SYSTEM_PROMPT
            },
            {
              role: 'user',
              content: transcriptScript
            }
          ],
          temperature: 0.7,
          response_format: {
            type: 'json_object'
          }
        };

        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        if (!response.ok) {
          const errText = await response.text();
          const error = new Error(`OpenAI request failed: ${response.status} ${errText}`);
          error.statusCode = response.status >= 500 ? 502 : 400;
          throw error;
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
          const error = new Error('OpenAI response did not include content.');
          error.statusCode = 502;
          throw error;
        }

        let parsed;
        try {
          parsed = JSON.parse(content);
        } catch (parseError) {
          const error = new Error('OpenAI response was not valid JSON.');
          error.statusCode = 502;
          error.retryable = false;
          throw error;
        }

        return parsed;
      } catch (error) {
        clearTimeout(timeoutHandle);
        let currentError = error;
        if (error.name === 'AbortError') {
          currentError = new Error('Question extraction took longer than expected. Please retry shortly.');
          currentError.statusCode = 503;
          currentError.retryable = attempt < OPENAI_MAX_ATTEMPTS;
          logger.warn('OpenAI interviewer questions request aborted due to timeout', {
            attempt,
            timeoutMs: attemptTimeout
          });
        } else {
          if (!currentError.statusCode) {
            currentError.statusCode = 502;
          }
          if (typeof currentError.retryable === 'undefined') {
            currentError.retryable = currentError.statusCode >= 500;
          }
          logger.error('OpenAI interviewer questions request failed', {
            attempt,
            message: currentError.message
          });
        }

        lastError = currentError;

        if (currentError.retryable !== false && attempt < OPENAI_MAX_ATTEMPTS) {
          await wait(OPENAI_RETRY_BACKOFF_MS * attempt);
          continue;
        }
        throw lastError;
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    const fallbackError = new Error('Question extraction is unavailable right now. Please try again shortly.');
    fallbackError.statusCode = 503;
    throw fallbackError;
  }

  async getInterviewerQuestions({ taskId, user }) {
    this.ensureFeatureEnabled();
    this.ensureRoleAllowed(user.role);

    const taskResult = await taskService.getTaskById(taskId, user.email, user.role, user.teamLead);
    const task = taskResult?.task;
    if (!task) {
      const error = new Error('Task not found');
      error.statusCode = 404;
      throw error;
    }

    const transcriptDoc = await this.fetchTranscript(task);
    if (!transcriptDoc || !Array.isArray(transcriptDoc.sentences) || transcriptDoc.sentences.length === 0) {
      const error = new Error('Transcript not found for this task.');
      error.statusCode = 404;
      throw error;
    }

    const script = this.buildTranscriptScript(transcriptDoc.sentences);
    if (!script) {
      const error = new Error('Transcript content is empty.');
      error.statusCode = 400;
      throw error;
    }

    const rateLimit = this.enforceRateLimit(user.email);
    logger.info('Extracting interviewer questions via OpenAI', {
      userEmail: user.email,
      taskId,
      transcriptLength: script.length
    });

    const payload = await this.callOpenAI(script);
    const questions = this.normalizeQuestions(payload);

    return {
      questions,
      generatedAt: new Date().toISOString(),
      rateLimit
    };
  }
}

export const interviewerQuestionService = new InterviewerQuestionService();
