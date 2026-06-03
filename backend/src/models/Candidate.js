import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const DEFAULT_PROJECTION = {
  _id: 1,
  Branch: 1,
  Recruiter: 1,
  Expert: 1,
  Technology: 1,
  'Candidate Name': 1,
  'Email ID': 1,
  'Contact No': 1,
  _last_write: 1,
  updated_at: 1,
  'Date of Interview': 1,
  source: 1,
  workflowStatus: 1,
  resumeUnderstandingStatus: 1,
  createdBy: 1,
  metadata: 1,
  resumeLink: 1,
  docType: 1,
  status: 1,
  poDate: 1,
  statusHistory: 1,
  // PRT fields — needed so formatCandidateRecord can derive
  // expiringInDays / daysInMarketing on the fly. Non-marketing
  // readers are stripped server-side via _applyPrtVisibility.
  teamLead: 1,
  experienceYears: 1,
  visaType: 1,
  eadStartDate: 1,
  eadEndDate: 1,
  company: 1,
  city: 1,
  state: 1,
  ackEmail: 1,
  ackEmailAt: 1,
  team: 1,
  marketingStartDate: 1,
  attachments: 1,
  expiringInDays: 1,
  daysInMarketing: 1
};

// Lean projection for LIST views (getCandidatesByBranch / getAllCandidates /
// getCandidatesByRecruiters / getCandidatesByExperts). Drops the heavy fields
// the candidate table never renders: the raw email `source` blob, profile
// `metadata`, the full `statusHistory` array, and the `attachments` array.
// formatCandidateRecord defaults `attachments` to [] and surfaces nothing
// derived from the other three, so list rows are unchanged on the wire apart
// from the omitted bulk. Single-record reads (getCandidateById /
// getCandidateByEmail) keep DEFAULT_PROJECTION so the detail page still gets
// the full document. Derived only from DEFAULT_PROJECTION so it tracks any
// future field additions automatically.
const LIST_PROJECTION = (() => {
  const projection = { ...DEFAULT_PROJECTION };
  delete projection.source;
  delete projection.metadata;
  delete projection.statusHistory;
  delete projection.attachments;
  return projection;
})();

// Sort modes accepted by getCandidatesByBranch / getAllCandidates /
// getCandidatesByRecruiters. Default keeps the historical "most recently
// touched first" behaviour. `expiringIn` sorts ascending so the soonest
// expiry surfaces at the top; candidates without an EAD end-date sink
// to the bottom because Mongo treats missing values as the smallest
// possible — we counter that by sorting on eadEndDate ASC with a
// `_last_write` tiebreaker, which puts nulls last when paired with
// `nullsLast` semantics enforced in the service layer (see
// candidateService.buildSortStage).
const SORT_PRESETS = {
  updated: { _last_write: -1 },
  name: { 'Candidate Name': 1, _last_write: -1 },
  expiringIn: { eadEndDate: 1, _last_write: -1 }
};
const DEFAULT_SORT_KEY = 'updated';

function resolveSort(sortKey) {
  if (typeof sortKey === 'string' && Object.prototype.hasOwnProperty.call(SORT_PRESETS, sortKey)) {
    return SORT_PRESETS[sortKey];
  }
  return SORT_PRESETS[DEFAULT_SORT_KEY];
}

function buildSearchFilter(search) {
  if (!search) return null;
  // Apply the regex to Candidate Name, Email ID and Recruiter so the
  // single search box can find rows by any of the three. Each is
  // case-insensitive; the caller pre-escapes the pattern.
  return {
    $or: [
      { 'Candidate Name': { $regex: search, $options: 'i' } },
      { 'Email ID': { $regex: search, $options: 'i' } },
      { Recruiter: { $regex: search, $options: 'i' } }
    ]
  };
}

export const WORKFLOW_STATUS = {
  awaitingExpert: 'awaiting_expert',
  needsResumeUnderstanding: 'needs_resume_understanding',
  completed: 'completed'
};

export const RESUME_UNDERSTANDING_STATUS = {
  pending: 'pending',
  done: 'done'
};

// ---------------------------------------------------------------------------
// PRT (Placement & Recruiter Tracker) — Section 4 enums.
// `Placement Offer` is kept as the canonical DB value; PRD's term `PO`
// is normalised to `Placement Offer` server-side (see candidateService
// `sanitizeCandidatePayload`). UI may render either label.
// ---------------------------------------------------------------------------

export const STATUS_VALUES = [
  'Active',
  'Low Priority',
  'Temp. Hold',
  'Hold',
  'New',
  'Placement Offer',
  'Backout'
];

// Display-synonym → canonical DB value.
export const STATUS_ALIASES = new Map([
  ['po', 'Placement Offer']
]);

export const TECHNOLOGY_VALUES = [
  'Product Manager',
  'Project Manager',
  'Software Developer',
  'Data Engineer',
  'Data Analyst',
  'Business Analyst',
  'Network Engineer',
  'Cyber Security Analyst',
  'DevOps Engineer',
  'Product Designer',
  'Financial Analyst',
  'Mechanical Engineer',
  'QA Automation Engineer',
  'SQL DBA',
  'Cloud Engineer',
  'Data Scientist',
  'Salesforce Developer',
  'BI Engineer',
  'Non IT',
  'AI ML Engineer'
];

export const VISA_TYPE_VALUES = [
  'OPT',
  'L2',
  'Green Card',
  'STEM OPT',
  'USC',
  'H4-EAD',
  'PR',
  'CPT',
  'H1B',
  'Day 1 CPT',
  'Asylum'
];

// Visa types where the candidate carries an EAD card with a start/end date —
// the PRT form requires EAD Start (and therefore EAD End) when the candidate
// holds any of these.
export const EAD_REQUIRED_VISA_TYPES = new Set([
  'OPT',
  'STEM OPT',
  'CPT',
  'Day 1 CPT',
  'H4-EAD',
  'L2'
]);

export const COMPANY_VALUES = ['SST', 'VCS', 'FED'];

// SP1 — a candidate "needs marketing info" when Visa Type or Company is
// blank, or when its visa carries an EAD card (EAD_REQUIRED_VISA_TYPES) but
// the EAD start/end dates are blank. This is the single source of truth for
// the DB-side worklist query; the in-memory equivalent lives in
// candidateService.missingMarketingFields (kept in lock-step).
export function marketingInfoMissingFilter() {
  const eadTypes = Array.from(EAD_REQUIRED_VISA_TYPES);
  const blank = (field) => ([
    { [field]: { $in: [null, ''] } },
    { [field]: { $exists: false } },
  ]);
  return {
    $or: [
      ...blank('visaType'),
      ...blank('company'),
      {
        $and: [
          { visaType: { $in: eadTypes } },
          { $or: [...blank('eadStartDate'), ...blank('eadEndDate')] },
        ],
      },
    ],
  };
}

export const ACK_EMAIL_VALUES = ['Sent', 'Confirmed', 'Pending'];

// Fields whose value changes are recorded in `editHistory[]` on every
// update. Mirrors the User.AUDITED pattern in `backend/src/models/User.js`.
export const CANDIDATE_AUDITED = [
  'status',
  'recruiter',
  'expert',
  'teamLead',
  'branch',
  'visaType',
  'eadStartDate',
  'eadEndDate',
  'company',
  'ackEmail',
  'experienceYears',
  'technology',
  'team'
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class CandidateModel {
  constructor() {
    this.collection = null;
  }

  async initialize() {
    this.collection = database.getCollection('candidateDetails');

    // Create indexes for efficient querying
    try {
      await Promise.all([
        this.collection.createIndex({ Recruiter: 1 }),
        this.collection.createIndex({ Expert: 1 }),
        this.collection.createIndex({ workflowStatus: 1 }),
        this.collection.createIndex({ resumeUnderstandingStatus: 1 }),
        this.collection.createIndex({ 'Candidate Name': 1 })
      ]);
      logger.info('CandidateModel initialized and indexes verified');
    } catch (error) {
      logger.error('Failed to create indexes for CandidateModel', { error: error.message });
    }
  }

  async getCandidatesByBranch(branch, { limit, search, sort } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    const query = { Branch: branch, docType: { $in: [null, 'candidate'] } };
    const searchFilter = buildSearchFilter(search);
    if (searchFilter) {
      Object.assign(query, searchFilter);
    }

    let cursor = this.collection
      .find(query, { projection: LIST_PROJECTION })
      .sort(resolveSort(sort));

    if (Number.isFinite(limit) && limit > 0) {
      cursor = cursor.limit(Math.floor(limit));
    }

    const documents = await cursor.toArray();

    return documents.map((doc) => this.mapDocumentToCandidate(doc));
  }

  async getAllCandidates({ limit, search, sort } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    const query = { docType: { $in: [null, 'candidate'] } };
    const searchFilter = buildSearchFilter(search);
    if (searchFilter) {
      Object.assign(query, searchFilter);
    }

    let cursor = this.collection
      .find(query, { projection: LIST_PROJECTION })
      .sort(resolveSort(sort));

    if (Number.isFinite(limit) && limit > 0) {
      cursor = cursor.limit(Math.floor(limit));
    }

    const documents = await cursor.toArray();

    return documents.map((doc) => this.mapDocumentToCandidate(doc));
  }

  // Shared recruiter-scope Mongo filter builder. Returns the query object, or
  // null when the scope resolves to nothing (no emails / no matchers) so
  // callers can short-circuit to []/0. Both getCandidatesByRecruiters (fetch)
  // and countCandidatesByRecruiters (count) build their filter here, so a
  // count can never drift from the list it is counting.
  _buildRecruiterScopeQuery(recruiterEmails, { search, visibility, workflowStatus, resumeUnderstandingStatus } = {}) {
    if (!Array.isArray(recruiterEmails) || recruiterEmails.length === 0) {
      return null;
    }

    const recruiterMatchers = new Set(
      recruiterEmails
        .map((email) => (typeof email === 'string' ? email : ''))
        .filter(Boolean)
    );

    const aliasList = Array.isArray(visibility?.recruiterAliases)
      ? visibility.recruiterAliases.filter(Boolean)
      : [];

    for (const alias of aliasList) {
      recruiterMatchers.add(alias);
    }

    const senderPatterns = Array.isArray(visibility?.senderPatterns)
      ? visibility.senderPatterns.filter(Boolean)
      : [];

    const ccPatterns = Array.isArray(visibility?.ccPatterns)
      ? visibility.ccPatterns.filter(Boolean)
      : [];

    const orConditions = [];

    for (const matcher of recruiterMatchers) {
      orConditions.push({
        Recruiter: { $regex: `^${escapeRegex(matcher)}$`, $options: 'i' }
      });
    }

    const senderFields = ['source.sender', 'source.headers.From'];
    for (const pattern of senderPatterns) {
      for (const field of senderFields) {
        orConditions.push({ [field]: { $regex: pattern, $options: 'i' } });
      }
    }

    const ccFields = ['source.cc', 'source.headers.Cc'];
    for (const pattern of ccPatterns) {
      for (const field of ccFields) {
        orConditions.push({ [field]: { $regex: pattern, $options: 'i' } });
      }
    }

    if (orConditions.length === 0) {
      return null;
    }

    const query = {
      $or: orConditions,
      docType: { $in: [null, 'candidate'] }
    };

    if (workflowStatus) {
      query.workflowStatus = Array.isArray(workflowStatus) ? { $in: workflowStatus } : workflowStatus;
    }

    if (resumeUnderstandingStatus) {
      query.resumeUnderstandingStatus = resumeUnderstandingStatus;
    }

    // Combine the recruiter-scope OR with the search OR via $and so a
    // search box matches across name/email/recruiter without breaking
    // recruiter visibility.
    const searchFilter = buildSearchFilter(search);
    if (searchFilter) {
      query.$and = [{ $or: query.$or }, searchFilter];
      delete query.$or;
    }

    return query;
  }

  async getCandidatesByRecruiters(recruiterEmails, { limit, search, sort, visibility, workflowStatus, resumeUnderstandingStatus } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    const query = this._buildRecruiterScopeQuery(recruiterEmails, {
      search,
      visibility,
      workflowStatus,
      resumeUnderstandingStatus
    });
    if (!query) {
      return [];
    }

    let cursor = this.collection
      .find(query, { projection: LIST_PROJECTION })
      .sort(resolveSort(sort));

    if (Number.isFinite(limit) && limit > 0) {
      cursor = cursor.limit(Math.floor(limit));
    }

    const documents = await cursor.toArray();

    return documents.map((doc) => this.mapDocumentToCandidate(doc));
  }

  async updateCandidateById(id, updates = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!id) {
      throw new Error('Candidate id is required');
    }

    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch (error) {
      const invalidIdError = new Error('Invalid candidate id');
      invalidIdError.statusCode = 400;
      throw invalidIdError;
    }

    const filter = {
      _id: objectId,
      docType: { $in: [null, 'candidate'] }
    };

    const changedBy = updates._changedBy;
    const now = new Date();

    // Read prior state when status is changing — needed to record `from`
    // in the rich statusHistory entry. One extra read per status change
    // is cheap; skipped entirely when status isn't being modified.
    let priorStatus = null;
    if (updates.status !== undefined) {
      const prior = await this.collection.findOne(filter, { projection: { status: 1 } });
      priorStatus = prior?.status ?? null;
    }

    const updateDoc = {
      $set: {
        ...(updates.name !== undefined ? { 'Candidate Name': updates.name } : {}),
        ...(updates.email !== undefined ? { 'Email ID': updates.email } : {}),
        ...(updates.technology !== undefined ? { Technology: updates.technology } : {}),
        ...(updates.branch !== undefined ? { Branch: updates.branch } : {}),
        ...(updates.recruiter !== undefined ? { Recruiter: updates.recruiter } : {}),
        ...(updates.expert !== undefined ? { Expert: updates.expert } : {}),
        ...(updates.contact !== undefined ? { 'Contact No': updates.contact } : {}),
        ...(updates.workflowStatus !== undefined ? { workflowStatus: updates.workflowStatus } : {}),
        ...(updates.resumeUnderstandingStatus !== undefined ? { resumeUnderstandingStatus: updates.resumeUnderstandingStatus } : {}),
        ...(updates.resumeLink !== undefined ? { resumeLink: updates.resumeLink } : {}),
        ...(updates.status !== undefined ? { status: updates.status } : {}),
        ...(updates.createdBy !== undefined ? { createdBy: updates.createdBy } : {}),
        ...(updates.poDate !== undefined ? { poDate: updates.poDate } : {}),
        // PRT fields (camelCase DB keys). marketingStartDate is intentionally
        // NOT settable via this path — it is immutable post-create and
        // populated only by the create path or one-shot backfill script.
        ...(updates.teamLead !== undefined ? { teamLead: updates.teamLead } : {}),
        ...(updates.experienceYears !== undefined ? { experienceYears: updates.experienceYears } : {}),
        ...(updates.visaType !== undefined ? { visaType: updates.visaType } : {}),
        ...(updates.eadStartDate !== undefined ? { eadStartDate: updates.eadStartDate } : {}),
        ...(updates.eadEndDate !== undefined ? { eadEndDate: updates.eadEndDate } : {}),
        ...(updates.company !== undefined ? { company: updates.company } : {}),
        ...(updates.city !== undefined ? { city: updates.city } : {}),
        ...(updates.state !== undefined ? { state: updates.state } : {}),
        ...(updates.ackEmail !== undefined ? { ackEmail: updates.ackEmail } : {}),
        ...(updates.ackEmailAt !== undefined ? { ackEmailAt: updates.ackEmailAt } : {}),
        ...(updates.team !== undefined ? { team: updates.team } : {}),
        updated_at: now
      }
    };

    // Combined $push for both statusHistory (existing) and editHistory (PRT).
    const pushDoc = {};

    if (updates.status !== undefined) {
      // Rich statusHistory entry. Old shape kept as flat fields for
      // backward compat with existing readers (the `status` field is the
      // new value, identical to `to`). New consumers should read `from`
      // and `to` for the actual transition, plus `source`/`reason`/`sourceRef`
      // for provenance.
      pushDoc.statusHistory = {
        status:    updates.status,                 // legacy: the new value
        from:      priorStatus,
        to:        updates.status,
        changedAt: now,
        changedBy: changedBy || 'system',
        source:    updates._source    ?? null,    // 'manual-ui' | 'po-email' | 'fireflies-summary' | 'admin-bulk' | 'backfill'
        reason:    updates._reason    ?? null,
        sourceRef: updates._sourceRef ?? null,    // { kind, id, ...metadata }
      };
    }

    // PRT: editHistory $push. Caller (candidateService.updateCandidate) builds
    // the entries by diffing CANDIDATE_AUDITED fields against the prior doc.
    if (Array.isArray(updates._pushEditHistory) && updates._pushEditHistory.length > 0) {
      pushDoc.editHistory = { $each: updates._pushEditHistory };
    }

    // PRT Phase 2: attachments $push (one entry per upload). Service callers
    // pass updates._pushAttachment as the full attachment object.
    if (updates._pushAttachment && typeof updates._pushAttachment === 'object') {
      pushDoc.attachments = updates._pushAttachment;
    }

    // PRT Phase 3: assignmentEmails $push (one entry per send attempt,
    // success OR failure). Service callers pass updates._pushAssignmentEmail
    // as the full audit object.
    if (updates._pushAssignmentEmail && typeof updates._pushAssignmentEmail === 'object') {
      pushDoc.assignmentEmails = updates._pushAssignmentEmail;
    }

    if (Object.keys(pushDoc).length > 0) {
      updateDoc.$push = pushDoc;
    }

    // PRT Phase 2: attachments $pull by id (remove). Distinct operation —
    // never combined with a push to the same field on a single call.
    if (updates._pullAttachmentId) {
      updateDoc.$pull = { attachments: { id: updates._pullAttachmentId } };
    }

    const result = await this.collection.updateOne(filter, updateDoc);

    if (result.matchedCount === 0) {
      const error = new Error('Candidate not found');
      error.statusCode = 404;
      throw error;
    }

    const updatedCandidate = await this.collection.findOne(filter, {
      projection: DEFAULT_PROJECTION
    });

    return updatedCandidate ? this.mapDocumentToCandidate(updatedCandidate) : null;
  }

  async createCandidate(payload = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    const now = new Date();
    const document = {
      Branch: payload.branch || '',
      Recruiter: payload.recruiter || '',
      Expert: payload.expert || '',
      Technology: payload.technology || '',
      'Candidate Name': payload.name || '',
      'Email ID': payload.email || '',
      'Contact No': payload.contact || '',
      resumeLink: payload.resumeLink || '',
      source: payload.source || {},
      workflowStatus: payload.workflowStatus || WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: payload.resumeUnderstandingStatus || RESUME_UNDERSTANDING_STATUS.pending,
      status: payload.status || 'Active',
      createdBy: payload.createdBy || null,
      updated_at: now,
      _last_write: now,
      created_at: now,
      docType: 'candidate',
      // ----- PRT (Placement & Recruiter Tracker) fields -----
      // The PRT create path (`createCandidateFromManager`) populates these.
      // Other create paths (Intervue PO, Fireflies summary, admin-bulk)
      // may omit them — defaults below keep those flows working.
      teamLead: payload.teamLead || '',
      experienceYears: payload.experienceYears ?? null,
      visaType: payload.visaType || '',
      eadStartDate: payload.eadStartDate || null,
      eadEndDate: payload.eadEndDate || null,
      company: payload.company || '',
      city: payload.city || '',
      state: payload.state || '',
      ackEmail: payload.ackEmail || 'Pending',
      ackEmailAt: payload.ackEmailAt || null,
      // marketingStartDate is stamped server-side and is immutable after
      // first insert. PRT path passes `now`; non-PRT paths leave it null
      // and the backfill / next save will fill from `_last_write`.
      marketingStartDate: payload.marketingStartDate || null,
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
      editHistory: Array.isArray(payload.editHistory) ? payload.editHistory : [],
      assignmentEmails: Array.isArray(payload.assignmentEmails) ? payload.assignmentEmails : []
    };

    const result = await this.collection.insertOne(document);

    logger.info('Candidate inserted', {
      candidateId: result.insertedId.toString(),
      createdBy: payload.createdBy || 'unknown'
    });

    return this.collection.findOne({ _id: result.insertedId }, {
      projection: DEFAULT_PROJECTION
    });
  }

  async assignExpertById(id, expertEmail) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!id) {
      throw new Error('Candidate id is required');
    }

    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch (error) {
      const invalidIdError = new Error('Invalid candidate id');
      invalidIdError.statusCode = 400;
      throw invalidIdError;
    }

    const result = await this.collection.updateOne(
      { _id: objectId },
      {
        $set: {
          Expert: expertEmail,
          workflowStatus: WORKFLOW_STATUS.needsResumeUnderstanding,
          resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
          updated_at: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      const error = new Error('Candidate not found');
      error.statusCode = 404;
      throw error;
    }

    return this.collection.findOne({ _id: objectId }, {
      projection: DEFAULT_PROJECTION
    });
  }

  async updateResumeUnderstandingStatus(id, status) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!id) {
      throw new Error('Candidate id is required');
    }

    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch (error) {
      const invalidIdError = new Error('Invalid candidate id');
      invalidIdError.statusCode = 400;
      throw invalidIdError;
    }

    const normalizedStatus = status === RESUME_UNDERSTANDING_STATUS.done
      ? RESUME_UNDERSTANDING_STATUS.done
      : RESUME_UNDERSTANDING_STATUS.pending;

    const result = await this.collection.updateOne(
      { _id: objectId },
      {
        $set: {
          resumeUnderstandingStatus: normalizedStatus,
          workflowStatus: normalizedStatus === RESUME_UNDERSTANDING_STATUS.done
            ? WORKFLOW_STATUS.completed
            : WORKFLOW_STATUS.needsResumeUnderstanding,
          updated_at: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      const error = new Error('Candidate not found');
      error.statusCode = 404;
      throw error;
    }

    return this.collection.findOne({ _id: objectId }, {
      projection: DEFAULT_PROJECTION
    });
  }

  async getCandidatesByWorkflowStatus(status, { limit } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    const statuses = Array.isArray(status) ? status : [status];
    const query = { workflowStatus: { $in: statuses } };

    let cursor = this.collection
      .find(query, {
        projection: DEFAULT_PROJECTION
      })
      .sort({ _last_write: -1 });

    if (Number.isFinite(limit) && limit > 0) {
      cursor = cursor.limit(Math.floor(limit));
    }

    const documents = await cursor.toArray();

    return documents.map((doc) => this.mapDocumentToCandidate(doc));
  }

  async getCandidatesForExpert(expertEmail, statusFilter = null, { limit } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    const query = {
      Expert: { $regex: `^${escapeRegex(expertEmail)}$`, $options: 'i' }
    };

    if (statusFilter) {
      query.resumeUnderstandingStatus = statusFilter;
    }

    let cursor = this.collection
      .find(query, {
        projection: DEFAULT_PROJECTION
      })
      .sort({ _last_write: -1 });

    if (Number.isFinite(limit) && limit > 0) {
      cursor = cursor.limit(Math.floor(limit));
    }

    const documents = await cursor.toArray();

    return documents.map((doc) => this.mapDocumentToCandidate(doc));
  }

  async getCandidatesByExperts(expertEmails, { limit, search, status } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!Array.isArray(expertEmails) || expertEmails.length === 0) {
      return [];
    }

    const orConditions = expertEmails.map((email) => ({
      Expert: { $regex: `^${escapeRegex(email)}$`, $options: 'i' }
    }));

    const query = { $or: orConditions, docType: { $in: [null, 'candidate'] } };

    if (status) {
      query.resumeUnderstandingStatus = status;
    }

    if (search) {
      query['Candidate Name'] = { $regex: search, $options: 'i' };
    }

    let cursor = this.collection
      .find(query, { projection: LIST_PROJECTION })
      .sort({ _last_write: -1 });

    if (Number.isFinite(limit) && limit > 0) {
      cursor = cursor.limit(Math.floor(limit));
    }

    const documents = await cursor.toArray();

    return documents.map((doc) => this.mapDocumentToCandidate(doc));
  }

  async getCandidateByEmail(email) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!email) {
      return null;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const document = await this.collection.findOne({
      'Email ID': { $regex: new RegExp(`^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      docType: { $in: [null, 'candidate'] }
    }, {
      projection: DEFAULT_PROJECTION,
      sort: { _last_write: -1 }
    });

    return document ? this.mapDocumentToCandidate(document) : null;
  }

  async getCandidateById(id) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!id) {
      throw new Error('Candidate id is required');
    }

    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch (error) {
      const invalidIdError = new Error('Invalid candidate id');
      invalidIdError.statusCode = 400;
      throw invalidIdError;
    }

    const document = await this.collection.findOne({
      _id: objectId,
      docType: { $in: [null, 'candidate'] }
    }, {
      projection: DEFAULT_PROJECTION
    });

    return document ? this.mapDocumentToCandidate(document) : null;
  }

  async countResumeUnderstandingTasks(expertEmail, status = RESUME_UNDERSTANDING_STATUS.pending) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!expertEmail) {
      return 0;
    }

    const normalizedStatus = status === RESUME_UNDERSTANDING_STATUS.done
      ? RESUME_UNDERSTANDING_STATUS.done
      : RESUME_UNDERSTANDING_STATUS.pending;

    const query = {
      Expert: { $regex: `^${escapeRegex(expertEmail)}$`, $options: 'i' },
      resumeUnderstandingStatus: normalizedStatus
    };

    return this.collection.countDocuments(query);
  }

  async countResumeUnderstandingTasksForExperts(expertEmails, status = RESUME_UNDERSTANDING_STATUS.pending) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!Array.isArray(expertEmails) || expertEmails.length === 0) {
      return 0;
    }

    const normalizedStatus = status === RESUME_UNDERSTANDING_STATUS.done
      ? RESUME_UNDERSTANDING_STATUS.done
      : RESUME_UNDERSTANDING_STATUS.pending;

    const matchers = expertEmails
      .map((email) => (typeof email === 'string' ? email.trim().toLowerCase() : ''))
      .filter(Boolean)
      .map((email) => ({
        Expert: { $regex: `^${escapeRegex(email)}$`, $options: 'i' }
      }));

    if (matchers.length === 0) {
      return 0;
    }

    const query = {
      resumeUnderstandingStatus: normalizedStatus,
      ...(matchers.length === 1 ? matchers[0] : { $or: matchers })
    };

    return this.collection.countDocuments(query);
  }

  async countCandidatesByWorkflowStatuses(statuses = []) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    const normalizedStatuses = Array.isArray(statuses)
      ? statuses.filter(Boolean)
      : [];

    if (normalizedStatuses.length === 0) {
      return 0;
    }

    const query = {
      workflowStatus: { $in: normalizedStatuses },
      docType: { $in: [null, 'candidate'] }
    };

    return this.collection.countDocuments(query);
  }

  // Count candidates in a recruiter scope without materialising the list.
  // Shares _buildRecruiterScopeQuery with getCandidatesByRecruiters so the
  // count is exactly the length the queue would have returned for the same
  // (emails, visibility, status) — used by the resume-understanding sidebar
  // badge instead of fetching + mapping the whole queue just to read .length.
  async countCandidatesByRecruiters(recruiterEmails, { visibility, workflowStatus, resumeUnderstandingStatus } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    const query = this._buildRecruiterScopeQuery(recruiterEmails, {
      visibility,
      workflowStatus,
      resumeUnderstandingStatus
    });
    if (!query) {
      return 0;
    }

    return this.collection.countDocuments(query);
  }

  async getUserProfileMetadata(email) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!email) {
      throw new Error('Email is required');
    }

    const lowerEmail = email.toLowerCase();

    return this.collection.findOne(
      { docType: 'userProfile', email: lowerEmail },
      {
        projection: { _id: 1, email: 1, metadata: 1, docType: 1, created_at: 1, updated_at: 1 },
        collation: { locale: 'en', strength: 2 }
      }
    );
  }

  async upsertUserProfileMetadata(email, metadata = {}, { upsert = true } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!email) {
      throw new Error('Email is required');
    }

    const lowerEmail = email.toLowerCase();
    const now = new Date();
    const filter = { docType: 'userProfile', email: lowerEmail };
    const updateDoc = {
      $set: {
        metadata,
        email: lowerEmail,
        docType: 'userProfile',
        updated_at: now
      },
      ...(upsert
        ? {
          $setOnInsert: {
            docType: 'userProfile',
            email: lowerEmail,
            created_at: now
          }
        }
        : {})
    };

    const options = {
      upsert,
      collation: { locale: 'en', strength: 2 }
    };

    const result = await this.collection.updateOne(filter, updateDoc, options);

    if (!upsert && result.matchedCount === 0) {
      const error = new Error('User profile metadata not found');
      error.statusCode = 404;
      throw error;
    }

    return result;
  }

  mapDocumentToCandidate(doc) {
    return {
      id: doc._id?.toString?.() ?? String(doc._id),
      name: doc['Candidate Name'] ?? '',
      branch: doc.Branch ?? '',
      recruiter: doc.Recruiter ?? '',
      expert: doc.Expert ?? '',
      technology: doc.Technology ?? '',
      email: doc['Email ID'] ?? '',
      contact: doc['Contact No'] ?? '',
      status: doc.status || 'Active',
      receivedDate: doc.source?.receivedDateTime ?? null,
      updatedAt: doc.updated_at instanceof Date ? doc.updated_at.toISOString() : doc.updated_at ?? null,
      lastWriteAt: doc._last_write instanceof Date ? doc._last_write.toISOString() : doc._last_write ?? null,
      workflowStatus: doc.workflowStatus || WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: doc.resumeUnderstandingStatus || RESUME_UNDERSTANDING_STATUS.pending,
      resumeUnderstanding: Boolean(doc.resumeUnderstanding),
      createdBy: doc.createdBy || null,
      resumeLink: doc.resumeLink || '',
      poDate: doc.poDate instanceof Date ? doc.poDate.toISOString() : doc.poDate ?? null,
      statusHistory: Array.isArray(doc.statusHistory) ? doc.statusHistory.map(e => ({
        // Legacy fields (always present for backward compat).
        status: e.status,
        changedAt: e.changedAt instanceof Date ? e.changedAt.toISOString() : e.changedAt,
        changedBy: e.changedBy || 'system',
        // Rich fields (new entries only; older entries return null).
        from:      e.from      ?? null,
        to:        e.to        ?? e.status ?? null,
        source:    e.source    ?? null,
        reason:    e.reason    ?? null,
        sourceRef: e.sourceRef ?? null,
      })) : []
    };
  }
}

export const candidateModel = new CandidateModel();
