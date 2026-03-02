import { config } from '../config/index.js';
import { Client, Databases, Query } from 'node-appwrite';
import { taskService } from './taskService.js';
import { logger } from '../utils/logger.js';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const TRANSCRIPT_SENTENCE_LIMIT = 500;
const TRANSCRIPT_CHAR_LIMIT = 25000;
const DEFAULT_OPENAI_TIMEOUT_MS = 300000;
const OPENAI_MAX_ATTEMPTS = 3;
const OPENAI_RETRY_BACKOFF_MS = 2000;
const JOB_STATE_TTL_MS = 2 * 60 * 60 * 1000;
const ACTIVE_JOB_STATUSES = new Set(['queued', 'processing']);

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
    'h4',
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

const PROMPT_TEMPLATE = `Below is a revised, **round-agnostic** version of your prompt. It keeps the same spirit (evidence-based debrief + coaching) but adapts the evaluation and prep plan to **whatever round it is** (recruiter screen, hiring manager, technical coding, system design, behavioral, panel, take-home debrief, etc.).

You can copy/paste and use as your new default.

---

## Dynamic Interview Debrief & Coaching Prompt (Round-Agnostic)

You are an interview debrief and coaching assistant.

Analyze the **job details** and **interview transcript** I provide.
Produce a structured evaluation focused on **answer quality**, **risks**, and **next-step preparation**.

**Hard rules**

* Do **NOT** provide guidance that involves deception, impersonation, real-time answer feeding, or cheating.
* Stay grounded in the transcript; **do not invent facts**.
* If something is unclear or missing, explicitly say: **“Not stated in transcript.”**
* Keep quotes short (<= 15 words). Do not paste large transcript chunks.
* Use **very simple words** (B2 English). Avoid complex jargon.

---

### INPUTS

1. Candidate: {{CANDIDATE_NAME}}
2. Role: {{JOB_TITLE}}
3. Company/Client: {{COMPANY}}
4. Interview type/round: {{ROUND}}
5. Date/Time: {{DATE_TIME}}
6. Job requirements (paste): {{JOB_DESCRIPTION_TEXT}}
7. Transcript (paste verbatim, keep timestamps):
   {{TRANSCRIPT_TEXT}}

---

### TASK

A) Evaluate the candidate’s answers based on the transcript.
B) Identify strengths and weaknesses with exact references.
C) Extract the next steps described by the interviewer.
D) Provide an actionable preparation plan for what the candidate should do next, aligned to the job requirements.

**Round detection requirement (important):**
First, infer the round style using **{{ROUND}} + transcript signals**, and state it in one line in Section 1.
If it is unclear, say: **“Not stated in transcript.”**

---

## OUTPUT REQUIREMENTS (use this exact section order and headings)

### 1) Overall Score

* Score: X/10
* Interview Context: (1 line: what kind of call it was, based on round detection)
* Scoring Rubric (brief): assign points across:

  * Clarity & communication (0-3)
  * Alignment to role (0-3) *(define “alignment” based on the round type; examples below)*
  * Professionalism & engagement (0-2)
  * Risk flags (0-2, subtractive)
* 2-4 bullets justifying the score, grounded in transcript evidence.

**How to interpret “Alignment to role” by round type**

* Recruiter screen: role interest + work model + basics fit + key requirements match
* Hiring manager: impact + scope + decision making + stakeholder work + ownership
* Coding: approach + correctness + testing + tradeoffs + speed vs quality
* System design: requirements + architecture + scalability + reliability + security basics
* Behavioral: clear stories + ownership + conflict handling + learning + teamwork
* Panel/onsite mix: blend of the above

---

### 2) Quality of the Candidate’s Answers (based on the transcript)

Provide **6-10 bullets** summarizing how well the candidate answered **the key themes for THIS round**.

**Step 1: Choose the right theme set (do not force recruiter themes if not a recruiter round).**

Pick from these theme sets:

**A) Recruiter / HR screen themes**

* Work authorization / sponsorship
* Compensation expectations
* Timeline / notice period / pipeline
* Interest in role / team / company
* Fit to stack + work model (onsite/hybrid/remote) + location
* Reason for change / availability

**B) Hiring manager themes**

* Current work scope and ownership
* Impact (metrics, outcomes)
* Problem solving and priorities
* Working style (stakeholders, conflict, communication)
* Domain knowledge relevant to the job
* Why this role + why now

**C) Technical coding screen themes**

* Problem understanding + questions asked
* Solution approach + correctness
* Edge cases
* Code structure + readability
* Testing mindset / debugging
* Complexity awareness (basic)

**D) System design themes**

* Requirement clarity (functional + non-functional)
* Architecture choices + tradeoffs
* Data + APIs + scaling
* Reliability + monitoring
* Security basics (only if asked)
* Cost awareness (basic)

**E) Behavioral / culture themes**

* Ownership + accountability
* Teamwork + conflict
* Feedback + learning
* Handling ambiguity
* Leadership (if role needs it)
* Values fit (based on job text)

**F) Take-home / assignment debrief themes**

* How they broke down the task
* Correctness + edge cases
* Code quality + structure
* Tests + how to run
* README clarity
* Tradeoffs + what they would improve

**Step 2: For each bullet include evidence**
For each bullet, include:
Evidence: [mm:ss-mm:ss] "short quote (<=15 words)"

If a theme never appears in the transcript, write: **Not stated in transcript.**

---

### 3) Strong Points of the Candidate in this interview

* List **4-7** strong points.
* Each point must include:

  * What was strong
  * Why it matters for this role
  * Evidence reference: [mm:ss-mm:ss] "short quote"

---

### 4) Weak Points / Mistakes (must include references)

* List every mistake, ambiguity, or missed chance (**minimum 3 if present**).
* For each:

  * Issue (what happened)
  * Impact (why it’s risky)
  * Fix (what to say/do next time in 1-2 sentences)
  * Evidence: [mm:ss-mm:ss] "short quote"

**Extra focus (only when relevant to this round)**

* Recruiter: comp mismatch, unclear numbers, work model, location, notice period
* Hiring manager: weak impact, vague ownership, unclear examples
* Coding: no tests, missed edge cases, messy structure, no explanation
* System design: no requirements, no tradeoffs, weak scaling/reliability
* Behavioral: story not structured, no “what I did”, no result, blame language

---

### 5) Next Steps Told By Interviewer

* Bullet list the process **exactly as described**.
* Include timelines mentioned (e.g., “next week”) and sequence.
* Each bullet must include:
  Evidence: [mm:ss-mm:ss]

If none are stated: **Not stated in transcript.**

---

### 6) What the Candidate Should Prepare Next

Provide a practical plan with **three parts**. Keep it aligned to the job requirements.

#### 6.1 Immediate Actions (next 24-48 hours)

* 4-8 bullets. Examples:

  * Confirm scheduling windows
  * Clarify work model expectations
  * Prepare comp range response (if asked)
  * Gather role-matching examples and metrics
* If an item is not relevant to this round, do not include it.

#### 6.2 Round-Specific Preparation (only include the subsections that apply)

Include **only** what matches the interviewer’s next step or the round type.
Possible subsections (use the exact subsection titles you include):

**6.2.A Coding Assessment Preparation (if applicable)**

* Checklist grouped by:

  * Solution correctness & edge cases
  * Code quality & structure
  * Tests and how to run
  * README / run instructions
  * Performance & error handling
  * Tradeoffs and assumptions to explain

**6.2.B System Design Preparation (if applicable)**

* Checklist grouped by:

  * Requirement questions
  * Core components and data flow
  * Scaling plan
  * Reliability and monitoring
  * Security basics (only if in job text)
  * Tradeoffs to explain

**6.2.C Behavioral Preparation (if applicable)**

* Checklist grouped by:

  * Story structure (STAR)
  * Ownership and impact
  * Conflict and feedback
  * Working under pressure
  * Learning and growth

#### 6.3 Interview Prep for the Next Round(s)

* Map prep topics to **job requirements from the job description**.
* Only include skill areas that are in the job text. If missing, say: **Not stated in job description.**
* Provide **6-10 likely questions** (technical + behavioral) tailored to the role and the next round type.
* Provide **2-3 “ready stories”** the candidate should prepare (**STAR format titles only**).

---

## Why this version is dynamic (what changed)

* Section 2 no longer forces recruiter-only themes. It selects themes by round type.
* Section 6.2 is now “Round-Specific Preparation” with optional subsections (coding / design / behavioral).
* Scoring “Alignment to role” is defined differently depending on the round.
`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatTimestamp = (seconds) => {
  if (!Number.isFinite(seconds)) {
    return '';
  }
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

class InterviewDebriefService {
  constructor() {
    if (config.appwrite.endpoint && config.appwrite.projectId && config.appwrite.apiKey) {
      this.client = new Client()
        .setEndpoint(config.appwrite.endpoint)
        .setProject(config.appwrite.projectId)
        .setKey(config.appwrite.apiKey);
      this.databases = new Databases(this.client);
    } else {
      logger.warn('Appwrite is not configured. Interview debrief generation will fail.');
      this.databases = null;
    }

    this.jobStates = new Map();
    this.pendingJobs = [];
    this.workerRunning = false;
  }

  ensureOpenAiEnabled() {
    if (!config.openai?.apiKey) {
      const error = new Error('Interview debrief generation is not configured. Please set OPENAI_API_KEY.');
      error.statusCode = 503;
      throw error;
    }
  }

  ensureTranscriptSourceConfigured() {
    if (!this.databases || !config.appwrite.databaseId || !config.appwrite.transcriptsCollectionId) {
      const error = new Error('Transcript source is not configured. Please configure Appwrite transcript collection.');
      error.statusCode = 503;
      throw error;
    }
  }

  ensureDebriefCollectionConfigured() {
    if (!this.databases || !config.appwrite.databaseId || !config.appwrite.interviewDebriefCollectionId) {
      const error = new Error(
        'Interview debrief collection is not configured. Please set APPWRITE_COLLECTION_ID_INTERVIEW_DEBRIEF.'
      );
      error.statusCode = 503;
      throw error;
    }
  }

  cleanValue(value, fallback = 'Not stated in transcript.') {
    if (typeof value !== 'string') {
      return fallback;
    }
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : fallback;
  }

  buildDateTime(task) {
    const dateValue = this.cleanValue(task['Date of Interview'] || task.dateOfInterview || '', '');
    const startTime = this.cleanValue(task['Start Time Of Interview'] || task.startTime || '', '');
    const endTime = this.cleanValue(task['End Time Of Interview'] || task.endTime || '', '');

    const joined = [dateValue, startTime && endTime ? `${startTime} - ${endTime}` : startTime]
      .filter(Boolean)
      .join(' ');

    return joined || 'Not stated in transcript.';
  }

  async fetchTranscript(task) {
    this.ensureTranscriptSourceConfigured();

    const title = (task.subject || task.Subject || task.title || '').trim();
    if (!title) {
      return null;
    }

    try {
      const response = await this.databases.listDocuments(
        config.appwrite.databaseId,
        config.appwrite.transcriptsCollectionId,
        [Query.equal('title', title), Query.limit(1)]
      );

      if (!response || response.documents.length === 0) {
        return null;
      }

      const transcriptDoc = response.documents[0];
      if (transcriptDoc.sentences_json && typeof transcriptDoc.sentences_json === 'string') {
        try {
          transcriptDoc.sentences = JSON.parse(transcriptDoc.sentences_json);
        } catch (error) {
          logger.warn('Unable to parse transcript sentences_json', {
            title,
            error: error.message
          });
        }
      }

      return transcriptDoc;
    } catch (error) {
      logger.error('Failed to fetch transcript for interview debrief', {
        error: error.message,
        title
      });
      return null;
    }
  }

  buildTranscriptScript(sentences = []) {
    if (!Array.isArray(sentences) || sentences.length === 0) {
      return '';
    }

    const lines = sentences
      .filter((entry) => entry && (typeof entry.raw_text === 'string' || typeof entry.text === 'string'))
      .slice(0, TRANSCRIPT_SENTENCE_LIMIT)
      .map((entry) => {
        const text = (entry.raw_text || entry.text || '').toString().replace(/\s+/g, ' ').trim();
        if (!text) {
          return null;
        }

        const speaker =
          (entry.speaker_name || '').toString().trim() ||
          (Number.isFinite(entry.speaker_id) ? `Speaker ${entry.speaker_id}` : '');
        const speakerPrefix = speaker ? `${speaker}: ` : '';

        const secondCandidates = [
          entry.start,
          entry.start_time,
          entry.start_seconds,
          entry.startTimeSeconds
        ].map((value) => (typeof value === 'number' ? value : Number.NaN));
        const rawSeconds = secondCandidates.find((value) => Number.isFinite(value));
        const timestamp = formatTimestamp(rawSeconds);
        const timestampPrefix = timestamp ? `[${timestamp}] ` : '';

        return `${timestampPrefix}${speakerPrefix}${text}`;
      })
      .filter(Boolean);

    if (lines.length === 0) {
      return '';
    }

    const script = lines.join('\n');
    if (script.length > TRANSCRIPT_CHAR_LIMIT) {
      return `${script.slice(0, TRANSCRIPT_CHAR_LIMIT)}\n...`;
    }

    return script;
  }

  buildPrompt(task, transcriptScript) {
    const replacements = {
      '{{CANDIDATE_NAME}}': this.cleanValue(task['Candidate Name'] || task.candidateName || '', '<CANDIDATE_NAME>'),
      '{{JOB_TITLE}}': this.cleanValue(task['Job Title'] || task.jobTitle || '', '<JOB_TITLE>'),
      '{{COMPANY}}': this.cleanValue(task['End Client'] || task.endClient || '', '<COMPANY>'),
      '{{ROUND}}': this.cleanValue(task['Interview Round'] || task.interviewRound || '', '<ROUND>'),
      '{{DATE_TIME}}': this.buildDateTime(task),
      '{{JOB_DESCRIPTION_TEXT}}': this.cleanValue(task.jobDescriptionText || '', 'Not stated in transcript.'),
      '{{TRANSCRIPT_TEXT}}': transcriptScript || 'Not stated in transcript.'
    };

    return Object.entries(replacements).reduce(
      (prompt, [token, value]) => prompt.replace(token, value),
      PROMPT_TEMPLATE
    );
  }

  async callOpenAi(prompt) {
    const { apiKey, baseUrl, model, timeoutMs } = config.openai;
    const configuredTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
    const baseTimeout = Math.max(DEFAULT_OPENAI_TIMEOUT_MS, configuredTimeout);

    let lastError = null;

    for (let attempt = 1; attempt <= OPENAI_MAX_ATTEMPTS; attempt += 1) {
      const attemptTimeout = Math.round(baseTimeout + (attempt - 1) * (baseTimeout * 0.5));
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), attemptTimeout);

      try {
        const requestBody = {
          model: model || 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.2,
          response_format: {
            type: 'text'
          }
        };

        const reasoningEffort = (config.openai?.reasoningEffort || '').trim().toLowerCase();
        if (['low', 'medium', 'high', 'none'].includes(reasoningEffort)) {
          requestBody.reasoning_effort = reasoningEffort;
        }

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
          const responseText = await response.text();
          const error = new Error(`OpenAI request failed: ${response.status} ${responseText}`);
          error.statusCode = response.status >= 500 ? 502 : 400;
          throw error;
        }

        const payload = await response.json();
        const content = payload?.choices?.[0]?.message?.content;
        if (!content || typeof content !== 'string') {
          const error = new Error('OpenAI response did not include content.');
          error.statusCode = 502;
          throw error;
        }

        return content.trim();
      } catch (error) {
        if (error.name === 'AbortError') {
          const timeoutError = new Error(
            'Interview debrief generation took longer than expected. Please retry in a moment.'
          );
          timeoutError.statusCode = 503;
          lastError = timeoutError;
          logger.warn('Interview debrief OpenAI request timed out', {
            attempt,
            timeoutMs: attemptTimeout
          });
        } else {
          if (!error.statusCode) {
            error.statusCode = 502;
          }
          lastError = error;
          logger.error('Interview debrief OpenAI request failed', {
            attempt,
            error: error.message
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

    const genericError = new Error('Interview debrief generation is unavailable right now. Please retry shortly.');
    genericError.statusCode = 503;
    throw genericError;
  }

  renderMarkdownToHtml(markdown) {
    if (typeof markdown !== 'string' || markdown.trim().length === 0) {
      return '';
    }

    const rawHtml = marked.parse(markdown);
    return sanitizeHtml(rawHtml, SANITIZE_OPTIONS).trim();
  }

  normalizeTaskId(taskId = '') {
    return (taskId || '').toString().trim();
  }

  pruneJobStates() {
    const now = Date.now();
    for (const [taskId, state] of this.jobStates.entries()) {
      if (now - state.updatedAtMs > JOB_STATE_TTL_MS) {
        this.jobStates.delete(taskId);
      }
    }
  }

  getJobState(taskId) {
    this.pruneJobStates();
    return this.jobStates.get(taskId) || null;
  }

  setJobState(taskId, status, details = {}) {
    const previous = this.jobStates.get(taskId) || {};
    const nextState = {
      taskId,
      status,
      queuedAt: details.queuedAt || previous.queuedAt || null,
      startedAt: details.startedAt || previous.startedAt || null,
      completedAt: details.completedAt || previous.completedAt || null,
      error: details.error || null,
      requestedBy: details.requestedBy || previous.requestedBy || null,
      result: Object.prototype.hasOwnProperty.call(details, 'result') ? details.result : (previous.result || null),
      updatedAtMs: Date.now()
    };
    this.jobStates.set(taskId, nextState);
    return nextState;
  }

  async getTaskWithAccess(taskId, user) {
    const taskResult = await taskService.getTaskById(
      taskId,
      user.email,
      user.role,
      user.teamLead,
      user.manager
    );
    const task = taskResult?.task;
    if (!task) {
      const error = new Error('Task not found');
      error.statusCode = 404;
      throw error;
    }
    return task;
  }

  formatReadyPayload(cachedDoc) {
    return {
      status: 'ready',
      markdown: cachedDoc.content,
      html: this.renderMarkdownToHtml(cachedDoc.content),
      generatedAt: cachedDoc.createdAt,
      cached: true
    };
  }

  formatReadyPayloadFromResult(result) {
    return {
      status: 'ready',
      markdown: result.markdown,
      html: result.html || this.renderMarkdownToHtml(result.markdown),
      generatedAt: result.generatedAt,
      cached: Boolean(result.cached)
    };
  }

  async generateDebriefForTask(taskId, task, force = false) {
    if (!force) {
      const cached = await this.getCachedContent(taskId);
      if (cached?.content) {
        return {
          markdown: cached.content,
          html: this.renderMarkdownToHtml(cached.content),
          generatedAt: cached.createdAt,
          cached: true
        };
      }
    }

    this.ensureOpenAiEnabled();

    const transcriptDoc = await this.fetchTranscript(task);
    if (!transcriptDoc || !Array.isArray(transcriptDoc.sentences) || transcriptDoc.sentences.length === 0) {
      const error = new Error('Transcript not found for this task.');
      error.statusCode = 404;
      throw error;
    }

    const transcriptScript = this.buildTranscriptScript(transcriptDoc.sentences);
    if (!transcriptScript) {
      const error = new Error('Transcript content is empty.');
      error.statusCode = 400;
      throw error;
    }

    const prompt = this.buildPrompt(task, transcriptScript);
    const markdown = await this.callOpenAi(prompt);
    const generatedAt = new Date().toISOString();
    await this.saveGeneratedContent(taskId, markdown);

    return {
      markdown,
      html: this.renderMarkdownToHtml(markdown),
      generatedAt,
      cached: false
    };
  }

  enqueueDebriefGeneration(taskId, task, requestedBy, force = false) {
    const existingState = this.getJobState(taskId);
    if (existingState && ACTIVE_JOB_STATUSES.has(existingState.status)) {
      return existingState;
    }

    const queuedAt = new Date().toISOString();
    const state = this.setJobState(taskId, 'queued', {
      queuedAt,
      requestedBy,
      error: null,
      result: null
    });

    this.pendingJobs.push({
      taskId,
      task,
      requestedBy,
      force
    });

    void this.processQueue();
    return state;
  }

  async processQueue() {
    if (this.workerRunning) {
      return;
    }

    this.workerRunning = true;
    while (this.pendingJobs.length > 0) {
      const job = this.pendingJobs.shift();
      if (!job?.taskId || !job?.task) {
        continue;
      }

      const startedAt = new Date().toISOString();
      const queuedAt = this.getJobState(job.taskId)?.queuedAt || startedAt;
      this.setJobState(job.taskId, 'processing', {
        queuedAt,
        startedAt,
        requestedBy: job.requestedBy,
        error: null,
        result: null
      });

      try {
        const result = await this.generateDebriefForTask(job.taskId, job.task, job.force);
        this.setJobState(job.taskId, 'completed', {
          queuedAt,
          startedAt,
          completedAt: result.generatedAt,
          requestedBy: job.requestedBy,
          error: null,
          result
        });
      } catch (error) {
        logger.error('Interview debrief background generation failed', {
          taskId: job.taskId,
          error: error.message
        });
        this.setJobState(job.taskId, 'failed', {
          queuedAt,
          startedAt,
          requestedBy: job.requestedBy,
          error: error.message || 'Interview debrief generation failed.',
          result: null
        });
      }
    }

    this.workerRunning = false;
  }

  async getCachedContent(taskId) {
    this.ensureDebriefCollectionConfigured();

    try {
      const response = await this.databases.listDocuments(
        config.appwrite.databaseId,
        config.appwrite.interviewDebriefCollectionId,
        [
          Query.equal('taskId', taskId),
          Query.orderDesc('$createdAt'),
          Query.limit(1)
        ]
      );

      if (!response || response.documents.length === 0) {
        return null;
      }

      const cachedDoc = response.documents[0];
      return {
        id: cachedDoc.$id,
        content: cachedDoc.content,
        createdAt: cachedDoc.createdAt || cachedDoc.$createdAt
      };
    } catch (error) {
      logger.warn('Unable to fetch cached interview debrief', {
        taskId,
        error: error.message
      });
      return null;
    }
  }

  async saveGeneratedContent(taskId, markdown) {
    this.ensureDebriefCollectionConfigured();

    const createdAt = new Date().toISOString();

    try {
      const existing = await this.getCachedContent(taskId);
      if (existing?.id) {
        await this.databases.updateDocument(
          config.appwrite.databaseId,
          config.appwrite.interviewDebriefCollectionId,
          existing.id,
          {
            content: markdown,
            createdAt
          }
        );
        return;
      }

      await this.databases.createDocument(
        config.appwrite.databaseId,
        config.appwrite.interviewDebriefCollectionId,
        'unique()',
        {
          taskId,
          content: markdown,
          createdAt
        }
      );
    } catch (error) {
      logger.warn('Unable to persist interview debrief content', {
        taskId,
        error: error.message
      });
    }
  }

  async requestInterviewDebrief({ taskId, user, force = false }) {
    const normalizedTaskId = this.normalizeTaskId(taskId);
    if (!normalizedTaskId) {
      const error = new Error('Task id is required');
      error.statusCode = 400;
      throw error;
    }

    const task = await this.getTaskWithAccess(normalizedTaskId, user);

    if (!force) {
      const state = this.getJobState(normalizedTaskId);
      if (state?.status === 'completed' && state.result) {
        return this.formatReadyPayloadFromResult(state.result);
      }

      const cached = await this.getCachedContent(normalizedTaskId);
      if (cached?.content) {
        return this.formatReadyPayload(cached);
      }
    }

    const state = this.enqueueDebriefGeneration(
      normalizedTaskId,
      task,
      user?.email || 'unknown',
      force
    );

    return {
      status: state?.status || 'queued',
      queuedAt: state?.queuedAt || null,
      startedAt: state?.startedAt || null,
      error: state?.error || null,
      message: 'Interview debrief is being generated in the background.'
    };
  }

  async getInterviewDebriefStatus({ taskId, user, autoQueue = true }) {
    const normalizedTaskId = this.normalizeTaskId(taskId);
    if (!normalizedTaskId) {
      const error = new Error('Task id is required');
      error.statusCode = 400;
      throw error;
    }

    const task = await this.getTaskWithAccess(normalizedTaskId, user);

    const cached = await this.getCachedContent(normalizedTaskId);
    if (cached?.content) {
      return this.formatReadyPayload(cached);
    }

    const state = this.getJobState(normalizedTaskId);
    if (state) {
      if (state.status === 'completed' && state.result) {
        return this.formatReadyPayloadFromResult(state.result);
      }

      if (state.status === 'completed') {
        const restarted = this.enqueueDebriefGeneration(
          normalizedTaskId,
          task,
          user?.email || 'unknown',
          true
        );
        return {
          status: restarted?.status || 'queued',
          queuedAt: restarted?.queuedAt || null,
          startedAt: restarted?.startedAt || null,
          error: null,
          message: 'Interview debrief is being regenerated in the background.'
        };
      }

      return {
        status: state.status,
        queuedAt: state.queuedAt || null,
        startedAt: state.startedAt || null,
        error: state.error || null,
        message:
          state.status === 'failed'
            ? state.error || 'Interview debrief generation failed.'
            : 'Interview debrief is still processing in the background.'
      };
    }

    if (!autoQueue) {
      return {
        status: 'queued',
        queuedAt: null,
        startedAt: null,
        error: null,
        message: 'Interview debrief has not started yet.'
      };
    }

    const queuedState = this.enqueueDebriefGeneration(
      normalizedTaskId,
      task,
      user?.email || 'unknown',
      false
    );

    return {
      status: queuedState?.status || 'queued',
      queuedAt: queuedState?.queuedAt || null,
      startedAt: queuedState?.startedAt || null,
      error: null,
      message: 'Interview debrief has been queued for background generation.'
    };
  }
}

export const interviewDebriefService = new InterviewDebriefService();
