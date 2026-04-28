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

  // ── Cache / Apify ────────────────────────────────────────────────────────

  /**
   * Return cached results if still within TTL, otherwise fetch from Apify
   * and persist the results.
   */
  async getOrFetchListings(filters) {
    await this._ensureIndexes();
    const db = database.getDb();
    const hash = this.computeFilterHash(filters);

    const cached = await db.collection(COL_CACHE).findOne({ filterHash: hash });
    if (cached && cached.expiresAt > new Date()) {
      logger.debug('jobSearchService: cache hit', { hash });
      return cached.results;
    }

    logger.debug('jobSearchService: cache miss, calling Apify', { hash });
    const results = await this.callApify(filters);

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
   * POST to Apify's run-sync-get-dataset-items endpoint and return the
   * normalised job array.
   */
  async callApify(filters) {
    const { token, baseUrl, jobsActor, timeoutMs } = config.apify;

    const actor = encodeURIComponent(jobsActor);
    const url = `${baseUrl}/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}`;

    const body = this._buildApifyBody(filters);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      logger.error('Apify request failed (network/timeout)', { error: err.message });
      throw new Error(`Apify request failed: ${err.message}`);
    }

    const text = await response.text();
    let items;
    try {
      items = text ? JSON.parse(text) : [];
    } catch {
      items = [];
    }

    if (!response.ok) {
      logger.error('Apify returned non-OK status', { status: response.status, body: text });
      throw new Error(`Apify error ${response.status}`);
    }

    if (!Array.isArray(items)) {
      logger.warn('Apify response was not an array', { type: typeof items });
      return [];
    }

    return items.map((item) => ({
      title: item.title || '',
      company: item.company || '',
      location: item.location || null,
      remote_type: item.remote_type || null,
      ats: item.ats || null,
      url: item.url || '',
      date_posted: item.date_posted || null,
      skills: Array.isArray(item.skills) ? item.skills : [],
      snippet: item.snippet || '',
    }));
  }

  _buildApifyBody(filters) {
    const body = {};
    if (filters.keyword) body.keyword = filters.keyword;
    if (filters.location) body.location = filters.location;
    if (filters.remote !== undefined) body.remote = filters.remote;
    if (filters.page_count !== undefined) body.page_count = filters.page_count;
    // Pass any extra filter keys through unchanged
    const known = new Set(['keyword', 'location', 'remote', 'page_count']);
    for (const [k, v] of Object.entries(filters)) {
      if (!known.has(k)) body[k] = v;
    }
    return body;
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  /**
   * Create a session row, kick off background search, return { sessionId }.
   */
  async startSearch({ candidateId, candidateName, filters, requestedBy }) {
    await this._ensureIndexes();
    const db = database.getDb();

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

      const results = await this.getOrFetchListings(session.filters);

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

  async listSessions({ candidateId, limit = 20, page = 1 }) {
    const db = database.getDb();
    const skip = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      db.collection(COL_SESSIONS)
        .find({ candidateId })
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      db.collection(COL_SESSIONS).countDocuments({ candidateId }),
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

      // Load candidate resume link
      const candidateCol = database.getDb().collection('candidateDetails');
      const candidate = await candidateCol.findOne(
        { _id: new ObjectId(candidateId) },
        { projection: { resumeLink: 1 } }
      );
      const resumeUrl = candidate?.resumeLink || '';

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
      const { tailoredResumeUrl, tailoredResumeText } = await resumeTailorService.tailor({
        candidateId,
        candidateName,
        resumeUrl,
        jobDescription: job.snippet || '',
        jobTitle: job.title,
        company: job.company,
        location: job.location || '',
      });

      await db.collection(COL_TAILORED).updateOne(
        { _id },
        {
          $set: {
            status: 'complete',
            tailoredResumeUrl,
            tailoredResumeText,
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
