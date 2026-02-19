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

  resolveHierarchyWatchers(candidate) {
    if (!candidate) return [];

    const watchers = new Set();

    // 1. Recruiter
    const recruiterEmail = formatEmail(candidate.recruiterRaw || candidate.Recruiter || candidate.recruiter || '');
    if (recruiterEmail) {
      watchers.add(recruiterEmail);

      // 2. MLead (Team Lead of Recruiter)
      const recruiterUser = userModel.getUserByEmail(recruiterEmail);
      if (recruiterUser && recruiterUser.teamLead) {
        const mleadEmail = this._findEmailByName(recruiterUser.teamLead);
        if (mleadEmail) {
          watchers.add(mleadEmail);

          // 3. MAM (Manager of MLead)
          const mleadUser = userModel.getUserByEmail(mleadEmail);
          if (mleadUser && mleadUser.manager) {
            const mamEmail = this._findEmailByName(mleadUser.manager);
            if (mamEmail) watchers.add(mamEmail);
          }
        }
      }
    }

    // 4. MM (Branch Head)
    if (candidate.Branch || candidate.branch) {
      // Reverse lookup from MM_BRANCH_MAP? Or assume fixed MM emails?
      // Map is: Email -> Branch. 
      // We can iterate map to find email for branch.
      const branch = (candidate.Branch || candidate.branch).toUpperCase();
      for (const [email, mappedBranch] of MM_BRANCH_MAP.entries()) {
        if (mappedBranch === branch) {
          watchers.add(email);
        }
      }
    }

    return Array.from(watchers);
  }

  resolveExpertHierarchy(expertEmail) {
    if (!expertEmail) return [];

    const watchers = new Set();
    const normalizedExpert = formatEmail(expertEmail);

    if (normalizedExpert) {
      watchers.add(normalizedExpert);

      // 1. Team Lead
      const expertUser = userModel.getUserByEmail(normalizedExpert);
      if (expertUser && expertUser.teamLead) {
        const leadEmail = this._findEmailByName(expertUser.teamLead);
        if (leadEmail) {
          watchers.add(leadEmail);

          // 2. AM (Manager of Team Lead)
          const leadUser = userModel.getUserByEmail(leadEmail);
          if (leadUser && leadUser.manager) {
            const amEmail = this._findEmailByName(leadUser.manager);
            if (amEmail) watchers.add(amEmail);
          }
        }
      }
    }
    return Array.from(watchers);
  }

  resolveAllWatchers(candidate) {
    if (!candidate) return [];

    const watchers = new Set();

    // 1. Recruitment Hierarchy
    const recruitmentWatchers = this.resolveHierarchyWatchers(candidate);
    recruitmentWatchers.forEach(email => watchers.add(email));

    // 2. Expert Hierarchy
    if (candidate.expert) {
      const expertWatchers = this.resolveExpertHierarchy(candidate.expert);
      expertWatchers.forEach(email => watchers.add(email));
    }

    // 3. Admins
    // Note: Fetching all users every time might be heavy but for now it's fine.
    // Optimization: Cache admin emails if performance drops.
    const allUsers = userModel.getAllUsers();
    for (const user of allUsers) {
      if ((user.role || '').toLowerCase() === 'admin') {
        const email = formatEmail(user.email);
        if (email) watchers.add(email);
      }
    }

    return Array.from(watchers);
  }

  _findEmailByName(name) {
    if (!name) return null;
    // If name looks like email, return it normalized
    if (name.includes('@')) return formatEmail(name);

    const normalize = (n) => n ? n.toString().trim().toLowerCase().replace(/\s+/g, ' ') : '';
    const target = normalize(name);

    const allUsers = userModel.getAllUsers();
    const found = allUsers.find(u => {
      // Check explicit displayName
      if (normalize(u.displayName) === target) return true;
      if (normalize(u.name) === target) return true; // Some models use name

      // Check derived from email
      const derived = normalize(deriveDisplayNameFromEmail(u.email));
      if (derived === target) return true;

      return false;
    });
    return found ? found.email : null;
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

    const recruiterEmail = formatEmail(candidate.recruiter ?? candidate.Recruiter ?? candidate.recruiterRaw ?? '');
    const recruiterDisplay = recruiterEmail ? formatDisplayName(recruiterEmail) : formatDisplayName(candidate.recruiter ?? candidate.Recruiter ?? '');
    const expertValue = candidate.expert ?? candidate.Expert ?? candidate.expertRaw ?? '';
    const expertDisplay = formatDisplayName(expertValue);
    const resumeLink = (candidate.resumeLink || '').toString().trim();

    return {
      ...candidate,
      name: toTitleCase(candidate.name ?? candidate['Candidate Name'] ?? ''),
      branch: candidate.branch ?? candidate.Branch ?? '',
      recruiter: recruiterDisplay,
      recruiterRaw: recruiterEmail,
      expert: expertDisplay,
      expertRaw: expertValue,
      Expert: expertValue, // Compatibility
      technology: formatTechnology(candidate.technology ?? candidate.Technology ?? ''),
      email: formatEmail(candidate.email ?? candidate['Email ID'] ?? ''),
      contact: candidate.contact ?? candidate['Contact No'] ?? '',
      workflowStatus: candidate.workflowStatus || WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: candidate.resumeUnderstandingStatus || RESUME_UNDERSTANDING_STATUS.pending,
      resumeUnderstanding: (candidate.resumeUnderstandingStatus || RESUME_UNDERSTANDING_STATUS.pending) === RESUME_UNDERSTANDING_STATUS.done,
      createdBy: candidate.createdBy || null,
      Recruiter: recruiterEmail, // Compatibility
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

    // Marketing / Branch Roles (Visibility Logic)
    if (['mm', 'mam', 'mlead', 'recruiter'].includes(normalizedRole)) {
      // STRICT FILTER: Only filter by resumeUnderstandingStatus
      const query = {
        resumeUnderstandingStatus: normalizedStatus
      };

      if (normalizedRole === ROLE_MM) {
        const branch = this.resolveBranchForMm(user.email, user.role);
        if (!branch) return [];

        // Add branch scope
        const candidates = await candidateModel.getCandidatesByBranch(branch, {
          limit: options?.limit,
          ...query // spread query to override or add to standard branch query
          // Note: getCandidatesByBranch usually takes specific named args.
          // We might need to pass custom query or ensure model supports it.
          // Let's rely on model's flexible filter support if available, or fall back to standard args if model is strict.
          // Checking model usage: getCandidatesByBranch(branch, { limit, workflowStatus, resumeUnderstandingStatus })
          // So passing resumeUnderstandingStatus matches model expectation.
        });
        return candidates;
      }

      if (normalizedRole === ROLE_MAM || normalizedRole === ROLE_MLEAD) {
        const hierarchy = this.collectHierarchyEmails(user);
        const normalizedEmail = normalizeEmail(user.email);
        let recruiterEmails = new Set();

        if (normalizedRole === ROLE_MAM) {
          recruiterEmails = new Set([
            ...hierarchy.recruiterEmails,
            ...hierarchy.allSubordinateEmails,
            normalizedEmail
          ]);
        } else {
          // MLEAD
          recruiterEmails = new Set([
            ...hierarchy.recruiterEmails,
            normalizedEmail
          ]);
        }

        const candidates = await candidateModel.getCandidatesByRecruiters(
          Array.from(recruiterEmails),
          {
            limit: options?.limit,
            resumeUnderstandingStatus: normalizedStatus,
            // DO NOT PASS workflowStatus here to unblock visibility
            visibility: this.buildRecruiterVisibility(Array.from(recruiterEmails), user)
          }
        );
        return candidates;
      }

      if (normalizedRole === 'recruiter') {
        const recruiterEmail = normalizeEmail(user.email);
        const candidates = await candidateModel.getCandidatesByRecruiters(
          [recruiterEmail],
          {
            limit: options?.limit,
            resumeUnderstandingStatus: normalizedStatus,
            visibility: this.buildRecruiterVisibility([recruiterEmail], user)
          }
        );
        return candidates;
      }
    }

    // Expert Roles (Lead, AM, Expert, User)
    if (['am', 'lead', 'expert', 'user'].includes(normalizedRole)) {
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
      const candidates = await candidateModel.getCandidatesByWorkflowStatus([workflowStatus]);
      return candidates.length;
    }

    // Marketing / Branch Roles (Visibility Logic)
    if (['mm', 'mam', 'mlead', 'recruiter'].includes(normalizedRole)) {
      // Since we don't have direct count methods for these permutations in CandidateModel yet without duplicating code,
      // and counts are typically fast enough with efficient queries, we can reuse the fetch methods or add specific Count methods.
      // For now, let's fetch IDs only? No, let's just use the Queue logic but we need count.
      // Better: Fetch and return length. It's not optimal but functional for this Refactor. 
      // Optimization: Add specific count methods later if needed, or rely on the query speed.

      // Actually, user requested "view", count is part of header.
      // Let's call getResumeUnderstandingQueue without limit and return length.
      try {
        const queue = await this.getResumeUnderstandingQueue(user, status, { limit: 0 }); // limit 0 might mean no limit? Models usually handle it. 
        // My implementation of getResumeUnderstandingQueue handles logic routing.
        // Check getResumeUnderstandingQueue implementation above.
        // It calls model methods which might not support 0 as unlimited if not coded. 
        // Model code: if (Number.isFinite(limit) && limit > 0) ...
        // So passing 0 or undefined -> unlimited.
        return queue.length;
      } catch (e) {
        return 0;
      }
    }

    // Expert Roles
    if (['am', 'lead', 'expert', 'user'].includes(normalizedRole)) {
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

  getCandidateChangeDetails(oldDoc, newDoc, changedFields) {
    const details = {
      changedFields,
      oldValue: {},
      newValue: {}
    };

    for (const field of changedFields) {
      // Handle mapping if keys differ in DB vs API (simple assumption: they match or are mapped)
      // Implementation assumes 'updates' keys match DB keys or are handled by model
      // We extract from doc assuming keys match. 
      // Note: updates keys might be different from doc keys if model maps them. 
      // For now, we trust changedFields are mostly direct.

      // Special handling for Status fields if needed, or simple equality
      details.oldValue[field] = oldDoc[field] ?? null;
      details.newValue[field] = newDoc[field] ?? null;

      // Attempt to resolve display names for known ID/Email fields
      if (['recruiter', 'expert', 'teamLead', 'manager'].includes(field)) {
        // Keep raw for reference
      }
    }
    return details;
  }

  async updateCandidate(user, candidateId, updates = {}) {
    if (!user?.email || !user?.role) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    const normalizedRole = user.role.trim().toLowerCase();

    // Validate RBAC for status updates
    if (updates.status !== undefined) {
      if (!['recruiter', 'mlead', 'mam', 'mm', 'admin', 'manager'].includes(normalizedRole)) {
        const error = new Error('Access denied. Only recruitment roles can update candidate status.');
        error.statusCode = 403;
        throw error;
      }
    }

    if (!candidateId) {
      const error = new Error('Candidate id is required');
      error.statusCode = 400;
      throw error;
    }

    const oldDoc = await candidateModel.getCandidateById(candidateId);
    if (!oldDoc) {
      const error = new Error('Candidate not found');
      error.statusCode = 404;
      throw error;
    }

    const updated = await candidateModel.updateCandidateById(candidateId, updates);

    logger.info('Candidate updated via updateCandidate', {
      candidateId,
      updatedBy: user.email,
      updates
    });

    const formatted = this.formatCandidateRecord(updated);

    // Filter changedFields to only include actual changes
    const changedFields = Object.keys(updates).filter(key => {
      const newVal = updates[key];
      const oldVal = oldDoc[key];
      // Simple equality check. For stricter check use deep equality if needed.
      return newVal != oldVal; // Loose equality to handle undefined/null mismatch if appropriate, or strict !==
    });

    // Generate change details (old vs new)
    const changeDetails = this.getCandidateChangeDetails(oldDoc, updated, changedFields);

    domainEventBus.publish(DomainEvents.CandidateUpdated, {
      eventId: crypto.randomUUID(),
      candidate: formatted,
      actor: {
        email: user.email,
        role: user.role,
        name: user.name || user.displayName || formatDisplayName(user.email)
      },
      changes: changedFields,
      changeDetails,
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

    // STRICT: Only MM and Admin can create via this flow.
    // Managers, Recruiters, MAM, MLead are Excluded.
    if (!['admin', 'mm'].includes(normalizedRole)) {
      const error = new Error('Access denied. Only Branch Heads (MM) can create candidates.');
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

    const recruitmentRoles = ['mm', 'mam', 'mlead', 'recruiter'];

    if (normalizedRole !== 'admin' && requester !== candidateExpert && !recruitmentRoles.includes(normalizedRole)) {
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
        const recruiters = new Set([
          ...hierarchy.recruiterEmails,
          normalizedEmail
        ]);
        const result = await this.fetchCandidatesByRecruiters(
          user,
          Array.from(recruiters),
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
