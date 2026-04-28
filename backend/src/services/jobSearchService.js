import crypto from 'node:crypto';
import { ObjectId } from 'mongodb';
import { config } from '../config/index.js';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { resumeTailorService } from './resumeTailorService.js';

// ── Collection name constants ──────────────────────────────────────────────
const COL_CACHE = 'jobSearchCache';
const COL_SESSIONS = 'jobSearchSessions';
const COL_TAILORED = 'tailoredResumes';

class JobSearchService {
  constructor() {
    this.io = null;
    this._indexesEnsured = false;
  }

  // ── Socket ──────────────────────────────────────────────────────────────

  setupRealtimeUpdates(io) {
    this.io = io;
    logger.info('✅ jobSearchService: real-time updates configured');
  }

  _emit(event, payload) {
    if (this.io) {
      this.io.emit(event, payload);
    }
  }

  // ── US-only filter ──────────────────────────────────────────────────────

  /**
   * Drop jobs that are explicitly outside the United States. We're conservative:
   * - empty / null location → KEEP (LinkedIn often omits location for US jobs)
   * - explicit US markers → KEEP
   * - explicit non-US country markers → DROP
   *
   * Add new exclusions to NON_US_PATTERNS as they come up.
   */
  _filterToUS(jobs) {
    if (!Array.isArray(jobs)) return [];
    const NON_US_PATTERNS = [
      /\bunited kingdom\b/i, /\b(?:UK|U\.K\.)\b/, /\bengland\b/i, /\bscotland\b/i, /\bwales\b/i, /\bireland\b/i,
      /\bcanada\b/i, /\bontario\b/i, /\bquebec\b/i, /\bbritish columbia\b/i, /\balberta\b/i, /\btoronto\b/i, /\bvancouver\b/i, /\bmontreal\b/i,
      /\bindia\b/i, /\bbangalore\b/i, /\bhyderabad\b/i, /\bmumbai\b/i, /\bdelhi\b/i, /\bchennai\b/i, /\bpune\b/i, /\bkolkata\b/i, /\bgurgaon\b/i, /\bnoida\b/i,
      /\baustralia\b/i, /\bsydney\b/i, /\bmelbourne\b/i,
      /\bgermany\b/i, /\bfrance\b/i, /\bspain\b/i, /\bnetherlands\b/i, /\bsingapore\b/i, /\bphilippines\b/i, /\bmexico\b/i, /\bbrazil\b/i,
      /\bremote, eu\b/i, /\beurope\b/i, /\bemea\b/i, /\bapac\b/i, /\bdubai\b/i, /\buae\b/i,
    ];
    const US_PATTERNS = [
      /\bunited states\b/i, /\bU\.?S\.?A?\b/, /\bUSA\b/, /, US\b/i,
    ];
    return jobs.filter((j) => {
      const loc = (j.location || '').toString();
      if (!loc.trim()) return true;
      if (US_PATTERNS.some((re) => re.test(loc))) return true;
      if (NON_US_PATTERNS.some((re) => re.test(loc))) return false;
      // Ambiguous (e.g., "Remote") → keep
      return true;
    });
  }

  // ── Index bootstrap ─────────────────────────────────────────────────────

  async _ensureIndexes() {
    if (this._indexesEnsured) return;
    try {
      const db = database.getDb();

      // jobSearchCache: TTL on expiresAt, unique on filterHash
      await db.collection(COL_CACHE).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await db.collection(COL_CACHE).createIndex({ filterHash: 1 }, { unique: true });

      // jobSearchSessions: compound index for per-candidate listing
      await db.collection(COL_SESSIONS).createIndex({ candidateId: 1, requestedAt: -1 });

      // tailoredResumes: unique per (session, job)
      await db.collection(COL_TAILORED).createIndex({ sessionId: 1, jobId: 1 }, { unique: true });

      this._indexesEnsured = true;
      logger.debug('jobSearchService: MongoDB indexes ensured');
    } catch (err) {
      logger.warn('jobSearchService: index creation warning', { error: err.message });
    }
  }

  // ── Hash ────────────────────────────────────────────────────────────────

  /**
   * Produce a deterministic SHA-256 hash for a filters object.
   * Key order and string casing are normalised before hashing.
   */
  computeFilterHash(filters) {
    const normalised = this._normaliseFilters(filters);
    const json = JSON.stringify(normalised);
    return crypto.createHash('sha256').update(json).digest('hex');
  }

  _normaliseFilters(filters) {
    if (!filters || typeof filters !== 'object') return filters;
    return Object.keys(filters)
      .sort()
      .reduce((acc, key) => {
        const val = filters[key];
        acc[key] = typeof val === 'string' ? val.toLowerCase() : val;
        return acc;
      }, {});
  }

  // ── Cache / Scraper ──────────────────────────────────────────────────────

  /**
   * Return cached results if still within TTL, otherwise fetch from the
   * scraper service and persist the results.
   *
   * @param {object} filters
   * @param {{ candidateId: string, resumeUrl: string }} ctx
   */
  async getOrFetchListings(filters, ctx = {}) {
    await this._ensureIndexes();
    const db = database.getDb();
    const hash = this.computeFilterHash(filters);

    const cached = await db.collection(COL_CACHE).findOne({ filterHash: hash });
    if (cached && cached.expiresAt > new Date()) {
      logger.debug('jobSearchService: cache hit', { hash });
      return cached.results;
    }

    logger.debug('jobSearchService: cache miss, calling scraper', { hash });
    const rawResults = await this.callScraper({ candidateId: ctx.candidateId, resumeUrl: ctx.resumeUrl, filters });
    const results = this._filterToUS(rawResults);
    logger.debug('jobSearchService: US filter applied', { before: rawResults.length, after: results.length });

    const ttlHours = config.jobSearch.cacheTtlHours;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

    await db.collection(COL_CACHE).updateOne(
      { filterHash: hash },
      {
        $set: {
          filterHash: hash,
          filters,
          results,
          fetchedAt: now,
          expiresAt,
        },
      },
      { upsert: true }
    );

    return results;
  }

  /**
   * POST to the scraper service and return a normalised job array.
   */
  async callScraper({ candidateId, resumeUrl, filters }) {
    const url = config.scraperService.url + '/find-jobs';

    const body = {
      resume_url: resumeUrl,
      profile_id: candidateId,
      max_per_source: filters.max_per_source ?? filters.maxPerSource ?? 100,
      linkedin_only: filters.linkedin_only ?? true,
      multi_title: filters.multi_title ?? true,
      keyword: filters.keyword || null,
      location: filters.location || null,
      remote: filters.remote || 'remote',
      first_run: filters.firstRun || false,
    };

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.scraperService.timeoutMs),
      });
    } catch (err) {
      logger.error('scraper request failed (network/timeout)', { error: err.message });
      throw new Error(`scraper request failed: ${err.message}`);
    }

    if (!response.ok) {
      const text = await response.text();
      logger.error('scraper returned non-OK status', { status: response.status, body: text });
      throw new Error(`scraper ${response.status}: ${text.slice(0, 500)}`);
    }

    const json = await response.json();
    return this._normaliseJobs(json.result);
  }

  _normaliseJobs(rawResult) {
    const list = Array.isArray(rawResult) ? rawResult :
                 Array.isArray(rawResult?.samples) ? rawResult.samples :
                 Array.isArray(rawResult?.jobs) ? rawResult.jobs :
                 Array.isArray(rawResult?.results) ? rawResult.results :
                 [];
    return list.map((j, i) => ({
      id: j.url || j.id || `job-${i}`,
      title: j.title || '',
      company: j.company || '',
      location: j.location || null,
      remote_type: j.remote_type || (j.remote ? 'remote' : null),
      ats: j.ats || j.source || 'unknown',
      url: j.url || '',
      date_posted: j.date_posted || j.posted_at || null,
      snippet: j.snippet || j.description || '',
      skills: Array.isArray(j.skills) ? j.skills : [],
    }));
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  /**
   * Create a session row, kick off background search, return { sessionId }.
   */
  async startSearch({ candidateId, candidateName, filters, requestedBy }) {
    await this._ensureIndexes();
    const db = database.getDb();

    // Apply canonical defaults when no filters (or empty filters) are supplied.
    // User overrides (if any) win via the spread at the end.
    const canonicalFilters = {
      remote: 'remote',
      max_per_source: 100,
      linkedin_only: true,
      multi_title: true,
      ...filters,
    };
    filters = canonicalFilters;

    const filterHash = this.computeFilterHash(filters);
    const now = new Date();

    const doc = {
      candidateId,
      candidateName: candidateName || '',
      filterHash,
      filters,
      status: 'pending',
      requestedBy,
      requestedAt: now,
      completedAt: null,
      jobCount: null,
      error: null,
    };

    const result = await db.collection(COL_SESSIONS).insertOne(doc);
    const sessionId = result.insertedId.toString();

    this._emit('jobSearchStarted', { sessionId, candidateId, requestedBy });
    logger.info('jobSearchService: search started', { sessionId, candidateId });

    setImmediate(() => this._runSearch(sessionId));

    return { sessionId };
  }

  async _runSearch(sessionId) {
    const db = database.getDb();
    const _id = new ObjectId(sessionId);

    try {
      await db.collection(COL_SESSIONS).updateOne(
        { _id },
        { $set: { status: 'running' } }
      );

      const session = await db.collection(COL_SESSIONS).findOne({ _id });
      if (!session) throw new Error('Session not found');

      const candidateDoc = await db.collection('candidateDetails').findOne({ _id: new ObjectId(session.candidateId) });
      if (!candidateDoc?.resumeLink) {
        throw new Error('candidate has no resumeLink');
      }

      const results = await this.getOrFetchListings(session.filters, {
        candidateId: session.candidateId,
        resumeUrl: candidateDoc.resumeLink,
      });

      await db.collection(COL_SESSIONS).updateOne(
        { _id },
        {
          $set: {
            status: 'complete',
            completedAt: new Date(),
            jobCount: results.length,
          },
        }
      );

      this._emit('jobSearchComplete', { sessionId, candidateId: session.candidateId, jobCount: results.length });
      logger.info('jobSearchService: search complete', { sessionId, jobCount: results.length });
    } catch (err) {
      logger.error('jobSearchService: search error', { sessionId, error: err.message });
      await db.collection(COL_SESSIONS).updateOne(
        { _id },
        { $set: { status: 'error', completedAt: new Date(), error: err.message } }
      );
      const session = await db.collection(COL_SESSIONS).findOne({ _id });
      this._emit('jobSearchError', { sessionId, candidateId: session?.candidateId, error: err.message });
    }
  }

  async getSession(sessionId) {
    const db = database.getDb();
    const _id = new ObjectId(sessionId);

    const session = await db.collection(COL_SESSIONS).findOne({ _id });
    if (!session) return null;

    // Fetch cached results
    const cache = await db.collection(COL_CACHE).findOne({ filterHash: session.filterHash });

    // Fetch tailored resume statuses for this session
    const tailored = await db.collection(COL_TAILORED)
      .find({ sessionId })
      .project({ jobId: 1, status: 1, tailoredResumeUrl: 1, tailoredResumeText: 1, completedAt: 1 })
      .toArray();

    return {
      ...session,
      jobs: cache?.results || [],
      tailoredResumes: tailored,
    };
  }

  async listSessions({ candidateId, requestedBy, limit = 20, page = 1 }) {
    const db = database.getDb();
    const skip = (page - 1) * limit;

    // Filter precedence: candidateId > requestedBy > all
    const filter = candidateId ? { candidateId }
                 : requestedBy ? { requestedBy }
                 : {};

    const [sessions, total] = await Promise.all([
      db.collection(COL_SESSIONS)
        .find(filter)
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      db.collection(COL_SESSIONS).countDocuments(filter),
    ]);

    return { sessions, total, page, limit };
  }

  // ── Tailor ───────────────────────────────────────────────────────────────

  /**
   * Create a tailoredResumes row and kick off background tailoring.
   */
  async triggerTailor({ sessionId, jobId, requestedBy }) {
    await this._ensureIndexes();
    const db = database.getDb();

    const doc = {
      sessionId,
      jobId,
      candidateId: null, // filled in _runTailor
      status: 'pending',
      tailoredResumeUrl: null,
      tailoredResumeText: null,
      requestedBy,
      requestedAt: new Date(),
      completedAt: null,
      error: null,
      jobSnapshot: null,
    };

    const result = await db.collection(COL_TAILORED).insertOne(doc);
    const tailoredId = result.insertedId.toString();

    this._emit('tailorResumeStarted', { tailoredId, sessionId, jobId, requestedBy });
    logger.info('jobSearchService: tailor started', { tailoredId, sessionId, jobId });

    setImmediate(() => this._runTailor(tailoredId));

    return { tailoredId };
  }

  async _runTailor(tailoredId) {
    const db = database.getDb();
    const _id = new ObjectId(tailoredId);

    let tailoredDoc;
    try {
      tailoredDoc = await db.collection(COL_TAILORED).findOne({ _id });
      if (!tailoredDoc) throw new Error('Tailored document not found');

      const { sessionId, jobId } = tailoredDoc;

      // Load session
      const session = await db.collection(COL_SESSIONS).findOne({ _id: new ObjectId(sessionId) });
      if (!session) throw new Error('Session not found');

      const { candidateId, candidateName, filterHash } = session;

      // Load job from cache
      const cache = await db.collection(COL_CACHE).findOne({ filterHash });
      const job = (cache?.results || []).find((j) => j.url === jobId || j.url === jobId);
      if (!job) throw new Error(`Job not found in cache: ${jobId}`);

      // Load full candidate doc for forge-ai schema
      const candidateCol = database.getDb().collection('candidateDetails');
      const candidateDoc = await candidateCol.findOne({ _id: new ObjectId(candidateId) });

      // Build candidate object in the ResumeForge API schema.
      // Prefer a structured `forgeProfile` field on the candidate doc if available
      // (richer history). Otherwise fall back to a minimal stub built from
      // candidateDetails primitives — pipeline still works but bullets are sparse.
      const stored = candidateDoc?.forgeProfile;
      const fallbackTechs = String(candidateDoc?.Technology || '')
        .split(/[,;|/]/).map((s) => s.trim()).filter(Boolean);
      const candidateForge = stored && typeof stored === 'object' ? stored : {
        slug: String(candidateId),
        name: candidateDoc?.['Candidate Name'] || candidateName || '',
        location: candidateDoc?.Branch || '',
        contact: {
          email: candidateDoc?.['Email ID'] || '',
          phone: candidateDoc?.['Contact No'] || '',
          linkedin: candidateDoc?.linkedin || '',
        },
        education: [],
        companies: [
          {
            name: candidateDoc?.['End Client'] || 'Recent Employer',
            title: candidateDoc?.Technology ? `${candidateDoc.Technology} Engineer` : 'Software Engineer',
            industry: '',
            start: 'Jan 2024',
            end: 'Present',
            location: candidateDoc?.Branch || '',
            team_context: '',
            achievements: [
              `Working as a ${candidateDoc?.Technology || 'software'} engineer`,
            ],
          },
        ],
        baseline_skills: fallbackTechs.length ? fallbackTechs : ['Software Development'],
      };

      // Update candidateId in tailor row
      await db.collection(COL_TAILORED).updateOne(
        { _id },
        {
          $set: {
            candidateId,
            status: 'running',
            jobSnapshot: { title: job.title, company: job.company, url: job.url },
          },
        }
      );

      // Call resume tailor
      const tailorResult = await resumeTailorService.tailor({
        candidateId,
        candidate: candidateForge,
        jobTitle: job.title,
        company: job.company,
        jobDescription: job.snippet || '',
        jobUrl: job.url || '',
      });

      await db.collection(COL_TAILORED).updateOne(
        { _id },
        {
          $set: {
            status: 'complete',
            tailoredResumeUrl: tailorResult.tailoredResumeUrl || '',
            tailoredResumeText: tailorResult.tailoredResumeText,
            tailoredResumeJson: tailorResult.tailoredResumeJson,
            forgeMeta: tailorResult.meta || null,
            forgeValidation: tailorResult.validation || null,
            keywordCoverage: tailorResult.keywordCoverage || null,
            completedAt: new Date(),
          },
        }
      );

      this._emit('tailorResumeComplete', { tailoredId, sessionId, candidateId, tailoredResumeUrl });
      logger.info('jobSearchService: tailor complete', { tailoredId });
    } catch (err) {
      logger.error('jobSearchService: tailor error', { tailoredId, error: err.message });
      await db.collection(COL_TAILORED).updateOne(
        { _id },
        { $set: { status: 'error', completedAt: new Date(), error: err.message } }
      );
      this._emit('tailorResumeError', {
        tailoredId,
        sessionId: tailoredDoc?.sessionId,
        error: err.message,
      });
    }
  }

  async getTailored(tailoredId) {
    const db = database.getDb();
    return db.collection(COL_TAILORED).findOne({ _id: new ObjectId(tailoredId) });
  }
}

export const jobSearchService = new JobSearchService();
