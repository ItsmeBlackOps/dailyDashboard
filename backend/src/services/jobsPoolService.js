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

// Cap pool retention. Set to null to keep forever.
const TTL_DAYS = parseInt(process.env.JOBS_POOL_TTL_DAYS || '30', 10);

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

// ── Public surface ───────────────────────────────────────────────────

class JobsPoolService {
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

    const filter = { normalizedTitles: { $in: candNormTitles } };
    if (buckets.length > 0) {
      // Match jobs in candidate's bucket range OR jobs without a bucket
      // (so JD-enrich gaps don't permanently hide otherwise-good matches).
      filter.$or = [
        { experienceBucket: { $in: buckets } },
        { experienceBucket: null },
        { experienceBucket: { $exists: false } },
      ];
    }

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
