import { config } from '../config/index.js';
import { database } from '../config/database.js';
import { Client, Databases, Query } from 'node-appwrite';
import { taskService } from './taskService.js';
import { logger } from '../utils/logger.js';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const ALLOWED_ROLES = new Set(['recruiter', 'mlead', 'mam', 'mm']);
const WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_REQUESTS_PER_WINDOW = 3;
const TRANSCRIPT_SENTENCE_LIMIT = 400;
const TRANSCRIPT_CHAR_LIMIT = 15000;
const DEFAULT_OPENAI_TIMEOUT_MS = 300000; // allow up to 5 minutes
const OPENAI_MAX_ATTEMPTS = 3;
const OPENAI_RETRY_BACKOFF_MS = 2000;

marked.use({
  async: false,
  gfm: true,
  breaks: true,
  mangle: false,
  headerIds: false
});

const SANITIZE_OPTIONS = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'h1',
    'h2',
    'h3',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td'
  ],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'name', 'target', 'rel']
  },
  allowedSchemes: [...(sanitizeHtml.defaults.allowedSchemes || []), 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform(
      'a',
      {
        target: '_blank',
        rel: 'noopener noreferrer'
      },
      true
    )
  }
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PROMPT_TEMPLATE = `You are a recruiter-grade email drafter. Use ONLY the transcript to write a concise, specific thank-you email.

INPUT
Candidate Name: {{CANDIDATE_NAME}}
End Client: {{END_CLIENT}}

TRANSCRIPT:
{{TRANSCRIPT}}

TASK
Write a 120–160 word thank-you email that:
- Interviewer Name would be available in the Transcript.
- References 1–2 concrete topics the interviewer was excited about (initiatives, metrics, projects).
- Mirrors 1 exact phrase used by the interviewer (if appropriate).
- Briefly states a 1–2 sentence approach aligned to the team’s success criteria.
- Politely confirms the next step if mentioned.

RULES (DO NOT VIOLATE)
- If Information Not Available then remove that placeholder
- Do NOT invent facts not in the transcript.
- If a detail is missing (e.g., candidate name, interviewer name, team), insert a clear placeholder like {{CandidateName}} or {{InterviewerName}}.
- Keep tone warm, professional, and specific; avoid generic fluff.
- One subject line + one email body in Markdown. No preamble.

OUTPUT (Markdown)
Subject: Thanks, {{InterviewerName}} — enjoyed discussing {{TeamOrProject}}
Hi {{InterviewerName}},

Thank you for the time on {{DayOrDate}} to discuss {{Role}} on {{Team}}. I especially appreciated {{SpecificTopic1}} and your perspective on {{SpecificMetricOrInitiative}}.

Based on your focus on {{SuccessCriterion}}, I would approach it by {{1–2 sentence strategy from transcript}}. As discussed, I’m sharing {{ResourcePromised or omit if none}}.

I’m excited about {{Impact/Mission tie-back}} and would welcome the {{NextStepIfMentioned}}. Please let me know if I can provide anything else.

Best,
{{CandidateName}}
{{LinkedIn/Portfolio if present}}
`;

class ThanksMailService {
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
      const error = new Error('Thanks mail generation is not configured. Please set OPENAI_API_KEY.');
      error.statusCode = 503;
      throw error;
    }
  }

  ensureRoleAllowed(role) {
    const normalized = (role || '').toLowerCase();
    if (!ALLOWED_ROLES.has(normalized)) {
      const error = new Error('Only recruiters and interview support leads can generate thank-you emails.');
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

  buildPrompt(transcript, task) {
    const candidateName = task['Candidate Name'] || task.candidateName || 'N/A';
    const endClient = task['End Client'] || task.endClient || 'N/A';

    return PROMPT_TEMPLATE
      .replace('{{TRANSCRIPT}}', transcript)
      .replace('{{CANDIDATE_NAME}}', candidateName)
      .replace('{{END_CLIENT}}', endClient);
  }

  async callOpenAI(prompt) {
    const { apiKey, baseUrl, model, timeoutMs } = config.openai;
    const configuredTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
    const baseTimeout = Math.max(DEFAULT_OPENAI_TIMEOUT_MS, configuredTimeout);

    let lastError;

    for (let attempt = 1; attempt <= OPENAI_MAX_ATTEMPTS; attempt += 1) {
      const attemptTimeout = Math.round(baseTimeout + (attempt - 1) * (baseTimeout * 0.5));
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), attemptTimeout);

      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model || 'gpt-5',
            messages: [
              {
                role: 'system',
                content: prompt
              },
              {
                role: 'user',
                content: 'Provide The Proper Email Just Email Subject and Body no framing is required'
              }
            ],
            temperature: 1,
            response_format: {
              type: 'text'
            },
            verbosity: 'medium',
            reasoning_effort: 'medium',
            store: true
          }),
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
        return content.trim();
      } catch (error) {
        clearTimeout(timeoutHandle);
        if (error.name === 'AbortError') {
          const normalized = new Error('Email generation took longer than expected. Please retry in a moment.');
          normalized.statusCode = 503;
          lastError = normalized;
          logger.warn('OpenAI request aborted due to timeout', {
            attempt,
            timeoutMs: attemptTimeout
          });
        } else {
          lastError = error;
          if (!error.statusCode) {
            error.statusCode = 502;
          }
          logger.error('OpenAI request failed', {
            attempt,
            message: error.message
          });
        }

        if (attempt < OPENAI_MAX_ATTEMPTS) {
          await wait(OPENAI_RETRY_BACKOFF_MS * attempt);
          continue;
        }
        throw lastError;
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    const fallbackError = new Error('Email generation is unavailable right now. Please try again shortly.');
    fallbackError.statusCode = 503;
    throw fallbackError;
  }

  renderMarkdownToHtml(markdown) {
    if (typeof markdown !== 'string' || markdown.trim().length === 0) {
      return '';
    }

    const rendered = marked.parse(markdown);
    const sanitized = sanitizeHtml(rendered, SANITIZE_OPTIONS);
    return sanitized.trim();
  }

  async generateThanksMail({ taskId, user }) {
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
    const prompt = this.buildPrompt(script, task);
    logger.info('Generating thanks mail via OpenAI', {
      userEmail: user.email,
      taskId,
      transcriptLength: script.length
    });

    const markdown = await this.callOpenAI(prompt);
    const html = this.renderMarkdownToHtml(markdown);
    return {
      markdown,
      html,
      generatedAt: new Date().toISOString(),
      rateLimit
    };
  }
}

export const thanksMailService = new ThanksMailService();
