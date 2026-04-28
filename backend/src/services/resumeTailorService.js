import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

class ResumeEditorNotConfiguredError extends Error {
  constructor() {
    super('Resume editor integration is not configured');
    this.name = 'ResumeEditorNotConfiguredError';
  }
}

class ResumeEditorRequestError extends Error {
  constructor(message, status, responseBody) {
    super(message);
    this.name = 'ResumeEditorRequestError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

class ResumeTailorService {
  /**
   * Call the external resume-editor service to tailor a resume for a job.
   *
   * @param {object} params
   * @param {string} params.candidateId
   * @param {string} params.candidateName
   * @param {string} params.resumeUrl
   * @param {string} params.jobDescription
   * @param {string} params.jobTitle
   * @param {string} params.company
   * @param {string} params.location
   * @returns {{ tailoredResumeUrl: string, tailoredResumeText: string }}
   */
  async tailor({ candidateId, candidateName, resumeUrl, jobDescription, jobTitle, company, location }) {
    const { url, apiKey, timeoutMs } = config.resumeEditor;

    if (!url) {
      throw new ResumeEditorNotConfiguredError();
    }

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let response;
    try {
      response = await fetch(`${url}/tailor`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ candidateId, candidateName, resumeUrl, jobDescription, jobTitle, company, location }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      logger.error('Resume editor request failed (network/timeout)', { error: err.message });
      throw new ResumeEditorRequestError(`Resume editor request failed: ${err.message}`, null, null);
    }

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (err) {
      logger.error('Failed to parse resume editor response', { error: err.message });
      parsed = text;
    }

    if (!response.ok) {
      throw new ResumeEditorRequestError(
        'Resume editor request failed',
        response.status,
        parsed
      );
    }

    return {
      tailoredResumeUrl: parsed.tailoredResumeUrl || '',
      tailoredResumeText: parsed.tailoredResumeText || '',
    };
  }
}

export const resumeTailorService = new ResumeTailorService();
export { ResumeEditorNotConfiguredError, ResumeEditorRequestError };
