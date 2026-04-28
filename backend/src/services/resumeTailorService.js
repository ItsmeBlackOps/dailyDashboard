import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

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
   * Call the forge-ai service to tailor a resume for a job.
   *
   * @param {object} params
   * @param {string} params.candidateId
   * @param {object} params.candidate  - forge-ai candidate schema object
   * @param {string} params.jobTitle
   * @param {string} params.company
   * @param {string} params.jobDescription
   * @param {string} [params.jobUrl]
   * @param {string[]} [params.mustHaveSkills]
   * @returns {{ tailoredResumeUrl: string, tailoredResumeText: string, tailoredResumeJson: object, runDir: string }}
   */
  async tailor({ candidateId, candidate, jobTitle, company, jobDescription, jobUrl, mustHaveSkills }) {
    const url = config.forgeAiService.url + '/tailor';

    const body = {
      candidate,
      jdText: jobDescription || `${jobTitle} at ${company}\n\n${jobUrl || ''}`,
      jdMustHaves: Array.isArray(mustHaveSkills) ? mustHaveSkills : undefined,
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

    return {
      tailoredResumeUrl: '', // forge-ai writes locally; no public URL
      tailoredResumeText: JSON.stringify(json.resume, null, 2),
      tailoredResumeJson: json.resume,
      runDir: json.runDir,
    };
  }
}

export const resumeTailorService = new ResumeTailorService();
export { ForgeAiRequestError };
