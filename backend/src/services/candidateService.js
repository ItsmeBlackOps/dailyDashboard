import crypto from 'node:crypto';
import { candidateModel, WORKFLOW_STATUS, RESUME_UNDERSTANDING_STATUS } from '../models/Candidate.js';
import { userModel } from '../models/User.js';
import { logger } from '../utils/logger.js';
import { domainEventBus } from '../events/eventBus.js';
import { DomainEvents } from '../events/eventTypes.js';
import { config } from '../config/index.js';
import { database } from '../config/database.js';
import { ObjectId } from 'mongodb';

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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeEmail(value) {
  return (value || '').trim().toLowerCase();
}

function capitalize(segment = '') {
  if (!segment) return '';
  return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
}

function deriveDisplayNameFromEmail(email) {
  const local = (email || '').split('@')[0];
  const parts = local.split(/[._\s-]+/).filter(Boolean);
  if (parts.length === 0) return email || '';
  return parts.map(capitalize).join(' ');
}

function normalizeName(value) {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function toTitleCase(value = '') {
  return value
    .toString()
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(' ');
}

function formatDisplayName(value = '') {
  if (!value) return '';
  if (value.includes('@')) {
    return deriveDisplayNameFromEmail(value);
  }
  return toTitleCase(value);
}

function formatTechnology(value = '') {
  if (!value) return '';
  return value
    .toString()
    .trim()
    .split(/\s+/)
    .map((segment) => segment.split('/').map(toTitleCase).join('/'))
    .join(' ');
}

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

  resolveResumeQueueExpertEmails(user) {
    if (!user?.email || !user?.role) {
      return [];
    }

    const teamEmails = userModel.getTeamEmails(
      user.email,
      user.role,
      user.teamLead
    );

    const fallbackEmail = formatEmail(user.email);
    const result = new Set();

    if (Array.isArray(teamEmails)) {
      for (const email of teamEmails) {
        const normalized = formatEmail(email);
        if (normalized) {
          result.add(normalized);
        }
      }
    }

    if (fallbackEmail) {
      result.add(fallbackEmail);
    }

    return Array.from(result);
  }

  resolveResumeUnderstandingWatchers(expertEmail) {
    const normalizedExpertEmail = formatEmail(expertEmail);
    if (!normalizedExpertEmail) {
      return [];
    }

    const watchers = new Set([normalizedExpertEmail]);
    const expertRecord = userModel.getUserByEmail(normalizedExpertEmail);

    const leadName = normalizeName(expertRecord?.teamLead || '');
    if (!leadName) {
      return Array.from(watchers);
    }

    const allUsers = userModel.getAllUsers();
    for (const person of allUsers) {
      if ((person.role || '').toLowerCase() !== 'lead') {
        continue;
      }

      const personName = normalizeName(formatDisplayName(person.email));
      if (personName === leadName) {
        const leadEmail = formatEmail(person.email);
        if (leadEmail) {
          watchers.add(leadEmail);
        }
      }
    }

    return Array.from(watchers);
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

  buildRecruiterVisibility(recruiterEmails, userForSelfPatterns = null) {
    const recruiterMatchers = new Set();
    const senderPatterns = new Set();
    const ccPatterns = new Set();

    const addRecruiterVariants = (value) => {
      const email = formatEmail(value || '');
      if (email) {
        recruiterMatchers.add(email);
        const local = email.split('@')[0];
        if (local) {
          recruiterMatchers.add(local);
        }
      }

      const displayName = formatDisplayName(value || '');
      if (displayName) {
        recruiterMatchers.add(displayName);
      }
    };

    recruiterEmails.forEach((email) => addRecruiterVariants(email));

    if (userForSelfPatterns?.email) {
      addRecruiterVariants(userForSelfPatterns.email);

      const normalizedEmail = formatEmail(userForSelfPatterns.email);
      if (normalizedEmail) {
        const local = normalizedEmail.split('@')[0];
        if (local) {
          const escapedLocal = escapeRegex(local);
          senderPatterns.add(escapedLocal);
          ccPatterns.add(escapedLocal);
        }

        const escapedEmail = escapeRegex(normalizedEmail);
        senderPatterns.add(escapedEmail);
        ccPatterns.add(escapedEmail);
      }

      const displayName = formatDisplayName(userForSelfPatterns.email);
      if (displayName) {
        const escapedName = escapeRegex(displayName);
        senderPatterns.add(escapedName);
        ccPatterns.add(escapedName);
      }
    }

    return {
      recruiterAliases: Array.from(recruiterMatchers).filter(Boolean),
      senderPatterns: Array.from(senderPatterns).filter(Boolean),
      ccPatterns: Array.from(ccPatterns).filter(Boolean)
    };
  }

  async fetchCandidatesByBranch(user, branch, options) {
    const searchPattern = this.buildSearchPattern(options.search);

    const candidates = await candidateModel.getCandidatesByBranch(branch, {
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
        hasSearch: Boolean(searchPattern)
      }
    };
  }

  async fetchCandidatesByRecruiters(user, recruiterEmails, options = {}) {
    if (!recruiterEmails.length) {
      const error = new Error('No recruiters mapped to current user');
      error.statusCode = 403;
      throw error;
    }

    const { includeSelfPatterns = false, search } = options;
    const searchPattern = this.buildSearchPattern(search);

    const visibility = this.buildRecruiterVisibility(
      recruiterEmails,
      includeSelfPatterns ? user : null
    );

    const candidates = await candidateModel.getCandidatesByRecruiters(recruiterEmails, {
      search: searchPattern,
      visibility
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
        hasSearch: Boolean(searchPattern)
      }
    };
  }

  async fetchAllCandidates(user, options) {
    const searchPattern = this.buildSearchPattern(options.search);

    const candidates = await candidateModel.getAllCandidates({
      search: searchPattern
    });

    const formattedCandidates = candidates.map((candidate) => this.formatCandidateRecord(candidate));

    logger.info('Admin candidates retrieved', {
      userEmail: user.email,
      returned: candidates.length,
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
        hasSearch: Boolean(searchPattern)
      },
      options: {
        recruiterChoices: this.buildAssignablePeople(user),
        expertChoices: this.buildExpertChoices(expertEmails)
      }
    };
  }

  async fetchCandidatesByExperts(user, expertEmails, options) {
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
          hasSearch: Boolean(searchPattern)
        }
      };
    }

    const candidates = await candidateModel.getCandidatesByExperts(expertEmails, {
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
    const resumeLink = (candidate.resumeLink || '').toString().trim();

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
      createdBy: candidate.createdBy || null,
      resumeLink
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

    const candidates = await candidateModel.getCandidatesByWorkflowStatus(
      [
        WORKFLOW_STATUS.awaitingExpert,
        WORKFLOW_STATUS.needsResumeUnderstanding
      ]
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

  async getPendingExpertAssignmentCount(user) {
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

    return candidateModel.countCandidatesByWorkflowStatuses([
      WORKFLOW_STATUS.awaitingExpert,
      WORKFLOW_STATUS.needsResumeUnderstanding
    ]);
  }

  async getResumeUnderstandingQueue(user, status = RESUME_UNDERSTANDING_STATUS.pending, options = {}) {
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
      const candidates = await candidateModel.getCandidatesByWorkflowStatus(
        normalizedStatus === RESUME_UNDERSTANDING_STATUS.done
          ? WORKFLOW_STATUS.completed
          : WORKFLOW_STATUS.needsResumeUnderstanding
      );

      return candidates.map((candidate) => this.formatCandidateRecord(candidate));
    }

    if (normalizedRole === 'am' || normalizedRole === 'lead' || normalizedRole === 'expert' || normalizedRole === 'user') {
      const expertEmails = this.resolveResumeQueueExpertEmails(user);

      if (expertEmails.length === 0) {
        return [];
      }

      const limitOption = Number.isFinite(options?.limit) && options.limit > 0
        ? Math.floor(options.limit)
        : undefined;

      let candidates;
      if (expertEmails.length === 1) {
        candidates = await candidateModel.getCandidatesForExpert(
          expertEmails[0],
          normalizedStatus,
          { limit: limitOption }
        );
      } else {
        candidates = await candidateModel.getCandidatesByExperts(
          expertEmails,
          {
            status: normalizedStatus,
            limit: limitOption
          }
        );
      }

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
      const candidates = await candidateModel.getCandidatesByWorkflowStatus(workflowStatus);
      return candidates.length;
    }

    if (normalizedRole === 'am' || normalizedRole === 'lead' || normalizedRole === 'expert' || normalizedRole === 'user') {
      const expertEmails = this.resolveResumeQueueExpertEmails(user);
      if (expertEmails.length === 0) {
        return 0;
      }
      if (expertEmails.length === 1) {
        return candidateModel.countResumeUnderstandingTasks(expertEmails[0], normalizedStatus);
      }
      return candidateModel.countResumeUnderstandingTasksForExperts(expertEmails, normalizedStatus);
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
        // If number starts with +1 and has 10 digits after it
        if (/^\+1\d{10}$/.test(rawContact)) {
          sanitized.contact = rawContact;
        } else {
          // Strip all non-digits
          const digitsOnly = rawContact.replace(/[^0-9]/g, '');

          if (digitsOnly.length !== 10) {
            const error = new Error('Contact number must be 10 digits');
            error.statusCode = 400;
            throw error;
          }

          sanitized.contact = `+1${digitsOnly}`;
        }
      }
    }

    if (payload.resumeLink !== undefined) {
      const linkValue = payload.resumeLink?.toString?.().trim() || '';

      if (!linkValue) {
        sanitized.resumeLink = '';
      } else {
        let parsed;
        try {
          parsed = new URL(linkValue);
        } catch (error) {
          const invalidError = new Error('Resume link must be a valid URL');
          invalidError.statusCode = 400;
          throw invalidError;
        }

        if (parsed.protocol !== 'https:') {
          const protocolError = new Error('Resume link must use HTTPS');
          protocolError.statusCode = 400;
          throw protocolError;
        }

        const storageConfig = config.storage || {};
        const expectedPrefix = storageConfig.publicUrl && storageConfig.bucket
          ? `${storageConfig.publicUrl}/${storageConfig.bucket}/`
          : null;

        if (expectedPrefix && !linkValue.startsWith(expectedPrefix)) {
          const domainError = new Error('Resume link must use the configured storage domain');
          domainError.statusCode = 400;
          throw domainError;
        }

        sanitized.resumeLink = parsed.toString();
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
    if (!['mm', 'mam', 'mlead', 'recruiter', 'lead', 'am', 'admin'].includes(normalizedRole)) {
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
      const allowedKeys = ['name', 'email', 'contact', 'technology'];
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

    const changedFields = Object.keys(sanitizedPayload);

    if (changedFields.length === 0) {
      const error = new Error('No changes provided');
      error.statusCode = 400;
      throw error;
    }

    const updated = await candidateModel.updateCandidateById(candidateId, sanitizedPayload);

    logger.info('Candidate updated', {
      candidateId,
      updatedBy: user.email,
      fields: changedFields
    });

    const formatted = this.formatCandidateRecord(updated);

    domainEventBus.publish(DomainEvents.CandidateUpdated, {
      eventId: crypto.randomUUID(),
      candidate: formatted,
      actor: {
        email: user.email,
        role: user.role
      },
      changes: changedFields,
      occurredAt: new Date().toISOString()
    });

    return formatted;
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

    if (!sanitized.resumeLink) {
      const error = new Error('Resume link is required');
      error.statusCode = 400;
      throw error;
    }

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

    const formatted = this.formatCandidateRecord(document);

    domainEventBus.publish(DomainEvents.CandidateCreated, {
      eventId: crypto.randomUUID(),
      candidate: formatted,
      actor: {
        email: user.email,
        role: user.role
      },
      occurredAt: new Date().toISOString()
    });

    return formatted;
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
    const formatted = this.formatCandidateRecord(updated);

    domainEventBus.publish(DomainEvents.CandidateExpertAssigned, {
      eventId: crypto.randomUUID(),
      candidate: formatted,
      actor: {
        email: user.email,
        role: user.role
      },
      occurredAt: new Date().toISOString()
    });

    return formatted;
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
    const formatted = this.formatCandidateRecord(updated);

    domainEventBus.publish(DomainEvents.CandidateResumeStatusChanged, {
      eventId: crypto.randomUUID(),
      candidate: formatted,
      actor: {
        email: user.email,
        role: user.role
      },
      status,
      occurredAt: new Date().toISOString()
    });

    return formatted;
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
        const result = await this.fetchCandidatesByRecruiters(
          user,
          Array.from(recruiterEmails),
          { ...options, includeSelfPatterns: true }
        );
        result.options = {
          recruiterChoices: this.buildAssignablePeople(user)
        };
        return result;
      }

      if (normalizedRole === ROLE_MLEAD) {
        const recruiters = hierarchy.recruiterEmails.size
          ? Array.from(hierarchy.recruiterEmails)
          : [normalizedEmail];
        const result = await this.fetchCandidatesByRecruiters(
          user,
          recruiters,
          { ...options, includeSelfPatterns: true }
        );
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
      const result = await this.fetchCandidatesByRecruiters(
        user,
        [recruiterEmail],
        { ...options, includeSelfPatterns: true }
      );
      result.options = {
        recruiterChoices: this.buildAssignablePeople(user)
      };
      return result;
    }

    if (normalizedRole === 'manager') {
      return {
        scope: {
          type: 'manager',
          value: normalizeEmail(user.email)
        },
        candidates: [],
        meta: {
          count: 0,
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
  async getComments(user, candidateId) {
    if (!user?.email || !user?.role) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    const normalizedRole = user.role.trim().toLowerCase();
    const query = { candidateId: new ObjectId(candidateId) };

    // Experts cannot see complaints
    if (normalizedRole === 'expert' || normalizedRole === 'user') {
      query.type = { $ne: 'complaint' };
    }

    const comments = await database.getCollection('candidatecomments')
      .find(query)
      .sort({ createdAt: 1 })
      .toArray();

    return comments.map(c => ({
      id: c._id,
      author: c.author,
      content: c.content,
      type: c.type,
      createdAt: c.createdAt
    }));
  }

  async getCandidateById(user, candidateId) {
    if (!user?.email || !user?.role) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    if (!candidateId) {
      const error = new Error('Candidate id is required');
      error.statusCode = 400;
      throw error;
    }

    // Role check - similar to other read methods if needed, but for now we follow the pattern
    // that general users can read candidates.
    // If strict role check is needed, we can reuse logic from other methods.
    // However, since the socket handler calls this for notifications, and notifications are triggered by an action
    // allowed by the user, we assume read access is implicit or acceptable.

    const candidate = await candidateModel.getCandidateById(candidateId);
    if (!candidate) return null;

    return this.formatCandidateRecord(candidate);
  }

  async addComment(user, candidateId, content, type = 'internal') {
    if (!user?.email || !user?.role) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    if (!content || !content.trim()) {
      const error = new Error('Comment content is required');
      error.statusCode = 400;
      throw error;
    }

    const normalizedRole = user.role.trim().toLowerCase();

    // Only Recruiter side or Admins/Managers can create complaints
    const canCreateComplaint = ['recruiter', 'mlead', 'mam', 'mm', 'admin', 'manager'].includes(normalizedRole);

    if (type === 'complaint' && !canCreateComplaint) {
      // Ideally throw error, or force type to internal. Let's force to internal for safety? 
      // Or throw 403. Let's throw error.
      const error = new Error('You are not authorized to create complaint comments');
      error.statusCode = 403;
      throw error;
    }

    const newComment = {
      candidateId: new ObjectId(candidateId),
      author: {
        email: user.email,
        name: formatDisplayName(user.email),
        role: user.role
      },
      content: content.trim(),
      type: type,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await database.getCollection('candidatecomments').insertOne(newComment);

    return {
      id: result.insertedId,
      author: newComment.author,
      content: newComment.content,
      type: newComment.type,
      createdAt: newComment.createdAt
    };
  }
}

export const candidateService = new CandidateService();
