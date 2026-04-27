import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Zod schema — matches the profile shape OpenAI must return
// ---------------------------------------------------------------------------
const PROFILE_SCHEMA = z.object({
  roleFamily: z.enum([
    'data_engineering', 'data_analytics', 'data_science', 'frontend', 'backend',
    'full_stack', 'ml_engineering', 'devops', 'qa', 'pm', 'design', 'other'
  ]),
  seniorityBand: z.enum(['entry', 'mid', 'senior', 'staff_lead', 'manager', 'director']),
  yearsExperience: z.number().int().min(0).max(60),
  workAuthorization: z.enum([
    'us_citizen', 'green_card', 'h1b', 'opt', 'ead', 'f1_cpt',
    'requires_sponsorship', 'unknown'
  ]),
  employmentTypes: z.array(z.enum([
    'full_time', 'contract_w2', 'contract_c2c', 'part_time', 'internship'
  ])),
  locations: z.array(z.string()),
  remotePreference: z.enum(['remote_only', 'hybrid_ok', 'onsite_ok', 'any']),
  targetTitles: z.array(z.string()).min(1).max(10),
  coreSkills: z.array(z.string()).min(1).max(15),
  secondarySkills: z.array(z.string()).max(40),
  domainExpertise: z.array(z.string()),
  educationLevel: z.enum(['high_school', 'associate', 'bs', 'ms', 'mba', 'phd', 'other']),
});

// GPT-4o-mini pricing (per 1M tokens, as of early 2025)
const INPUT_COST_PER_1M  = 0.15;
const OUTPUT_COST_PER_1M = 0.60;

function calcCost(inputTokens, outputTokens) {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_1M
       + (outputTokens / 1_000_000) * OUTPUT_COST_PER_1M;
}

const SYSTEM_PROMPT = `You are a resume parser. Extract a structured candidate profile from the resume text provided.
Be precise and conservative — only infer information that is clearly stated or strongly implied.
For workAuthorization, look for visa status mentions; default to "unknown" if absent.
For locations, include city/state/country mentioned as current location or preferences.
For employmentTypes, default to ["full_time"] if not stated.
Return exactly the JSON fields specified — no extra commentary.`;

class CandidateProfileService {
  constructor() {
    this.enabled = Boolean(config.openai?.apiKey);
    this.client = this.enabled
      ? new OpenAI({ apiKey: config.openai.apiKey })
      : null;
    this.model = process.env.CANDIDATE_PROFILE_MODEL || 'gpt-4o-mini';
  }

  /**
   * Download a URL and return the raw Buffer.
   */
  async _fetchBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download resume (${res.status}): ${url}`);
    }
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  /**
   * Parse PDF bytes to text using pdf-parse (lazy-loaded to avoid test issues).
   */
  async _pdfToText(buffer) {
    // Modern pdf-parse v2+ uses a class-based API (PDFParse) instead of the
    // legacy default-function export. Constructor takes a Uint8Array.
    const { PDFParse } = await import('pdf-parse');
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const parser = new PDFParse({ data });
    try {
      const result = await parser.getText();
      return (result.text || '').trim();
    } finally {
      try { await parser.destroy?.(); } catch { /* ignore */ }
    }
  }

  /**
   * Main extraction entry point.
   * @param {object} opts
   * @param {string} opts.resumeUrl  - publicly accessible URL to the PDF
   * @param {object} opts.candidateDoc - MongoDB candidate document (for metadata)
   * @returns {Promise<object>} fully assembled candidateProfile document
   */
  async extractFromResume({ resumeUrl, candidateDoc }) {
    if (!this.enabled) {
      throw new Error('CandidateProfileService is not configured. Set OPENAI_API_KEY.');
    }

    if (!resumeUrl) {
      throw new Error('resumeUrl is required for profile extraction.');
    }

    // 1. Download PDF
    const buffer = await this._fetchBuffer(resumeUrl);

    // 2. Hash for idempotency
    const resumeHash = crypto.createHash('sha256').update(buffer).digest('hex');

    // 3. Parse text
    const resumeText = await this._pdfToText(buffer);
    if (!resumeText || resumeText.length < 50) {
      throw new Error('Resume text is too short or could not be parsed from PDF.');
    }

    // Truncate to ~12 000 chars to stay within a comfortable token budget
    const truncated = resumeText.length > 12000
      ? resumeText.slice(0, 12000) + '\n[...truncated...]'
      : resumeText;

    // 4. Call OpenAI with structured output
    const completion = await this.client.chat.completions.parse({
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Resume text:\n\n${truncated}` },
      ],
      response_format: zodResponseFormat(PROFILE_SCHEMA, 'candidate_profile'),
      temperature: 0,
    });

    const message = completion.choices[0]?.message;
    if (!message?.parsed) {
      throw new Error('OpenAI did not return a parseable structured response.');
    }

    const parsed = message.parsed;
    const usage = completion.usage || {};
    const inputTokens  = usage.prompt_tokens     || 0;
    const outputTokens = usage.completion_tokens || 0;
    const approxCostUsd = calcCost(inputTokens, outputTokens);

    // 5. Assemble full profile document
    const profile = {
      candidateId:    candidateDoc._id,
      candidateEmail: candidateDoc['Email ID'] || candidateDoc.email || '',
      candidateName:  candidateDoc['Candidate Name'] || candidateDoc.name || '',

      // tier 1
      roleFamily:        parsed.roleFamily,
      seniorityBand:     parsed.seniorityBand,
      yearsExperience:   parsed.yearsExperience,
      workAuthorization: parsed.workAuthorization,
      employmentTypes:   parsed.employmentTypes,
      locations:         parsed.locations,
      remotePreference:  parsed.remotePreference,

      // tier 2
      targetTitles:   parsed.targetTitles,
      coreSkills:     parsed.coreSkills,
      secondarySkills: parsed.secondarySkills,
      domainExpertise: parsed.domainExpertise,

      // tier 3
      educationLevel: parsed.educationLevel,

      // metadata
      resumeHash,
      resumeUrl,
      extractedAt:    new Date(),
      extractedBy:    this.model,
      inputTokens,
      outputTokens,
      approxCostUsd,
    };

    logger.info('CandidateProfileService: extracted profile', {
      candidateEmail: profile.candidateEmail,
      roleFamily: profile.roleFamily,
      seniorityBand: profile.seniorityBand,
      inputTokens,
      outputTokens,
      approxCostUsd: approxCostUsd.toFixed(6),
    });

    return { profile, tokensUsed: { inputTokens, outputTokens, approxCostUsd } };
  }
}

export const candidateProfileService = new CandidateProfileService();
