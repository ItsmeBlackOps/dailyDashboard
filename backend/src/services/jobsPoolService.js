/**
 * Shared job-pool service.
 *
 * The dashboard owns a single `jobsPool` collection containing every
 * scraped + JD-enriched job posting. Per-candidate matching is a
 * Mongo lookup against this pool — no new Apify call per candidate.
 *
 * Schema (mongo collection: jobsPool):
 *   {
 *     _id: ObjectId,
 *     dedupeKey: string,           // sha1(company|title|postedAt)
 *     title: string,               // raw title from source
 *     normalizedTitle: string,     // lowercased, stripped of seniority
 *     normalizedTitles: string[],  // [normalizedTitle, ...JD-extracted titles, all lowercased]
 *     company: string,
 *     location: string|null,
 *     remote_type: 'remote'|'hybrid'|'onsite'|null,
 *     url: string,
 *     ats: string,
 *     postedAt: Date|null,
 *     snippet: string,             // ≤500 char job description excerpt
 *     fullDescription: string,     // optional, full JD text
 *     yearsOfExperience: number|null, // JD-extracted minimum YoE
 *     experienceBucket: '0-2'|'2-5'|'5-10'|'10+'|null, // bucket of yearsOfExperience
 *     extractedTitles: string[],   // raw output from gpt-4o-mini /enrich-jd
 *     sourceActor: string,         // Apify actor id
 *     sourceRunId: string,         // Apify run id
 *     importedAt: Date,
 *     postedAtTtl: Date,           // for TTL index — drops 30d after posting
 *   }
 *
 * Indexes:
 *   { dedupeKey: 1 } UNIQUE
 *   { normalizedTitles: 1, experienceBucket: 1 } compound
 *   { postedAtTtl: 1 } TTL 30 days (auto-prune stale postings)
 */
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const COL = 'jobsPool';
const LOG_COL = 'jobsPoolImportLog';   // marker: every Apify runId we've touched

// Cap pool retention. Set to null to keep forever.
const TTL_DAYS = parseInt(process.env.JOBS_POOL_TTL_DAYS || '30', 10);

// YoE matching tolerances. A 4yr candidate matches jobs requiring 2..5 yrs
// (LOWER_TOL=2 below years_min, UPPER_TOL=1 above years_max). Tunable via env.
const YOE_LOWER_TOL = parseInt(process.env.JOBS_POOL_YOE_LOWER_TOL || '2', 10);
const YOE_UPPER_TOL = parseInt(process.env.JOBS_POOL_YOE_UPPER_TOL || '1', 10);

let _indexEnsured = false;
async function ensureIndexes(db) {
  if (_indexEnsured) return;
  const col = db.collection(COL);
  await col.createIndex({ dedupeKey: 1 }, { unique: true, name: 'dedupeKey_unique' });
  await col.createIndex(
    { normalizedTitles: 1, experienceBucket: 1 },
    { name: 'titles_bucket' }
  );
  await col.createIndex(
    { postedAtTtl: 1 },
    { name: 'posted_ttl', expireAfterSeconds: TTL_DAYS * 24 * 60 * 60 }
  );
  await col.createIndex({ importedAt: -1 }, { name: 'imported_recent' });
  // US-only filter applied to almost every list query.
  await col.createIndex({ inUS: 1, postedAt: -1 }, { name: 'inUS_posted' });

  // Run-once marker. We write here AFTER each run is processed
  // (success / empty / error), so subsequent cycles skip the run
  // entirely — never re-fetch the dataset, never re-pay for JD enrich.
  const logCol = db.collection(LOG_COL);
  await logCol.createIndex({ runId: 1 }, { unique: true, name: 'runId_unique' });
  await logCol.createIndex({ processedAt: -1 }, { name: 'processed_recent' });
  _indexEnsured = true;
}

// ── Helpers ──────────────────────────────────────────────────────────

const SENIORITY_PREFIX = /^(senior|sr|jr|junior|lead|principal|staff|chief|head of|director of|vp of|associate)\s+/i;
const TITLE_NOISE = /\s*[\(\[](.*?)[\)\]]\s*/g; // e.g. "Data Engineer (Remote)"

/**
 * Normalize a job title to a comparable key:
 *   - strip leading seniority
 *   - drop parenthetical noise
 *   - collapse whitespace
 *   - lowercase
 */
export function normalizeTitle(title) {
  if (!title || typeof title !== 'string') return '';
  let t = title.replace(TITLE_NOISE, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(SENIORITY_PREFIX, '').trim();
  return t.toLowerCase();
}

/** Map years-of-experience integer to actor bucket. */
export function yearsToBucket(years) {
  if (years == null || Number.isNaN(years)) return null;
  const y = Number(years);
  if (y < 2)  return '0-2';
  if (y < 5)  return '2-5';
  if (y < 10) return '5-10';
  return '10+';
}

/** Buckets a candidate is targetable for, given their accept-floor → max range. */
export function candidateBuckets(yearsMin, yearsMax) {
  if (yearsMin == null && yearsMax == null) return [];
  const lo = Math.max(0, Number(yearsMin ?? 0));
  const hi = Math.max(lo, Number(yearsMax ?? lo));
  const buckets = [];
  if (lo < 2 && hi >= 0) buckets.push('0-2');
  if (lo < 5 && hi >= 2) buckets.push('2-5');
  if (lo < 10 && hi >= 5) buckets.push('5-10');
  if (hi >= 10) buckets.push('10+');
  return buckets;
}

// US-state shortlist for fast detection. Two-letter codes shown
// alongside the full name; matched as whole-word, case-insensitive.
const US_STATE_NAMES = [
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
  'delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa',
  'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan',
  'minnesota','mississippi','missouri','montana','nebraska','nevada',
  'new hampshire','new jersey','new mexico','new york','north carolina',
  'north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
  'south carolina','south dakota','tennessee','texas','utah','vermont',
  'virginia','washington','west virginia','wisconsin','wyoming','district of columbia',
];
const US_STATE_ABBR = new Set([
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky',
  'la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd',
  'oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy','dc',
]);

const NON_US_COUNTRY_TOKENS = [
  'india','malaysia','kuala lumpur','singapore','philippines','indonesia','vietnam',
  'thailand','china','japan','korea','taiwan','hong kong',
  'mexico','méxico','brazil','brasil','argentina','chile','colombia','costa rica','peru','uruguay',
  'romania','poland','germany','france','spain','italy','portugal','netherlands','belgium',
  'sweden','denmark','norway','finland','ireland','united kingdom','britain','england',
  'scotland','wales','austria','switzerland','czech','hungary','greece','turkey','ukraine',
  'russia','south africa','egypt','nigeria','kenya','morocco','israel','uae','saudi',
  'pakistan','bangladesh','sri lanka','nepal','australia','new zealand','canada',
  'remote-emea','remote emea','emea','apac','latam',
];

/**
 * Heuristic US-location detector. Returns true when the location string
 * (or raw `countries_derived` array) clearly indicates a US posting.
 * Conservative — when in doubt, returns true and lets the filter pass,
 * because the actor itself was configured to query US.
 *
 *   isUSLocation('San Francisco, CA, US')           → true
 *   isUSLocation('Kuala Lumpur, Malaysia')          → false
 *   isUSLocation('Mexico City, Mexico')             → false
 *   isUSLocation('Remote', { countries_derived: ['United States'] }) → true
 *   isUSLocation('Romania')                         → false
 *   isUSLocation('')                                → true (no signal)
 */
export function isUSLocation(location, raw = {}) {
  // Honor explicit countries_derived from the actor.
  const cd = raw?.countries_derived;
  if (Array.isArray(cd) && cd.length > 0) {
    return cd.some((c) => /\b(united\s*states|usa|u\.s\.|^us$)\b/i.test(String(c)));
  }

  const loc = (location || '').toString().toLowerCase();
  if (!loc) return true; // nothing to judge — accept (actor was US-only configured)

  // Negative signals beat ambiguous positives. A string like "Mexico
  // City, MX" must NOT pass just because "MX" almost looks like a US
  // 2-letter code, and "Toronto, ON, Canada" must not pass on "ON".
  for (const tok of NON_US_COUNTRY_TOKENS) if (loc.includes(tok)) return false;

  // Fast positive signals.
  if (/\b(united\s*states|u\.s\.a?\.?|usa)\b/.test(loc)) return true;
  // ", US" or "US," at word boundaries — exclude when "us" is inside a word.
  if (/\b(?:us|u\.s\.)\b/.test(loc)) return true;
  for (const s of US_STATE_NAMES) if (loc.includes(s)) return true;
  // Two-letter state code at end-ish: ", TX" or " TX," etc.
  const stateMatch = loc.match(/[,\s]+([a-z]{2})\b/);
  if (stateMatch && US_STATE_ABBR.has(stateMatch[1])) return true;

  // Pure "Remote" with no other signal — accept; actor-side filter
  // already ran. The candidate-side filter on remote_type can refine.
  if (/^remote$/i.test(loc.trim())) return true;
  return false;
}

export function dedupeKeyFor({ company, title, postedAt, url }) {
  const norm = (s) => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const datePart = postedAt
    ? new Date(postedAt).toISOString().slice(0, 10)
    : '';
  return crypto
    .createHash('sha1')
    .update(`${norm(company)}|${norm(title)}|${datePart}|${norm(url)}`)
    .digest('hex');
}

// In-process cache for the active-candidate snapshot used by listPool.
// Refreshed every CANDIDATE_SNAPSHOT_TTL_MS (default 60s). Eliminates
// hundreds of per-page-load Mongo round-trips against candidateDetails.
const CANDIDATE_SNAPSHOT_TTL_MS = parseInt(
  process.env.JOBS_POOL_CANDIDATE_SNAPSHOT_TTL_MS || '60000',
  10
);
let _candidateSnapshot = null;
let _candidateSnapshotAt = 0;

// ── Public surface ───────────────────────────────────────────────────

class JobsPoolService {
  /**
   * Pre-computed list of active candidates with derived forgeProfile.
   * Each entry: { id, name, titles: Set<string> as Array, buckets: string[] }
   *
   * Loaded once per TTL and reused across requests to make the
   * matching-candidate annotation in listPool() effectively free.
   */
  async _getActiveCandidateSnapshot(db) {
    const now = Date.now();
    if (_candidateSnapshot && now - _candidateSnapshotAt < CANDIDATE_SNAPSHOT_TTL_MS) {
      return _candidateSnapshot;
    }
    const docs = await db.collection('candidateDetails')
      .find(
        { status: 'Active', 'forgeProfile.titles.0': { $exists: true } },
        { projection: {
            'Candidate Name': 1,
            'forgeProfile.titles': 1,
            'forgeProfile.years_min': 1,
            'forgeProfile.years_max': 1,
            'Recruiter': 1,
            'recruiter': 1,
          } }
      )
      .toArray();
    _candidateSnapshot = docs.map((c) => {
      const fp = c.forgeProfile || {};
      const titles = Array.isArray(fp.titles)
        ? [...new Set(fp.titles.map(normalizeTitle).filter(Boolean))]
        : [];
      const recruiter = (c.Recruiter || c.recruiter || '').toString().trim().toLowerCase();
      return {
        id: c._id.toString(),
        name: c['Candidate Name'] || '',
        titles,
        buckets: candidateBuckets(fp.years_min, fp.years_max),
        recruiter,
      };
    });
    _candidateSnapshotAt = now;
    return _candidateSnapshot;
  }

  /** Force-clear the candidate snapshot. Call after a forgeProfile derive. */
  invalidateCandidateSnapshot() {
    _candidateSnapshot = null;
    _candidateSnapshotAt = 0;
  }

  /**
   * Bulk-upsert a batch of normalized jobs. Skips documents whose
   * dedupeKey already exists (idempotent). Returns counts.
   */
  async upsertBatch(jobs) {
    if (!Array.isArray(jobs) || jobs.length === 0) return { matched: 0, upserted: 0 };
    const db = database.getDb();
    await ensureIndexes(db);
    const col = db.collection(COL);

    const ops = jobs.map((j) => ({
      updateOne: {
        filter: { dedupeKey: j.dedupeKey },
        update: {
          $setOnInsert: {
            dedupeKey: j.dedupeKey,
            importedAt: new Date(),
          },
          $set: {
            title:             j.title || '',
            normalizedTitle:   j.normalizedTitle || normalizeTitle(j.title),
            normalizedTitles:  j.normalizedTitles || [normalizeTitle(j.title)].filter(Boolean),
            company:           j.company || '',
            location:          j.location || null,
            inUS:              typeof j.inUS === 'boolean' ? j.inUS : isUSLocation(j.location, j.raw || {}),
            remote_type:       j.remote_type || null,
            url:               j.url || '',
            ats:               j.ats || '',
            postedAt:          j.postedAt ? new Date(j.postedAt) : null,
            postedAtTtl:       j.postedAt ? new Date(j.postedAt) : new Date(),
            snippet:           (j.snippet || '').slice(0, 500),
            fullDescription:   (j.fullDescription || '').slice(0, 50000),
            yearsOfExperience: j.yearsOfExperience ?? null,
            experienceBucket:  j.experienceBucket || yearsToBucket(j.yearsOfExperience),
            extractedTitles:   Array.isArray(j.extractedTitles) ? j.extractedTitles.slice(0, 12) : [],
            sourceActor:       j.sourceActor || '',
            sourceRunId:       j.sourceRunId || '',
          },
        },
        upsert: true,
      },
    }));

    const r = await col.bulkWrite(ops, { ordered: false });
    return {
      matched:  r.matchedCount  || 0,
      upserted: r.upsertedCount || 0,
      modified: r.modifiedCount || 0,
    };
  }

  /**
   * Find pool jobs that match a candidate's forgeProfile.
   * @param {{ candidateId: string, limit?: number, offset?: number }} opts
   */
  async matchForCandidate({ candidateId, limit = 100, offset = 0 }) {
    const db = database.getDb();
    await ensureIndexes(db);

    if (!ObjectId.isValid(candidateId)) {
      throw new Error('Invalid candidateId');
    }
    const candDoc = await db.collection('candidateDetails').findOne(
      { _id: new ObjectId(candidateId) },
      { projection: { forgeProfile: 1, 'Candidate Name': 1 } }
    );
    if (!candDoc) throw new Error('Candidate not found');
    const fp = candDoc.forgeProfile || {};
    const titles = Array.isArray(fp.titles) ? fp.titles : [];
    const candNormTitles = [...new Set(titles.map(normalizeTitle).filter(Boolean))];
    const buckets = candidateBuckets(fp.years_min, fp.years_max);

    if (candNormTitles.length === 0) {
      return {
        candidateId,
        candidateName: candDoc['Candidate Name'] || '',
        forgeProfile: { titles, years_min: fp.years_min, years_max: fp.years_max },
        candidateBuckets: buckets,
        total: 0,
        jobs: [],
        message: 'Candidate has no derived titles in forgeProfile yet',
      };
    }

    const filter = { normalizedTitles: { $in: candNormTitles }, inUS: { $ne: false } };
    // YoE window match. A 4yr candidate should match jobs requiring ~2-5 yrs
    // and reject 6+. Bucket-overlap was too coarse — it let "5-10" jobs in
    // when the candidate's max sat near the boundary.
    //   window = [years_min - LOWER_TOL, years_max + UPPER_TOL]
    // LOWER_TOL=2 (overqualified is fine), UPPER_TOL=1 (one stretch year ok).
    const yMin = Math.max(0, (Number(fp.years_min ?? 0)) - YOE_LOWER_TOL);
    const yMax = (Number(fp.years_max ?? fp.years_min ?? 0)) + YOE_UPPER_TOL;
    filter.$or = [
      { yearsOfExperience: { $gte: yMin, $lte: yMax } },
      // Keep YoE-unknown jobs (JD-enrich gap) — UI can mark them "unverified".
      { yearsOfExperience: null },
      { yearsOfExperience: { $exists: false } },
    ];

    const total = await db.collection(COL).countDocuments(filter);
    const docs = await db
      .collection(COL)
      .find(filter)
      .sort({ postedAt: -1, importedAt: -1 })
      .skip(Math.max(0, offset))
      .limit(Math.max(1, Math.min(500, limit)))
      .toArray();

    return {
      candidateId,
      candidateName: candDoc['Candidate Name'] || '',
      forgeProfile: { titles, years_min: fp.years_min, years_max: fp.years_max },
      candidateBuckets: buckets,
      total,
      jobs: docs.map((d) => ({
        id:               d._id.toString(),
        title:            d.title,
        company:          d.company,
        location:         d.location,
        remote_type:      d.remote_type,
        url:              d.url,
        ats:              d.ats,
        postedAt:         d.postedAt,
        snippet:          d.snippet,
        yearsOfExperience: d.yearsOfExperience,
        experienceBucket:  d.experienceBucket,
        extractedTitles:   d.extractedTitles,
      })),
    };
  }

  /**
   * High-water mark for incremental imports. Returns the most-recent
   * `postedAt` we've stored in the pool, or null if pool is empty.
   *
   * Used by the importer's per-item filter:
   *   for each Apify dataset item, skip if item.postedAt <= highWaterMark
   *
   * That's how we go hourly without re-enriching jobs we already
   * have — even when the same Apify run is returned in a fresh list
   * call, only postings newer than this cutoff trigger a JD-enrich
   * + upsert.
   */
  async getHighWaterMark() {
    const db = database.getDb();
    await ensureIndexes(db);
    const top = await db
      .collection(COL)
      .find({ postedAt: { $type: 'date' } })
      .sort({ postedAt: -1 })
      .limit(1)
      .project({ postedAt: 1, _id: 0 })
      .toArray();
    return top[0]?.postedAt || null;
  }

  /**
   * Return the set of Apify runIds we've ALREADY processed (any
   * outcome: imported, empty, error). The importer uses this to
   * skip already-touched runs in O(1) lookup.
   */
  async getProcessedRunIds() {
    const db = database.getDb();
    await ensureIndexes(db);
    const ids = await db
      .collection(LOG_COL)
      .find({}, { projection: { runId: 1, _id: 0 } })
      .toArray();
    return new Set(ids.map((r) => r.runId));
  }

  /**
   * Record that we processed an Apify run, even if zero items landed
   * in the pool. Idempotent on runId. Called once per run by the
   * importer — guarantees once-per-run semantics regardless of how
   * many items succeeded the dedupeKey check.
   *
   * @param {{ runId, actId, status, datasetId, itemsTotal, itemsAdapted, itemsNew, itemsUpserted, error? }} stats
   */
  async markRunProcessed(stats) {
    if (!stats?.runId) throw new Error('runId is required');
    const db = database.getDb();
    await ensureIndexes(db);
    await db.collection(LOG_COL).updateOne(
      { runId: stats.runId },
      {
        $setOnInsert: {
          runId:        stats.runId,
          processedAt:  new Date(),
        },
        $set: {
          actId:         stats.actId          || '',
          status:        stats.status         || 'imported',
          datasetId:     stats.datasetId      || '',
          itemsTotal:    stats.itemsTotal     || 0,
          itemsAdapted:  stats.itemsAdapted   || 0,
          itemsNew:      stats.itemsNew       || 0,
          itemsUpserted: stats.itemsUpserted  || 0,
          error:         stats.error          || null,
          updatedAt:     new Date(),
        },
      },
      { upsert: true }
    );
  }

  /**
   * List pool jobs for the global Jobs tab, with optional candidate
   * filter ("only show jobs matching this candidate") and a free-text
   * search over title/company.
   *
   * Each returned job is annotated with `matchingCandidates` —
   * candidate name + id pairs whose forgeProfile titles + bucket
   * overlap with this job. Capped at 5 per job for UI badge density.
   *
   * @param {{
   *   candidateId?: string,   // optional — filter to this candidate's matches only
   *   query?: string,         // optional — case-insensitive title/company substring
   *   limit?: number,
   *   offset?: number,
   * }} opts
   */
  async listPool({ candidateId, query, limit = 50, offset = 0, scopeRecruiterEmails = null } = {}) {
    const db = database.getDb();
    await ensureIndexes(db);
    const col = db.collection(COL);

    // US-only by default. Docs without inUS are treated as US (legacy
    // pre-backfill); docs explicitly marked inUS:false are excluded.
    const filter = { inUS: { $ne: false } };

    // Candidate-scoped: AND with matchForCandidate's filter shape.
    let candDoc = null;
    if (candidateId && ObjectId.isValid(candidateId)) {
      candDoc = await db.collection('candidateDetails').findOne(
        { _id: new ObjectId(candidateId) },
        { projection: { forgeProfile: 1, 'Candidate Name': 1 } }
      );
      if (candDoc?.forgeProfile?.titles) {
        const candTitles = [...new Set(candDoc.forgeProfile.titles.map(normalizeTitle).filter(Boolean))];
        if (candTitles.length > 0) {
          filter.normalizedTitles = { $in: candTitles };
          // YoE window — same rule as matchForCandidate.
          const fp = candDoc.forgeProfile;
          const yMin = Math.max(0, (Number(fp.years_min ?? 0)) - YOE_LOWER_TOL);
          const yMax = (Number(fp.years_max ?? fp.years_min ?? 0)) + YOE_UPPER_TOL;
          filter.$or = [
            { yearsOfExperience: { $gte: yMin, $lte: yMax } },
            { yearsOfExperience: null },
            { yearsOfExperience: { $exists: false } },
          ];
        }
      }
    }

    if (query && query.trim()) {
      const esc = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$and = [
        ...(filter.$and || []),
        { $or: [
          { title:   { $regex: esc, $options: 'i' } },
          { company: { $regex: esc, $options: 'i' } },
        ] },
      ];
    }

    // Load the active-candidate snapshot first so we can both:
    //  (a) pre-filter the Mongo query to only jobs with at least one
    //      title overlap with a SCOPED candidate (otherwise we'd return
    //      jobs nobody in the user's hierarchy can match), and
    //  (b) reuse it for the matching-candidate annotation below.
    const candSnapshot = await this._getActiveCandidateSnapshot(db);

    // Scope to recruiters the requesting user is allowed to see.
    // `null` means no scope (admin / global view).
    const scopedSnap = scopeRecruiterEmails
      ? candSnapshot.filter((c) => c.recruiter && scopeRecruiterEmails.has(c.recruiter))
      : candSnapshot;

    // When the caller hasn't pinned to a single candidate, restrict the
    // job query to jobs whose normalizedTitles overlap ANY scoped
    // candidate's titles. This is what makes "All my candidates"
    // actually mean "jobs that could match someone I work with".
    if (!candidateId && !filter.normalizedTitles) {
      const scopeTitles = new Set();
      for (const c of scopedSnap) for (const t of c.titles) scopeTitles.add(t);
      if (scopeTitles.size === 0) {
        // No candidates → no jobs in scope. Short-circuit.
        return {
          total: 0, limit, offset,
          candidateId: null, candidateName: null, jobs: [],
        };
      }
      filter.normalizedTitles = { $in: [...scopeTitles] };
    }

    // Run total + page query in parallel.
    const [total, docs] = await Promise.all([
      col.countDocuments(filter),
      col
        .find(filter)
        .sort({ postedAt: -1, importedAt: -1 })
        .skip(Math.max(0, offset))
        .limit(Math.max(1, Math.min(200, limit)))
        .toArray(),
    ]);

    // In-memory match: O(jobs × candidates) with cheap Set/Array ops.
    // For 100 jobs × 200 candidates = ~20k iterations — milliseconds.
    for (const d of docs) {
      const jobTitles = Array.isArray(d.normalizedTitles) && d.normalizedTitles.length > 0
        ? new Set(d.normalizedTitles)
        : null;
      if (!jobTitles) {
        d.matchingCandidates = [];
        d.matchingCandidateCount = 0;
        continue;
      }
      const matched = [];
      for (const c of scopedSnap) {
        // Title overlap: any candidate-title contained in jobTitles.
        let titleHit = false;
        for (const t of c.titles) {
          if (jobTitles.has(t)) { titleHit = true; break; }
        }
        if (!titleHit) continue;
        // Bucket alignment.
        if (
          d.experienceBucket == null
          || c.buckets.length === 0
          || c.buckets.includes(d.experienceBucket)
        ) {
          matched.push({ id: c.id, name: c.name });
          if (matched.length >= 50) break;
        }
      }
      d.matchingCandidates = matched.slice(0, 5);
      d.matchingCandidateCount = matched.length;
    }

    // Annotate each (job, candidate) pair with its apply state so the
    // UI can render a per-candidate chip ("Apply" / "Applied" /
    // "Interview" / etc.) without an N+1 follow-up call. One batch query
    // covers every visible (jobId, candidateId) tuple.
    const pairs = [];
    for (const d of docs) {
      const jobIdStr = d._id.toString();
      for (const m of d.matchingCandidates) {
        pairs.push({ jobId: jobIdStr, candidateId: String(m.id) });
      }
    }
    if (pairs.length > 0) {
      const apps = await db.collection('jobApplications')
        .find({ $or: pairs })
        .project({ jobId: 1, candidateId: 1, status: 1, _id: 0 })
        .toArray();
      const byKey = new Map();
      for (const a of apps) byKey.set(`${a.jobId}|${a.candidateId}`, a.status || 'applied');
      for (const d of docs) {
        const jobIdStr = d._id.toString();
        for (const m of d.matchingCandidates) {
          const status = byKey.get(`${jobIdStr}|${m.id}`) || null;
          m.applied = !!status;
          m.applicationStatus = status;
        }
      }
    } else {
      for (const d of docs) {
        for (const m of d.matchingCandidates) {
          m.applied = false;
          m.applicationStatus = null;
        }
      }
    }

    // Defense layer: when scoped to a recruiter hierarchy AND no
    // candidate is pinned, drop any job whose post-annotation match
    // count is zero. The Mongo pre-filter already does the bulk of
    // this via title overlap, but bucket alignment can still leave
    // a stray job with no in-scope candidates — hide those rather
    // than show a job no candidate of mine could be matched against.
    let visibleDocs = docs;
    if (scopeRecruiterEmails && !candidateId) {
      visibleDocs = docs.filter((d) => (d.matchingCandidateCount || 0) > 0);
    }

    return {
      total: scopeRecruiterEmails && !candidateId ? visibleDocs.length : total,
      limit,
      offset,
      candidateId: candidateId || null,
      candidateName: candDoc?.['Candidate Name'] || null,
      jobs: visibleDocs.map((d) => ({
        id: d._id.toString(),
        title: d.title,
        company: d.company,
        location: d.location,
        remote_type: d.remote_type,
        url: d.url,
        ats: d.ats,
        postedAt: d.postedAt,
        snippet: d.snippet,
        yearsOfExperience: d.yearsOfExperience,
        experienceBucket: d.experienceBucket,
        extractedTitles: d.extractedTitles,
        matchingCandidates: d.matchingCandidates || [],
        matchingCandidateCount: d.matchingCandidateCount || 0,
      })),
    };
  }

  /**
   * One-shot cleanup: drop pool docs whose location clearly isn't
   * US. Used after the US filter was added — runs once to purge
   * the historical pool of foreign postings.
   *
   * Returns counts. SAFE to call multiple times (no-op once clean).
   */
  async pruneNonUS({ dryRun = false, deleteNonUS = true } = {}) {
    const db = database.getDb();
    await ensureIndexes(db);
    const col = db.collection(COL);
    const cursor = col.find({}, { projection: { _id: 1, location: 1, inUS: 1 } });
    const toDelete = [];
    const toMarkUS = [];     // currently inUS!=true but heuristic says US — backfill
    const toMarkNonUS = [];  // currently inUS!=false but heuristic says non-US (kept if !deleteNonUS)
    for await (const d of cursor) {
      const us = isUSLocation(d.location, {});
      if (us) {
        if (d.inUS !== true) toMarkUS.push(d._id);
      } else {
        if (deleteNonUS) toDelete.push(d._id);
        else if (d.inUS !== false) toMarkNonUS.push(d._id);
      }
    }
    if (dryRun) {
      return {
        wouldDelete: toDelete.length,
        wouldMarkUS: toMarkUS.length,
        wouldMarkNonUS: toMarkNonUS.length,
      };
    }
    let deleted = 0;
    if (toDelete.length > 0) {
      const r = await col.deleteMany({ _id: { $in: toDelete } });
      deleted = r.deletedCount || 0;
    }
    if (toMarkUS.length > 0) {
      await col.updateMany({ _id: { $in: toMarkUS } }, { $set: { inUS: true } });
    }
    if (toMarkNonUS.length > 0) {
      await col.updateMany({ _id: { $in: toMarkNonUS } }, { $set: { inUS: false } });
    }
    return {
      deleted,
      backfilledUS: toMarkUS.length,
      backfilledNonUS: toMarkNonUS.length,
    };
  }

  /** High-level stats for /api/jobs/pool/stats */
  async stats() {
    const db = database.getDb();
    await ensureIndexes(db);
    const col = db.collection(COL);
    const [total, byBucket, lastImport] = await Promise.all([
      col.countDocuments({}),
      col.aggregate([{ $group: { _id: '$experienceBucket', n: { $sum: 1 } } }]).toArray(),
      col.find({}).sort({ importedAt: -1 }).limit(1).project({ importedAt: 1 }).toArray(),
    ]);
    return {
      total,
      byBucket: byBucket.reduce((acc, r) => ({ ...acc, [r._id || 'unbucketed']: r.n }), {}),
      lastImportAt: lastImport[0]?.importedAt || null,
    };
  }
}

export const jobsPoolService = new JobsPoolService();
