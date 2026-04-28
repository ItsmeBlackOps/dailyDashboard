import OpenAI from 'openai';
import { ObjectId } from 'mongodb';
import { config } from '../config/index.js';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// JSON schema for OpenAI structured output (not Zod — uses json_schema directly)
// ---------------------------------------------------------------------------
const RESUME_SEARCH_PROFILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titles: {
      type: 'array',
      items: { type: 'string' },
      minItems: 4,
      maxItems: 12,
    },
    keywords: {
      type: 'array',
      items: { type: 'string' },
      minItems: 2,
      maxItems: 6,
    },
    years_min: { type: 'number' },
    years_max: { type: 'number' },
    baseline_skills: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['titles', 'keywords', 'years_min', 'years_max', 'baseline_skills'],
};

const SYSTEM_PROMPT = `You are a resume parser. Given the resume text below, extract structured search parameters for finding matching job postings.

Return JSON only matching the provided schema. Be specific:
- titles: 6-12 plausible job titles the candidate would target. Include role variations (Senior/Staff if 5+ YOE), domain variations (Backend Engineer, Platform Engineer, Java Developer, Full Stack Engineer, etc.), and seniority-appropriate titles based on YOE.
- keywords: 2-4 short search keywords (1-3 words each) capturing the candidate's strongest technical signals — these drive descriptionSearch in the Apify actor. Examples: "microservices", "kafka", "spring boot", "kubernetes". Avoid generic words like "engineer".
- years_min / years_max: total professional experience in years. Use ranges that make sense (e.g. 5-8, 0-2, 10-15). Round to whole numbers.
- baseline_skills: every technology, framework, language, tool, platform mentioned. Lowercase, deduplicated.`;

class ResumeProfileService {
  constructor() {
    this.enabled = Boolean(config.openai?.apiKey);
    this.client = this.enabled
      ? new OpenAI({ apiKey: config.openai.apiKey })
      : null;
    this.model = process.env.RESUME_PROFILE_MODEL || 'gpt-4o-mini';
  }

  /**
   * Derive a search profile from a resume PDF and store it on candidateDetails.forgeProfile.
   * Skips re-derivation if forgeProfile.derivedFrom matches resumeUrl and force=false.
   *
   * @param {{ candidateId: string, resumeUrl: string, force?: boolean }} opts
   * @returns {Promise<object>} the forgeProfile object
   */
  async deriveAndStore({ candidateId, resumeUrl, force = false }) {
    if (!this.enabled) {
      throw new Error('ResumeProfileService is not configured. Set OPENAI_API_KEY.');
    }
    if (!resumeUrl) {
      throw new Error('resumeUrl is required for profile derivation.');
    }
    if (!candidateId) {
      throw new Error('candidateId is required for profile derivation.');
    }

    const db = database.getDb();
    const col = db.collection('candidateDetails');
    const _id = new ObjectId(candidateId);

    // Cache check
    if (!force) {
      const existing = await col.findOne({ _id }, { projection: { forgeProfile: 1 } });
      if (existing?.forgeProfile?.derivedFrom === resumeUrl) {
        logger.debug('resumeProfileService: returning cached forgeProfile', { candidateId });
        return existing.forgeProfile;
      }
    }

    logger.info('resumeProfileService: deriving search profile', { candidateId, resumeUrl, force });

    // 1. Fetch PDF
    const pdfBuffer = Buffer.from(await (await fetch(resumeUrl)).arrayBuffer());

    // 2. Extract text via pdf-parse (lazy import to avoid test issues)
    let resumeText;
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const { text } = await pdfParse(pdfBuffer);
      resumeText = (text || '').trim();
    } catch (parseErr) {
      // pdf-parse v2 uses class-based API
      try {
        const { PDFParse } = await import('pdf-parse');
        const data = new Uint8Array(pdfBuffer);
        const parser = new PDFParse({ data });
        const result = await parser.getText();
        resumeText = (result.text || '').trim();
        try { await parser.destroy?.(); } catch { /* ignore */ }
      } catch (err2) {
        throw new Error(`pdf-parse failed: ${err2.message}`);
      }
    }

    if (!resumeText || resumeText.length < 50) {
      throw new Error('Resume text is too short or could not be parsed from PDF.');
    }

    // Truncate to ~12,000 chars to stay within token budget
    const truncated = resumeText.length > 12000
      ? resumeText.slice(0, 12000) + '\n[...truncated...]'
      : resumeText;

    // 3. Call OpenAI with structured outputs (json_schema)
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `RESUME:\n\n${truncated}` },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'ResumeSearchProfile',
          strict: true,
          schema: RESUME_SEARCH_PROFILE_SCHEMA,
        },
      },
      temperature: 0,
    });

    const rawContent = completion.choices[0]?.message?.content;
    if (!rawContent) {
      throw new Error('OpenAI did not return content for resume profile derivation.');
    }

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (e) {
      throw new Error(`OpenAI returned non-JSON content: ${rawContent.slice(0, 200)}`);
    }

    // 4. Build forgeProfile
    const forgeProfile = {
      titles: parsed.titles,
      keywords: parsed.keywords,
      years_min: parsed.years_min,
      years_max: parsed.years_max,
      baseline_skills: parsed.baseline_skills,
      derivedFrom: resumeUrl,
      derivedAt: new Date(),
    };

    // 5. Store on candidateDetails.forgeProfile
    await col.updateOne(
      { _id },
      { $set: { forgeProfile } }
    );

    logger.info('resumeProfileService: stored forgeProfile', {
      candidateId,
      titles: forgeProfile.titles?.length,
      keywords: forgeProfile.keywords,
      years_min: forgeProfile.years_min,
      years_max: forgeProfile.years_max,
    });

    return forgeProfile;
  }

  /**
   * Return the cached forgeProfile for a candidate, or null if not derived yet.
   *
   * @param {string} candidateId
   * @returns {Promise<object|null>}
   */
  async getCached(candidateId) {
    if (!candidateId) return null;
    const db = database.getDb();
    const _id = new ObjectId(candidateId);
    const doc = await db.collection('candidateDetails').findOne(
      { _id },
      { projection: { forgeProfile: 1 } }
    );
    return doc?.forgeProfile || null;
  }
}

export const resumeProfileService = new ResumeProfileService();
