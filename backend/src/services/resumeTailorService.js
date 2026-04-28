import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Resume Tailor service — calls the hosted ResumeForge endpoint.
 *
 * Default URL: https://resumeforge.silverspace.tech/tailor
 * Override via FORGE_AI_SERVICE_URL env var (e.g. http://localhost:8787 for local dev).
 *
 * Request body (per API spec):
 *   {
 *     candidate: {
 *       slug?, name, location?, contact: { email, phone, linkedin },
 *       education?: [...], companies: [...], baseline_skills: [...], projects?: [...]
 *     },
 *     jd_text: string,
 *     must_haves?: string[]
 *   }
 *
 * Response:
 *   { resume: {...}, meta: {...}, history: [...], validation: {...}, keyword_coverage?: {...} }
 */

class ForgeAiRequestError extends Error {
  constructor(message, status, responseBody) {
    super(message);
    this.name = 'ForgeAiRequestError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

class ResumeTailorService {
  /**
   * @param {object} params
   * @param {string} params.candidateId
   * @param {object} params.candidate            forge-ai candidate object (see API spec)
   * @param {string} params.jobTitle
   * @param {string} params.company
   * @param {string} params.jobDescription
   * @param {string} [params.jobUrl]
   * @param {string[]} [params.mustHaveSkills]
   * @returns {{ tailoredResumeUrl, tailoredResumeText, tailoredResumeJson, meta, validation, keywordCoverage }}
   */
  async tailor({ candidateId, candidate, jobTitle, company, jobDescription, jobUrl, mustHaveSkills }) {
    const url = config.forgeAiService.url + '/tailor';

    const body = {
      candidate,
      jd_text: jobDescription || `${jobTitle} at ${company}\n\n${jobUrl || ''}`,
      ...(Array.isArray(mustHaveSkills) && mustHaveSkills.length
        ? { must_haves: mustHaveSkills }
        : {}),
    };

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.forgeAiService.timeoutMs),
      });
    } catch (err) {
      logger.error('forge-ai request failed (network/timeout)', { error: err.message });
      throw new ForgeAiRequestError(`forge-ai request failed: ${err.message}`, null, null);
    }

    if (!response.ok) {
      const text = await response.text();
      logger.error('forge-ai returned non-OK status', { status: response.status, body: text.slice(0, 500) });
      throw new ForgeAiRequestError(
        `forge-ai ${response.status}: ${text.slice(0, 500)}`,
        response.status,
        text
      );
    }

    const json = await response.json();

    if (!json?.resume) {
      throw new ForgeAiRequestError('forge-ai response missing `resume` field', 200, json);
    }

    return {
      tailoredResumeUrl: '',                            // hosted service does not return a URL
      tailoredResumeText: JSON.stringify(json.resume, null, 2),
      tailoredResumeJson: json.resume,
      meta: json.meta || {},
      validation: json.validation || null,
      keywordCoverage: json.keyword_coverage || null,
    };
  }
}

export const resumeTailorService = new ResumeTailorService();
export { ForgeAiRequestError };
