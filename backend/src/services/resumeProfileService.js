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

const SYSTEM_PROMPT = `You parse a resume into search parameters for matching job postings on LinkedIn / Apify Fantastic Jobs. Return JSON only matching the provided schema.

Hard rules:
- titles: 4-12 CANONICAL job titles the candidate is realistically targetable for, exactly as employers post them. Keep them generic enough to match many JDs.
  • Use the title family the candidate has ACTUALLY done (Data Analyst → Data Analyst, BI Analyst, Analytics Engineer; Java backend → Backend Engineer, Java Developer, Software Engineer).
  • Include 1-2 seniority variants matching their YoE (5 yrs → "Senior X" + "X"; 10+ yrs → "Lead X", "Staff X").
  • Skip exotic/joined titles like "Cloud Native Microservices Engineer" — those don't match real postings.
  • No prefix-match wildcards (no ":*"). Plain titles only.
- keywords: 2-6 short technical phrases (1-3 words each) that strongly signal fit when present in a JD. Pick the candidate's load-bearing tech (e.g. "kafka", "spring boot", "snowflake"), not generic words ("engineer", "developer", "team player").
- years_min: lowest YoE the candidate would still accept on a posting. For a candidate with 5 yrs total experience this is typically 3, not 5 — they'd accept a "3+ years" job. Floor at 0.
- years_max: candidate's actual total years of professional experience, rounded down to whole number. Used to filter out clearly-overqualified senior postings.
- baseline_skills: every technology / framework / language / tool / platform / methodology mentioned in the resume. Lowercase, deduplicated, no stop-words.`;

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
    logger.info('resumeProfileService: calling OpenAI', {
      candidateId,
      model: this.model,
      resumeChars: truncated.length,
    });
    const t0 = Date.now();
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
    logger.info('resumeProfileService: OpenAI returned', {
      candidateId,
      ms: Date.now() - t0,
      tokensIn: completion.usage?.prompt_tokens,
      tokensOut: completion.usage?.completion_tokens,
      modelReturned: completion.model,
      finishReason: completion.choices[0]?.finish_reason,
      contentLen: rawContent?.length || 0,
    });
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
