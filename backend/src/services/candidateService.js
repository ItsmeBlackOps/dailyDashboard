import { candidateModel, WORKFLOW_STATUS, RESUME_UNDERSTANDING_STATUS } from '../models/Candidate.js';
import { userModel } from '../models/User.js';
import { logger } from '../utils/logger.js';

const MM_BRANCH_MAP = new Map([
  ['tushar.ahuja@silverspaceinc.com', 'GGR'],
  ['aryan.mishra@silverspaceinc.com', 'LKN'],
  ['akash.avasthi@silverspaceinc.com', 'AHM'],
  ['akash.avasthi@flawless-ed.com', 'AHM']
]);

const ROLE_MM = 'mm';
const ROLE_MAM = 'mam';
const ROLE_MLEAD = 'mlead';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Escape special regular-expression characters in a string so it can be used safely in a RegExp.
 * @param {string} value - The input string to escape.
 * @returns {string} The input with all RegExp metacharacters escaped.
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize an email by trimming surrounding whitespace and converting to lowercase.
 * @param {string} value - The email value to normalize.
 * @returns {string} The normalized email string; returns an empty string if `value` is falsy.
 */
function normalizeEmail(value) {
  return (value || '').trim().toLowerCase();
}

/**
 * Capitalize a string segment so the first character is uppercase and the rest are lowercase.
 * @param {string} segment - The input text segment to capitalize; may be empty.
 * @returns {string} The capitalized segment, or an empty string if the input is empty.
 */
function capitalize(segment = '') {
  if (!segment) return '';
  return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
}

/**
 * Derives a human-readable display name from the local part of an email address.
 * @param {string} email - The email address to derive a name from.
 * @returns {string} The display name produced from the email's local part, with segments capitalized and separated by spaces; returns an empty string for falsy or malformed input.
 */
function deriveDisplayNameFromEmail(email) {
  const local = (email || '').split('@')[0];
  const parts = local.split(/[._\s-]+/).filter(Boolean);
  if (parts.length === 0) return email || '';
  return parts.map(capitalize).join(' ');
}

/**
 * Normalize a name by converting to a string, trimming whitespace, collapsing consecutive spaces, and lowercasing.
 * @param {any} value - Value to normalize; non-string inputs are coerced to string.
 * @returns {string} The normalized name: trimmed, lowercase, with internal whitespace collapsed to single spaces.
 */
function normalizeName(value) {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Convert a string to Title Case across segments separated by spaces, dots, underscores, or hyphens.
 * @param {string} value - The input to convert; non-string values will be coerced to string.
 * @returns {string} The input converted to Title Case with segments joined by single spaces (or an empty string for empty input).
 */
function toTitleCase(value = '') {
  return value
    .toString()
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(' ');
}

/**
 * Produce a human-friendly display name from an email or raw name string.
 * @param {string} value - An email address or a raw name; may be empty or falsy.
 * @returns {string} The formatted display name derived from the email local-part when `value` contains `@`, or the title-cased name; empty string if `value` is falsy.
 */
function formatDisplayName(value = '') {
  if (!value) return '';
  if (value.includes('@')) {
    return deriveDisplayNameFromEmail(value);
  }
  return toTitleCase(value);
}

/**
 * Normalize a technology label into title case, preserving slash-separated subsegments.
 * 
 * @param {string} value - Technology string (tokens separated by whitespace; subsegments may be separated by `/`).
 * @returns {string} The technology string with each token converted to Title Case and each `/`-separated subsegment title-cased, or an empty string if input is empty.
 */
function formatTechnology(value = '') {
  if (!value) return '';
  return value
    .toString()
    .trim()
    .split(/\s+/)
    .map((segment) => segment.split('/').map(toTitleCase).join('/'))
    .join(' ');
}

/**
 * Normalize an email by trimming whitespace and converting to lowercase; return an empty string if the input is missing or not an email.
 * @param {string} value - Input value to normalize; may be empty or non-string.
 * @returns {string} The trimmed, lowercased email if it contains an '@', otherwise an empty string.
 */
function formatEmail(value = '') {
  const trimmed = (value || '').toString().trim();
  if (!trimmed || !trimmed.includes('@')) {
    return '';
  }
  return trimmed.toLowerCase();
}

class CandidateService {
  resolveBranchForMm(email, role) {
    if (!email || !role) {
      return null;
    }

    if (role.trim().toLowerCase() !== ROLE_MM) {
      return null;
    }

    const mappedBranch = MM_BRANCH_MAP.get(normalizeEmail(email));
    return mappedBranch || null;
  }

  collectHierarchyEmails(user) {
    const allUsers = userModel.getAllUsers();

    const leaderDisplayName = normalizeName(deriveDisplayNameFromEmail(user.email));

    const leadToUsers = new Map();
    for (const candidate of allUsers) {
      if (!candidate.teamLead) continue;
      const leadName = normalizeName(candidate.teamLead);
      if (!leadToUsers.has(leadName)) {
        leadToUsers.set(leadName, []);
      }
      leadToUsers.get(leadName).push(candidate);
    }

    const visitedLeads = new Set();
    const queue = [leaderDisplayName];
    const allSubordinateEmails = new Set();
    const recruiterEmails = new Set();

    while (queue.length > 0) {
      const currentLead = queue.shift();
      if (!currentLead || visitedLeads.has(currentLead)) {
        continue;
      }
      visitedLeads.add(currentLead);

      const directReports = leadToUsers.get(currentLead) || [];
      for (const report of directReports) {
        const reportEmail = normalizeEmail(report.email);
        allSubordinateEmails.add(reportEmail);

        const reportRole = (report.role || '').toLowerCase();
        if (reportRole === 'recruiter') {
          recruiterEmails.add(reportEmail);
        }

        const reportDisplayName = normalizeName(deriveDisplayNameFromEmail(report.email));
        if (!visitedLeads.has(reportDisplayName)) {
          queue.push(reportDisplayName);
        }
      }
    }

    return {
      allSubordinateEmails,
      recruiterEmails
    };
  }

  buildSearchPattern(search) {
    if (typeof search !== 'string') {
      return undefined;
    }
    const trimmed = search.trim();
    if (!trimmed) {
      return undefined;
    }
    return escapeRegex(trimmed);
  }

  sanitizeLimit(limit) {
    if (!Number.isFinite(limit)) {
      return undefined;
    }
    const normalized = Math.floor(limit);
    if (normalized < 1) return 1;
    if (normalized > 500) return 500;
    return normalized;
  }

  async fetchCandidatesByBranch(user, branch, options) {
    const limit = this.sanitizeLimit(options.limit);
    const searchPattern = this.buildSearchPattern(options.search);

    const candidates = await candidateModel.getCandidatesByBranch(branch, {
      limit,
      search: searchPattern
    });

    const formattedCandidates = candidates.map((candidate) => this.formatCandidateRecord(candidate));

    logger.info('Branch candidates retrieved', {
      userEmail: user.email,
      branch,
      candidateCount: candidates.length
    });

    return {
      scope: {
        type: 'branch',
        value: branch
      },
      candidates: formattedCandidates,
      meta: {
        count: candidates.length,
        branch,
        appliedLimit: limit ?? null,
        hasSearch: Boolean(searchPattern)
      }
    };
  }

  async fetchCandidatesByRecruiters(user, recruiterEmails, options) {
    if (!recruiterEmails.length) {
      const error = new Error('No recruiters mapped to current user');
      error.statusCode = 403;
      throw error;
    }

    const limit = this.sanitizeLimit(options.limit);
    const searchPattern = this.buildSearchPattern(options.search);

    const candidates = await candidateModel.getCandidatesByRecruiters(recruiterEmails, {
      limit,
      search: searchPattern
    });

    const formattedCandidates = candidates.map((candidate) => this.formatCandidateRecord(candidate));

    logger.info('Hierarchy candidates retrieved', {
      userEmail: user.email,
      recruiterCount: recruiterEmails.length,
      returned: candidates.length
    });

    return {
      scope: {
        type: 'hierarchy',
        value: recruiterEmails
      },
      candidates: formattedCandidates,
      meta: {
        count: candidates.length,
        recruiters: recruiterEmails,
        appliedLimit: limit ?? null,
      hasSearch: Boolean(searchPattern)
      }
    };
  }

  async fetchAllCandidates(user, options) {
    const limit = this.sanitizeLimit(options.limit);
    const searchPattern = this.buildSearchPattern(options.search);

    const candidates = await candidateModel.getAllCandidates({
      limit,
      search: searchPattern
    });

    const formattedCandidates = candidates.map((candidate) => this.formatCandidateRecord(candidate));

    logger.info('Admin candidates retrieved', {
      userEmail: user.email,
      returned: candidates.length,
      appliedLimit: limit ?? null,
      hasSearch: Boolean(searchPattern)
    });

    const allUsers = userModel.getAllUsers();
    const expertEmails = allUsers
      .filter((person) => ['lead', 'am', 'expert', 'user'].includes((person.role || '').toLowerCase()))
      .map((person) => person.email)
      .filter(Boolean);

    return {
      scope: {
        type: 'admin',
        value: 'all'
      },
      candidates: formattedCandidates,
      meta: {
        count: candidates.length,
        appliedLimit: limit ?? null,
        hasSearch: Boolean(searchPattern)
      },
      options: {
        recruiterChoices: this.buildAssignablePeople(user),
        expertChoices: this.buildExpertChoices(expertEmails)
      }
    };
  }

  async fetchCandidatesByExperts(user, expertEmails, options) {
    const limit = this.sanitizeLimit(options?.limit);
    const searchPattern = this.buildSearchPattern(options?.search);

    if (!Array.isArray(expertEmails) || expertEmails.length === 0) {
      logger.info('Expert candidate fetch skipped due to empty expert list', {
        userEmail: user?.email || 'unknown'
      });

      return {
        scope: {
          type: 'expert',
          value: []
        },
        candidates: [],
        meta: {
          count: 0,
          experts: [],
          appliedLimit: limit ?? null,
          hasSearch: Boolean(searchPattern)
        }
      };
    }

    const candidates = await candidateModel.getCandidatesByExperts(expertEmails, {
      limit,
      search: searchPattern
    });

    const formattedCandidates = candidates.map((candidate) => this.formatCandidateRecord(candidate));

    logger.info('Expert candidates retrieved', {
      userEmail: user.email,
      expertCount: expertEmails.length,
      returned: candidates.length
    });

    return {
      scope: {
        type: 'expert',
        value: expertEmails
      },
      candidates: formattedCandidates,
      meta: {
        count: candidates.length,
        experts: expertEmails,
        appliedLimit: limit ?? null,
        hasSearch: Boolean(searchPattern)
      }
    };
  }

  formatCandidateRecord(candidate) {
    if (!candidate) {
      return {
        id: '',
        name: '',
        branch: '',
        recruiter: '',
        recruiterRaw: '',
        expert: '',
        expertRaw: '',
        technology: '',
        email: '',
        contact: '',
        receivedDate: candidate?.receivedDate ?? null,
        updatedAt: candidate?.updatedAt ?? null,
        lastWriteAt: candidate?.lastWriteAt ?? null,
        workflowStatus: candidate?.workflowStatus ?? WORKFLOW_STATUS.awaitingExpert,
        resumeUnderstandingStatus: candidate?.resumeUnderstandingStatus ?? RESUME_UNDERSTANDING_STATUS.pending,
        resumeUnderstanding: false,
        createdBy: candidate?.createdBy ?? null
      };
    }

    const recruiterEmail = formatEmail(candidate.recruiter ?? '');
    const recruiterDisplay = recruiterEmail ? formatDisplayName(recruiterEmail) : formatDisplayName(candidate.recruiter ?? '');
    const expertValue = candidate.expert ?? '';
    const expertDisplay = formatDisplayName(expertValue);

    return {
      ...candidate,
      name: toTitleCase(candidate.name ?? ''),
      branch: candidate.branch ?? '',
      recruiter: recruiterDisplay,
      recruiterRaw: recruiterEmail,
      expert: expertDisplay,
      expertRaw: expertValue,
      technology: formatTechnology(candidate.technology ?? ''),
      email: formatEmail(candidate.email ?? ''),
      contact: candidate.contact ?? '',
      workflowStatus: candidate.workflowStatus || WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: candidate.resumeUnderstandingStatus || RESUME_UNDERSTANDING_STATUS.pending,
      resumeUnderstanding: (candidate.resumeUnderstandingStatus || RESUME_UNDERSTANDING_STATUS.pending) === RESUME_UNDERSTANDING_STATUS.done,
      createdBy: candidate.createdBy || null
    };
  }

  buildAssignablePeople(user) {
    const allUsers = userModel.getAllUsers();
    const normalizedRole = (user.role || '').toLowerCase();
    const mmEmail = formatEmail(user.email || '');
    const mmName = normalizeName(formatDisplayName(user.email));
    const result = new Map();

    const addPerson = (person, labelOverride) => {
      const email = formatEmail(person.email || '');
      if (!email) return;
      const label = labelOverride || formatDisplayName(person.displayName || person.email || '');
      result.set(email, label);
    };

    if (normalizedRole === ROLE_MM) {
      for (const person of allUsers) {
        const normalizedRoleValue = (person.role || '').toLowerCase();
        if (!['mam', 'mlead', 'recruiter'].includes(normalizedRoleValue)) continue;
        const personManagerName = normalizeName(person.manager || '');
        const personManagerEmail = formatEmail(person.manager || '');
        if (personManagerName === mmName || (mmEmail && personManagerEmail === mmEmail)) {
          addPerson(person);
        }
      }

      addPerson({ email: user.email, displayName: user.email });

      return Array.from(result.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    if (normalizedRole === ROLE_MAM) {
      const mamName = normalizeName(formatDisplayName(user.email));
      const mamEmail = formatEmail(user.email || '');
      const mleadNames = new Set();

      addPerson({ email: user.email, displayName: user.email });

      for (const person of allUsers) {
        const normalizedRoleValue = (person.role || '').toLowerCase();
        if (normalizedRoleValue !== 'mlead') continue;
        const personManagerName = normalizeName(person.manager || '');
        const personManagerEmail = formatEmail(person.manager || '');
        const personTeamLeadName = normalizeName(person.teamLead || '');
        if (
          personManagerName === mamName ||
          (mamEmail && personManagerEmail === mamEmail) ||
          (personTeamLeadName && personTeamLeadName === mamName)
        ) {
          addPerson(person);
          mleadNames.add(normalizeName(formatDisplayName(person.email || '')));
        }
      }

      for (const person of allUsers) {
        const normalizedRoleValue = (person.role || '').toLowerCase();
        if (normalizedRoleValue !== 'recruiter') continue;
        const teamLeadName = normalizeName(person.teamLead || '');
        if (teamLeadName === mamName || mleadNames.has(teamLeadName)) {
          addPerson(person);
        }
      }

      return Array.from(result.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    if (normalizedRole === ROLE_MLEAD) {
      const mleadName = normalizeName(formatDisplayName(user.email));
      addPerson({ email: user.email, displayName: user.email });

      for (const person of allUsers) {
        const normalizedRoleValue = (person.role || '').toLowerCase();
        if (normalizedRoleValue !== 'recruiter') continue;
        const teamLeadName = normalizeName(person.teamLead || '');
        if (teamLeadName === mleadName) {
          addPerson(person);
        }
      }

      return Array.from(result.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    const relevantRoles = new Set(['mam', 'mlead', 'recruiter']);
    for (const person of allUsers) {
      const normalizedRoleValue = (person.role || '').toLowerCase();
      if (!relevantRoles.has(normalizedRoleValue)) continue;
      addPerson(person);
    }

    if (user?.email) {
      addPerson({ email: user.email, displayName: user.email });
    }

    return Array.from(result.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  buildExpertChoices(expertEmails = []) {
    if (!Array.isArray(expertEmails) || expertEmails.length === 0) {
      return [];
    }

    const uniqueEmails = Array.from(
      new Set(
        expertEmails
          .map((email) => formatEmail(email || ''))
          .filter((email) => Boolean(email))
      )
    );

    return uniqueEmails
      .map((email) => ({
        value: email,
        label: formatDisplayName(email)
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  async getPendingExpertAssignments(user, options = {}) {
    if (!user?.email || !user?.role) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    const normalizedRole = user.role.trim().toLowerCase();
    if (!['admin', 'manager'].includes(normalizedRole)) {
      const error = new Error('Access denied');
      error.statusCode = 403;
      throw error;
    }

    const limit = this.sanitizeLimit(options.limit);
    const candidates = await candidateModel.getCandidatesByWorkflowStatus(
      [
        WORKFLOW_STATUS.awaitingExpert,
        WORKFLOW_STATUS.needsResumeUnderstanding
      ],
      { limit }
    );

    const formattedCandidates = candidates.map((candidate) => this.formatCandidateRecord(candidate));

    const allUsers = userModel.getAllUsers();
    const expertEmails = allUsers
      .filter((person) => ['lead', 'am', 'expert', 'user'].includes((person.role || '').toLowerCase()))
      .map((person) => person.email)
      .filter(Boolean);

    return {
      candidates: formattedCandidates,
      options: {
        expertChoices: this.buildExpertChoices(expertEmails)
      }
    };
  }

  async getResumeUnderstandingQueue(user, status = RESUME_UNDERSTANDING_STATUS.pending, options = {}) {
    if (!user?.email || !user?.role) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    const normalizedRole = user.role.trim().toLowerCase();
    const limit = this.sanitizeLimit(options.limit);

    if (normalizedRole === 'admin' || normalizedRole === 'manager') {
      const candidates = await candidateModel.getCandidatesByWorkflowStatus(
        status === RESUME_UNDERSTANDING_STATUS.done
          ? WORKFLOW_STATUS.completed
          : WORKFLOW_STATUS.needsResumeUnderstanding,
        { limit }
      );

      return candidates.map((candidate) => this.formatCandidateRecord(candidate));
    }

    if (normalizedRole === 'am' || normalizedRole === 'lead' || normalizedRole === 'expert' || normalizedRole === 'user') {
      const expertEmail = formatEmail(user.email);
      const candidates = await candidateModel.getCandidatesForExpert(expertEmail, status, { limit });
      return candidates.map((candidate) => this.formatCandidateRecord(candidate));
    }

    const error = new Error('Access denied');
    error.statusCode = 403;
    throw error;
  }

  async getResumeUnderstandingCount(user, status = RESUME_UNDERSTANDING_STATUS.pending) {
    if (!user?.email || !user?.role) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    const normalizedRole = user.role.trim().toLowerCase();
    const normalizedStatus = status === RESUME_UNDERSTANDING_STATUS.done
      ? RESUME_UNDERSTANDING_STATUS.done
      : RESUME_UNDERSTANDING_STATUS.pending;

    if (normalizedRole === 'admin' || normalizedRole === 'manager') {
      const workflowStatus = normalizedStatus === RESUME_UNDERSTANDING_STATUS.done
        ? WORKFLOW_STATUS.completed
        : WORKFLOW_STATUS.needsResumeUnderstanding;
      const candidates = await candidateModel.getCandidatesByWorkflowStatus(workflowStatus, { limit: 500 });
      return candidates.length;
    }

    if (normalizedRole === 'am' || normalizedRole === 'lead' || normalizedRole === 'expert' || normalizedRole === 'user') {
      const expertEmail = formatEmail(user.email);
      return candidateModel.countResumeUnderstandingTasks(expertEmail, normalizedStatus);
    }

    const error = new Error('Access denied');
    error.statusCode = 403;
    throw error;
  }

  sanitizeCandidatePayload(payload = {}) {
    const sanitized = {};

    if (payload.name !== undefined) {
      const name = toTitleCase(payload.name);
      if (!name) {
        const error = new Error('Candidate name is required');
        error.statusCode = 400;
        throw error;
      }
      sanitized.name = name;
    }

    if (payload.branch !== undefined) {
      const branch = payload.branch?.toString?.().trim();
      if (!branch) {
        const error = new Error('Branch is required');
        error.statusCode = 400;
        throw error;
      }
      sanitized.branch = branch.toUpperCase();
    }

    if (payload.technology !== undefined) {
      sanitized.technology = formatTechnology(payload.technology);
    }

    if (payload.email !== undefined) {
      const email = formatEmail(payload.email);
      if (!EMAIL_REGEX.test(email)) {
        const error = new Error('Invalid email address');
        error.statusCode = 400;
        throw error;
      }
      sanitized.email = email;
    }

    if (payload.recruiter !== undefined) {
      const recruiterEmail = formatEmail(payload.recruiter);
      if (recruiterEmail) {
        if (!EMAIL_REGEX.test(recruiterEmail)) {
          const error = new Error('Invalid recruiter email');
          error.statusCode = 400;
          throw error;
        }
        sanitized.recruiter = recruiterEmail;
      }
    }

    if (payload.expert !== undefined) {
      const expertEmail = formatEmail(payload.expert);
      if (!expertEmail || !EMAIL_REGEX.test(expertEmail)) {
        const error = new Error('Invalid expert email');
        error.statusCode = 400;
        throw error;
      }
      sanitized.expert = expertEmail;
    }

    if (payload.contact !== undefined) {
      const rawContact = payload.contact.toString().trim();
      if (!rawContact) {
        sanitized.contact = '';
      } else {
        const digitsOnly = rawContact.replace(/[^0-9]/g, '');
        if (digitsOnly.length !== 10) {
          const error = new Error('Contact number must be 10 digits');
          error.statusCode = 400;
          throw error;
        }
        sanitized.contact = `+1${digitsOnly}`;
      }
    }

    if (payload.workflowStatus !== undefined) {
      sanitized.workflowStatus = payload.workflowStatus;
    }

    if (payload.resumeUnderstandingStatus !== undefined) {
      sanitized.resumeUnderstandingStatus = payload.resumeUnderstandingStatus;
    }

    return sanitized;
  }

  async updateCandidateDetails(user, candidateId, payload = {}) {
    if (!user?.email || !user?.role) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    const normalizedRole = user.role.trim().toLowerCase();
    if (!['mm', 'mam', 'mlead', 'recruiter', 'lead', 'am'].includes(normalizedRole)) {
      const error = new Error('Access denied');
      error.statusCode = 403;
      throw error;
    }

    if (!candidateId) {
      const error = new Error('Candidate id is required');
      error.statusCode = 400;
      throw error;
    }

    const sanitizedPayload = this.sanitizeCandidatePayload(payload);

    if (normalizedRole === 'lead' || normalizedRole === 'am') {
      const allowedKeys = ['expert'];
      for (const key of Object.keys(sanitizedPayload)) {
        if (!allowedKeys.includes(key)) {
          delete sanitizedPayload[key];
        }
      }
    }

    if (normalizedRole === 'recruiter') {
      const allowedKeys = ['name', 'email', 'contact'];
      for (const key of Object.keys(sanitizedPayload)) {
        if (!allowedKeys.includes(key)) {
          delete sanitizedPayload[key];
        }
      }
      delete sanitizedPayload.expert;
    }

    if (['mm', 'mam', 'mlead'].includes(normalizedRole)) {
      delete sanitizedPayload.expert;
    }

    if (Object.keys(sanitizedPayload).length === 0) {
      const error = new Error('No changes provided');
      error.statusCode = 400;
      throw error;
    }

    const updated = await candidateModel.updateCandidateById(candidateId, sanitizedPayload);

    logger.info('Candidate updated', {
      candidateId,
      updatedBy: user.email,
      fields: Object.keys(sanitizedPayload)
    });

    return this.formatCandidateRecord(updated);
  }

  async createCandidateFromManager(user, payload = {}) {
    if (!user?.email || !user?.role) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    const normalizedRole = user.role.trim().toLowerCase();
    if (!['manager', 'admin', 'mm'].includes(normalizedRole)) {
      const error = new Error('Access denied');
      error.statusCode = 403;
      throw error;
    }

    const sanitized = this.sanitizeCandidatePayload(payload);

    // Managers are not permitted to set the expert or workflow flags directly.
    delete sanitized.expert;
    delete sanitized.workflowStatus;
    delete sanitized.resumeUnderstandingStatus;

    if (!sanitized.branch) {
      const error = new Error('Branch is required');
      error.statusCode = 400;
      throw error;
    }

    if (!sanitized.recruiter) {
      const error = new Error('Recruiter email is required');
      error.statusCode = 400;
      throw error;
    }

    if (!sanitized.name || !sanitized.email) {
      const error = new Error('Candidate name and email are required');
      error.statusCode = 400;
      throw error;
    }

    const document = await candidateModel.createCandidate({
      ...sanitized,
      expert: '',
      workflowStatus: WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
      createdBy: user.email
    });

    return this.formatCandidateRecord(document);
  }

  async assignExpert(user, candidateId, expertEmail) {
    if (!user?.email || !user?.role) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    const normalizedRole = user.role.trim().toLowerCase();
    if (!['admin', 'manager'].includes(normalizedRole)) {
      const error = new Error('Access denied');
      error.statusCode = 403;
      throw error;
    }

    const email = formatEmail(expertEmail);
    if (!EMAIL_REGEX.test(email)) {
      const error = new Error('Invalid expert email');
      error.statusCode = 400;
      throw error;
    }

    const roster = new Set(
      userModel
        .getAllUsers()
        .filter((person) => ['lead', 'am', 'expert', 'user'].includes((person.role || '').toLowerCase()))
        .map((person) => formatEmail(person.email || ''))
        .filter(Boolean)
    );

    if (!roster.has(email)) {
      const error = new Error('Expert must be selected from the roster');
      error.statusCode = 400;
      throw error;
    }

    const updated = await candidateModel.assignExpertById(candidateId, email);
    return this.formatCandidateRecord(updated);
  }

  async updateResumeUnderstanding(user, candidateId, status) {
    if (!user?.email || !user?.role) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    const normalizedRole = user.role.trim().toLowerCase();
    const candidate = await candidateModel.getCandidateById(candidateId);
    if (!candidate) {
      const error = new Error('Candidate not found');
      error.statusCode = 404;
      throw error;
    }

    const candidateExpert = formatEmail(candidate.expert || '');
    const requester = formatEmail(user.email);

    if (normalizedRole !== 'admin' && requester !== candidateExpert) {
      const error = new Error('Access denied');
      error.statusCode = 403;
      throw error;
    }

    const updated = await candidateModel.updateResumeUnderstandingStatus(candidateId, status);
    return this.formatCandidateRecord(updated);
  }

  async getCandidatesForUser(user, options = {}) {
    if (!user?.email || !user?.role) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    const normalizedRole = user.role.trim().toLowerCase();

    if (normalizedRole === 'admin') {
      return this.fetchAllCandidates(user, options);
    }

    if (normalizedRole === ROLE_MM) {
      const branch = this.resolveBranchForMm(user.email, user.role);
      if (!branch) {
        const error = new Error('Branch mapping not configured for user');
        error.statusCode = 403;
        throw error;
      }
      const result = await this.fetchCandidatesByBranch(user, branch, options);
      result.options = {
        recruiterChoices: this.buildAssignablePeople(user)
      };
      return result;
    }

    if (normalizedRole === ROLE_MAM || normalizedRole === ROLE_MLEAD) {
      const hierarchy = this.collectHierarchyEmails(user);
      const normalizedEmail = normalizeEmail(user.email);

      if (normalizedRole === ROLE_MAM) {
        const recruiterEmails = new Set([
          ...hierarchy.recruiterEmails,
          ...hierarchy.allSubordinateEmails,
          normalizedEmail
        ]);
        const result = await this.fetchCandidatesByRecruiters(user, Array.from(recruiterEmails), options);
        result.options = {
          recruiterChoices: this.buildAssignablePeople(user)
        };
        return result;
      }

      if (normalizedRole === ROLE_MLEAD) {
        const recruiters = hierarchy.recruiterEmails.size
          ? Array.from(hierarchy.recruiterEmails)
          : [normalizedEmail];
        const result = await this.fetchCandidatesByRecruiters(user, recruiters, options);
        result.options = {
          recruiterChoices: this.buildAssignablePeople(user)
        };
        return result;
      }
    }

    if (normalizedRole === 'am') {
      const experts = new Set();
      experts.add(normalizeEmail(user.email));

      const amName = normalizeName(formatDisplayName(user.email));
      const allUsers = userModel.getAllUsers();

      const leadNameToEmail = new Map();

      for (const person of allUsers) {
        const roleKey = (person.role || '').toLowerCase();
        const normalizedEmailValue = normalizeEmail(person.email);
        if (!normalizedEmailValue) continue;

        if (roleKey === 'lead') {
          const personTeamLeadName = normalizeName(person.teamLead || '');
          if (personTeamLeadName === amName) {
            experts.add(normalizedEmailValue);
            const leadDisplayName = normalizeName(formatDisplayName(person.email));
            if (leadDisplayName) {
              leadNameToEmail.set(leadDisplayName, normalizedEmailValue);
            }
          }
        }
      }

      for (const person of allUsers) {
        const roleKey = (person.role || '').toLowerCase();
        if (roleKey !== 'user') continue;
        const personLeadName = normalizeName(person.teamLead || '');
        if (!personLeadName) continue;
        if (leadNameToEmail.has(personLeadName)) {
          const normalizedUserEmail = normalizeEmail(person.email);
          if (normalizedUserEmail) {
            experts.add(normalizedUserEmail);
          }
        }
      }

      const expertList = Array.from(experts).filter(Boolean);
      const result = await this.fetchCandidatesByExperts(user, expertList, options);
      result.options = {
        recruiterChoices: this.buildAssignablePeople(user),
        expertChoices: this.buildExpertChoices(expertList)
      };
      return result;
    }

    if (normalizedRole === 'lead') {
      const experts = new Set();
      experts.add(normalizeEmail(user.email));

      const leadName = normalizeName(formatDisplayName(user.email));
      const allUsers = userModel.getAllUsers();

      for (const person of allUsers) {
        const roleKey = (person.role || '').toLowerCase();
        if (roleKey !== 'user') continue;
        const personLeadName = normalizeName(person.teamLead || '');
        if (personLeadName === leadName) {
          experts.add(normalizeEmail(person.email));
        }
      }

      const expertList = Array.from(experts).filter(Boolean);
      const result = await this.fetchCandidatesByExperts(user, expertList, options);
      result.options = {
        recruiterChoices: this.buildAssignablePeople(user),
        expertChoices: this.buildExpertChoices(expertList)
      };
      return result;
    }

    if (normalizedRole === 'user') {
      const expertEmail = normalizeEmail(user.email);
      return this.fetchCandidatesByExperts(user, expertEmail ? [expertEmail] : [], options);
    }

    if (normalizedRole === 'recruiter') {
      const recruiterEmail = normalizeEmail(user.email);
      if (!recruiterEmail) {
        const error = new Error('Recruiter email is required');
        error.statusCode = 400;
        throw error;
      }
      const result = await this.fetchCandidatesByRecruiters(user, [recruiterEmail], options);
      result.options = {
        recruiterChoices: this.buildAssignablePeople(user)
      };
      return result;
    }

    if (normalizedRole === 'manager') {
      const limit = this.sanitizeLimit(options.limit);
      return {
        scope: {
          type: 'manager',
          value: normalizeEmail(user.email)
        },
        candidates: [],
        meta: {
          count: 0,
          appliedLimit: limit ?? null,
          hasSearch: false
        },
        options: {
          recruiterChoices: this.buildAssignablePeople(user)
        }
      };
    }

    const error = new Error('Access denied');
    error.statusCode = 403;
    throw error;
  }
}

export const candidateService = new CandidateService();
