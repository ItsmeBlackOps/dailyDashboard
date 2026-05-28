import crypto from 'node:crypto';
import {
  candidateModel,
  WORKFLOW_STATUS,
  RESUME_UNDERSTANDING_STATUS,
  STATUS_VALUES,
  STATUS_ALIASES,
  TECHNOLOGY_VALUES,
  VISA_TYPE_VALUES,
  EAD_REQUIRED_VISA_TYPES,
  COMPANY_VALUES,
  ACK_EMAIL_VALUES,
  CANDIDATE_AUDITED
} from '../models/Candidate.js';

// PRT scope: only marketing manager / AM / admin may WRITE PRT fields.
// Marketing READ access (mm/mam/mlead/recruiter/admin) is enforced by
// the PRT visibility filter on read paths (see _applyPrtVisibility).
const PRT_WRITABLE_FIELDS = [
  'teamLead', 'experienceYears', 'visaType', 'eadStartDate', 'eadEndDate',
  'company', 'city', 'state', 'ackEmail'
];
const PRT_WRITE_ROLES = new Set(['admin', 'mm', 'mam']);

// Fields stripped from the formatted candidate when the requester is NOT
// in the marketing track. Includes both stored fields and derived getters
// computed by formatCandidateRecord. Technical track (lead/am/expert/user)
// sees the candidate exactly as before — no PRT surface area.
const PRT_VISIBLE_FIELDS = [
  'teamLead', 'experienceYears', 'visaType',
  'eadStartDate', 'eadEndDate',
  'company', 'city', 'state',
  'ackEmail', 'ackEmailAt',
  'marketingStartDate',
  'attachments', 'editHistory', 'assignmentEmails',
  'expiringInDays', 'daysInMarketing'
];
const PRT_READ_ROLES = new Set(['admin', 'mm', 'mam', 'mlead', 'recruiter']);

// PRT Phase 2: attachment operations (upload / remove / set-as-resume).
// Broader than PRT_WRITE_ROLES because the operational reality is that
// recruiters handle their candidates' documents day-to-day. Scope is
// always validated through assertRecruiterInScope on the candidate's
// own recruiter so cross-team access is still blocked.
const PRT_ATTACHMENT_ROLES = new Set([
  'admin', 'mm', 'mam', 'mlead', 'recruiter'
]);
import { userModel } from '../models/User.js';
import { userService, roleLevel } from './userService.js';
import { storageService } from './storageService.js';
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
const ALLOWED_BRANCH_VALUES = ['GGR', 'LKN', 'AHM'];
const ALLOWED_BRANCHES = new Set(ALLOWED_BRANCH_VALUES);
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
  getAllowedBranches() {
    return [...ALLOWED_BRANCH_VALUES];
  }

  normalizeAndValidateBranch(rawBranch) {
    const branch = String(rawBranch || '').trim().toUpperCase();
    if (!branch) {
      const error = new Error('Branch is required');
      error.statusCode = 400;
      throw error;
    }

    if (!ALLOWED_BRANCHES.has(branch)) {
      logger.warn('Invalid branch value rejected', { branch });
      const error = new Error(`Branch must be one of ${ALLOWED_BRANCH_VALUES.join(', ')}`);
      error.statusCode = 400;
      throw error;
    }

    return branch;
  }

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

  resolveMmForMam(user) {
    if (!user?.email || (user.role || '').trim().toLowerCase() !== ROLE_MAM) {
      return null;
    }

    const mamEmail = normalizeEmail(user.email);
    const mamRecord = userModel.getUserByEmail(mamEmail);
    const managerRef = mamRecord?.manager || user.manager || '';

    if (!managerRef) {
      logger.warn('Unable to resolve MM for MAM: missing manager reference', { mamEmail });
      return null;
    }

    const resolvedManagerEmail = normalizeEmail(this._findEmailByName(managerRef) || managerRef);
    if (!resolvedManagerEmail) {
      logger.warn('Unable to resolve MM for MAM: manager reference not mappable', {
        mamEmail,
        managerRef
      });
      return null;
    }

    const managerRecord = userModel.getUserByEmail(resolvedManagerEmail);
    // Match the MM by role *level*: roleLevel() maps both the legacy 'mm'
    // and the post-rename 'manager' to 'manager', so MAM branch resolution
    // works with the new role names (manager/assistantManager + team)
    // without hardcoding legacy string lists.
    if (roleLevel(managerRecord?.role) !== 'manager') {
      logger.warn('Unable to resolve MM for MAM: manager role is not MM', {
        mamEmail,
        managerEmail: resolvedManagerEmail,
        managerRole: managerRecord?.role || null
      });
      return null;
    }

    return resolvedManagerEmail;
  }

  resolveDefaultBranchForMam(user) {
    const mmEmail = this.resolveMmForMam(user);
    if (!mmEmail) {
      return {
        mmEmail: null,
        branch: null,
        reason: 'MAM to MM mapping is missing. Contact admin.'
      };
    }

    const branch = this.resolveBranchForMm(mmEmail, ROLE_MM);
    if (!branch) {
      logger.warn('Unable to resolve default branch for MAM: MM branch mapping missing', {
        mamEmail: normalizeEmail(user?.email || ''),
        mmEmail
      });
      return {
        mmEmail,
        branch: null,
        reason: 'MM branch mapping is missing. Contact admin.'
      };
    }

    logger.info('Resolved default branch for MAM', {
      mamEmail: normalizeEmail(user?.email || ''),
      mmEmail,
      branch
    });

    return {
      mmEmail,
      branch,
      reason: null
    };
  }

  buildCreatePolicy(user) {
    const normalizedRole = (user?.role || '').toLowerCase();
    const policy = {
      allowedBranches: this.getAllowedBranches(),
      defaultBranch: null,
      branchReadOnly: false,
      canCreate: true
    };

    if (normalizedRole === ROLE_MAM) {
      const resolution = this.resolveDefaultBranchForMam(user);
      policy.defaultBranch = resolution.branch;
      policy.branchReadOnly = true;
      policy.canCreate = Boolean(resolution.branch);
      if (!resolution.branch && resolution.reason) {
        policy.reason = resolution.reason;
      }
    }

    return policy;
  }

  buildCandidateOptions(user, extras = {}) {
    return {
      recruiterChoices: this.buildAssignablePeople(user),
      createPolicy: this.buildCreatePolicy(user),
      ...extras
    };
  }

  // C19 phase 2b — async + delegation-aware. Same pattern as
  // userService.isUserInRequesterHierarchy: walk the requester's own
  // subtree, then union in any active delegations TO the requester.
  // `subtree` shares expand to a BFS rooted at the share's
  // subtreeRootEmail; `specific` shares contribute their subjectEmails.
  async collectHierarchyEmails(user) {
    const allUsers = userModel.getAllUsers();

    // Pre-build leadDisplayName → [reports] map; reused for the
    // requester's BFS and any subtree-scoped delegations.
    const leadToUsers = new Map();
    for (const candidate of allUsers) {
      if (!candidate.teamLead) continue;
      const leadName = normalizeName(candidate.teamLead);
      if (!leadToUsers.has(leadName)) {
        leadToUsers.set(leadName, []);
      }
      leadToUsers.get(leadName).push(candidate);
    }

    const allSubordinateEmails = new Set();
    const recruiterEmails = new Set();

    // BFS helper — walks teamLead chain rooted at a display name,
    // adding emails to the running sets. Visited set is local so each
    // root is independently traversed (admins-of-admins etc.).
    const walkSubtree = (rootDisplayName) => {
      if (!rootDisplayName) return;
      const visitedLeads = new Set();
      const queue = [rootDisplayName];
      while (queue.length > 0) {
        const currentLead = queue.shift();
        if (!currentLead || visitedLeads.has(currentLead)) continue;
        visitedLeads.add(currentLead);
        const directReports = leadToUsers.get(currentLead) || [];
        for (const report of directReports) {
          const reportEmail = normalizeEmail(report.email);
          if (reportEmail) allSubordinateEmails.add(reportEmail);
          const reportRole = (report.role || '').toLowerCase();
          if (reportRole === 'recruiter') recruiterEmails.add(reportEmail);
          const reportDisplayName = normalizeName(deriveDisplayNameFromEmail(report.email));
          if (reportDisplayName && !visitedLeads.has(reportDisplayName)) {
            queue.push(reportDisplayName);
          }
        }
      }
    };

    // 1. Requester's own subtree.
    walkSubtree(normalizeName(deriveDisplayNameFromEmail(user.email)));

    // 2. Active delegations TO the requester. Lazy import for
    //    consistency with the userService BFS — avoids any chance of
    //    a load-order cycle. Failure here doesn't break the requester's
    //    own scope; logged so an outage is visible.
    try {
      const { delegationService } = await import('./delegationService.js');
      const delegations = await delegationService.listActiveForUser(user.email);
      for (const d of delegations) {
        if (d.scope === 'specific') {
          for (const email of (d.subjectEmails || [])) {
            const normalized = normalizeEmail(email);
            if (!normalized) continue;
            allSubordinateEmails.add(normalized);
            // Look up the actual role to decide if it's a recruiter
            const subject = allUsers.find((u) => normalizeEmail(u.email) === normalized);
            if (subject && (subject.role || '').toLowerCase() === 'recruiter') {
              recruiterEmails.add(normalized);
            }
          }
        } else if (d.scope === 'subtree') {
          const root = (d.subtreeRootEmail || '').toLowerCase();
          if (!root) continue;
          // Include the root itself (a subtree share grants access to
          // everyone in the tree, including the root user).
          allSubordinateEmails.add(root);
          const rootDisplay = normalizeName(deriveDisplayNameFromEmail(root));
          walkSubtree(rootDisplay);
        }
      }
    } catch (err) {
      logger.warn('candidateService.collectHierarchyEmails: delegation union failed', {
        error: err.message, requester: user.email,
      });
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

    const formattedCandidates = candidates.map((candidate) => this.formatCandidateRecord(candidate, user));

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

    const formattedCandidates = candidates.map((candidate) => this.formatCandidateRecord(candidate, user));

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

    const formattedCandidates = candidates.map((candidate) => this.formatCandidateRecord(candidate, user));

    logger.info('Admin candidates retrieved', {
      userEmail: user.email,
      returned: candidates.length,
      hasSearch: Boolean(searchPattern)
    });

    const allUsers = userModel.getAllUsers();
    const expertEmails = allUsers
      .filter((person) => {
        const role = (person.role || '').toLowerCase();
        if (['lead', 'am', 'expert', 'user'].includes(role)) return true;
        // Post-rename teamLead+team:'technical' is the structural equivalent
        // of legacy 'lead' — keep them in the Expert pool by default.
        const team = (person.team || '').toLowerCase();
        if (role === 'teamlead' && team === 'technical') return true;
        return false;
      })
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
      options: this.buildCandidateOptions(user, {
        expertChoices: this.buildExpertChoices(expertEmails)
      })
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

    const formattedCandidates = candidates.map((candidate) => this.formatCandidateRecord(candidate, user));

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

  // Optional `user` arg drives the PRT visibility strip: when provided
  // and non-marketing, the formatted record is post-processed to remove
  // PRT-only fields. External callers (e.g. supportRequestService) can
  // continue to call this with one arg for full-fidelity data.
  formatCandidateRecord(candidate, user = null) {
    if (!candidate) {
      const emptyFormatted = {
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
      return this._applyPrtVisibility(emptyFormatted, user);
    }

    const recruiterEmail = formatEmail(candidate.recruiter ?? candidate.Recruiter ?? candidate.recruiterRaw ?? '');
    const recruiterDisplay = recruiterEmail ? formatDisplayName(recruiterEmail) : formatDisplayName(candidate.recruiter ?? candidate.Recruiter ?? '');
    const expertValue = candidate.expert ?? candidate.Expert ?? candidate.expertRaw ?? '';
    const expertDisplay = formatDisplayName(expertValue);
    const resumeLink = (candidate.resumeLink || '').toString().trim();

    // PRT derived getters: re-evaluated on every read so the value is
    // always current. The daily candidateAlertScheduler will additionally
    // $set these on the doc for index-backed range queries (Phase 4).
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const toDateOrNull = (v) => {
      if (v === null || v === undefined || v === '') return null;
      if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
      const parsed = new Date(v);
      return isNaN(parsed.getTime()) ? null : parsed;
    };
    const now = new Date();
    const eadEndDate = toDateOrNull(candidate.eadEndDate);
    const marketingStartDate = toDateOrNull(candidate.marketingStartDate);
    const expiringInDays = eadEndDate
      ? Math.floor((eadEndDate.getTime() - now.getTime()) / MS_PER_DAY)
      : null;
    const daysInMarketing = marketingStartDate
      ? Math.floor((now.getTime() - marketingStartDate.getTime()) / MS_PER_DAY)
      : null;

    const formatted = {
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
      resumeLink,
      // PRT projections (normalised) + derived
      teamLead: candidate.teamLead ?? null,
      experienceYears: candidate.experienceYears ?? null,
      visaType: candidate.visaType ?? null,
      eadStartDate: toDateOrNull(candidate.eadStartDate),
      eadEndDate,
      company: candidate.company ?? null,
      city: candidate.city ?? null,
      state: candidate.state ?? null,
      ackEmail: candidate.ackEmail ?? null,
      ackEmailAt: toDateOrNull(candidate.ackEmailAt),
      marketingStartDate,
      attachments: Array.isArray(candidate.attachments) ? candidate.attachments : [],
      editHistory: Array.isArray(candidate.editHistory) ? candidate.editHistory : [],
      assignmentEmails: Array.isArray(candidate.assignmentEmails) ? candidate.assignmentEmails : [],
      expiringInDays,
      daysInMarketing
    };
    return this._applyPrtVisibility(formatted, user);
  }

  // PRT: strip PRT fields from a formatted candidate when the requester
  // is NOT in the marketing track. Marketing readers (admin/mm/mam/mlead/
  // recruiter) see the full surface. Non-marketing readers (am/lead/
  // expert/user) see exactly the legacy projection — no behaviour change
  // for them. Safe with missing user (no-op).
  _applyPrtVisibility(formatted, user) {
    if (!formatted || typeof formatted !== 'object') return formatted;
    const role = (user?.role || '').toString().toLowerCase().trim();
    if (!role || PRT_READ_ROLES.has(role)) return formatted;
    const stripped = { ...formatted };
    for (const f of PRT_VISIBLE_FIELDS) {
      delete stripped[f];
    }
    return stripped;
  }

  _applyPrtVisibilityToList(list, user) {
    if (!Array.isArray(list)) return list;
    const role = (user?.role || '').toString().toLowerCase().trim();
    if (!role || PRT_READ_ROLES.has(role)) return list;
    return list.map((c) => this._applyPrtVisibility(c, user));
  }

  buildAssignablePeople(user) {
    const inScopeActiveEmails = this.resolveActiveHierarchyEmails(user);
    const options = Array.from(inScopeActiveEmails)
      .map((email) => ({
        value: email,
        label: formatDisplayName(email)
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    logger.debug('Built hierarchy-scoped recruiter choices', {
      userEmail: normalizeEmail(user?.email || ''),
      role: (user?.role || '').toLowerCase(),
      count: options.length
    });

    return options;
  }

  resolveActiveHierarchyEmails(user) {
    const emailSet = new Set();

    const addEmail = (rawEmail) => {
      const normalized = formatEmail(rawEmail || '');
      if (normalized) {
        emailSet.add(normalized);
      }
    };

    if (!user?.email) {
      return emailSet;
    }

    const manageableUsers = userService.collectManageableUsers(user);
    for (const person of manageableUsers) {
      if (person?.active === false) continue;
      addEmail(person.email);
    }

    const selfRecord = userModel.getUserByEmail(user.email);
    if (selfRecord?.active === false) {
      return emailSet;
    }
    addEmail(user.email);

    return emailSet;
  }

  assertRecruiterInScope(user, recruiterEmail) {
    const normalizedRecruiterEmail = formatEmail(recruiterEmail || '');
    const allowedRecruiters = this.resolveActiveHierarchyEmails(user);

    if (!normalizedRecruiterEmail || !allowedRecruiters.has(normalizedRecruiterEmail)) {
      logger.warn('Recruiter out-of-scope for candidate creation', {
        userEmail: normalizeEmail(user?.email || ''),
        userRole: (user?.role || '').toLowerCase(),
        recruiterEmail: normalizedRecruiterEmail || null,
        allowedCount: allowedRecruiters.size
      });
      const error = new Error('Recruiter must be an active user in your hierarchy or yourself');
      error.statusCode = 403;
      throw error;
    }
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
    if (!['admin', 'mm'].includes(normalizedRole)) {
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

    const formattedCandidates = candidates.map((candidate) => this.formatCandidateRecord(candidate, user));

    const allUsers = userModel.getAllUsers();
    const expertEmails = allUsers
      .filter((person) => {
        const role = (person.role || '').toLowerCase();
        if (['lead', 'am', 'expert', 'user'].includes(role)) return true;
        // Post-rename teamLead+team:'technical' is the structural equivalent
        // of legacy 'lead' — keep them in the Expert pool by default.
        const team = (person.team || '').toLowerCase();
        if (role === 'teamlead' && team === 'technical') return true;
        return false;
      })
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
    if (!['admin', 'mm'].includes(normalizedRole)) {
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

    if (normalizedRole === 'admin' || normalizedRole === 'mm') {
      const candidates = await candidateModel.getCandidatesByWorkflowStatus(
        normalizedStatus === RESUME_UNDERSTANDING_STATUS.done
          ? WORKFLOW_STATUS.completed
          : WORKFLOW_STATUS.needsResumeUnderstanding
      );

      return candidates.map((candidate) => this.formatCandidateRecord(candidate, user));
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
        const hierarchy = await this.collectHierarchyEmails(user);
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

      return candidates.map((candidate) => this.formatCandidateRecord(candidate, user));
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

    if (normalizedRole === 'admin' || normalizedRole === 'mm') {
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
      sanitized.branch = this.normalizeAndValidateBranch(payload.branch);
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


    // ----- PRT (Placement & Recruiter Tracker) fields -----

    if (payload.status !== undefined) {
      let s = (payload.status || '').toString().trim();
      const alias = STATUS_ALIASES.get(s.toLowerCase());
      if (alias) s = alias;
      if (!STATUS_VALUES.includes(s)) {
        const error = new Error(`Status must be one of ${STATUS_VALUES.join(', ')}`);
        error.statusCode = 400;
        throw error;
      }
      sanitized.status = s;
    }

    if (payload.visaType !== undefined) {
      const v = (payload.visaType || '').toString().trim();
      if (!VISA_TYPE_VALUES.includes(v)) {
        const error = new Error(`Visa Type must be one of ${VISA_TYPE_VALUES.join(', ')}`);
        error.statusCode = 400;
        throw error;
      }
      sanitized.visaType = v;
    }

    if (payload.experienceYears !== undefined) {
      const n = Number(payload.experienceYears);
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        const error = new Error('Experience Years must be an integer between 1 and 20');
        error.statusCode = 400;
        throw error;
      }
      sanitized.experienceYears = n;
    }

    if (payload.company !== undefined) {
      const c = (payload.company || '').toString().trim().toUpperCase();
      if (!COMPANY_VALUES.includes(c)) {
        const error = new Error(`Company must be one of ${COMPANY_VALUES.join(', ')}`);
        error.statusCode = 400;
        throw error;
      }
      sanitized.company = c;
    }

    if (payload.ackEmail !== undefined) {
      const a = (payload.ackEmail || '').toString().trim();
      if (!ACK_EMAIL_VALUES.includes(a)) {
        const error = new Error(`Ack Email must be one of ${ACK_EMAIL_VALUES.join(', ')}`);
        error.statusCode = 400;
        throw error;
      }
      sanitized.ackEmail = a;
    }

    if (payload.city !== undefined) {
      sanitized.city = (payload.city ?? '').toString().trim();
    }

    if (payload.state !== undefined) {
      sanitized.state = (payload.state ?? '').toString().trim();
    }

    if (payload.teamLead !== undefined) {
      const tl = formatEmail(payload.teamLead);
      if (!tl || !EMAIL_REGEX.test(tl)) {
        const error = new Error('Invalid team lead email');
        error.statusCode = 400;
        throw error;
      }
      sanitized.teamLead = tl;
    }

    // EAD dates — conditional on visaType. Required when the candidate's
    // visa carries an EAD card (see EAD_REQUIRED_VISA_TYPES). EAD End must
    // be strictly after EAD Start.
    const effectiveVisaType = sanitized.visaType ?? payload.visaType;
    const eadRequiredByVisa = !!effectiveVisaType && EAD_REQUIRED_VISA_TYPES.has(effectiveVisaType);

    if (payload.eadStartDate !== undefined || eadRequiredByVisa) {
      const startRaw = payload.eadStartDate;
      if (startRaw === null || startRaw === undefined || startRaw === '') {
        if (eadRequiredByVisa) {
          const error = new Error(`EAD Start Date is required for visa type ${effectiveVisaType}`);
          error.statusCode = 400;
          throw error;
        }
      } else {
        const start = new Date(startRaw);
        if (Number.isNaN(start.getTime())) {
          const error = new Error('Invalid EAD Start Date');
          error.statusCode = 400;
          throw error;
        }
        sanitized.eadStartDate = start;
      }
    }

    if (sanitized.eadStartDate || payload.eadEndDate !== undefined) {
      const endRaw = payload.eadEndDate;
      if (endRaw === null || endRaw === undefined || endRaw === '') {
        if (sanitized.eadStartDate) {
          const error = new Error('EAD End Date is required when EAD Start Date is set');
          error.statusCode = 400;
          throw error;
        }
      } else {
        const end = new Date(endRaw);
        if (Number.isNaN(end.getTime())) {
          const error = new Error('Invalid EAD End Date');
          error.statusCode = 400;
          throw error;
        }
        if (sanitized.eadStartDate && end.getTime() <= sanitized.eadStartDate.getTime()) {
          const error = new Error('EAD End Date must be after EAD Start Date');
          error.statusCode = 400;
          throw error;
        }
        sanitized.eadEndDate = end;
      }
    }

    // Technology — warn-only for unknown values during the 60-day
    // transition. Existing free-text values flow through; new creates
    // should pick from TECHNOLOGY_VALUES. After the window this becomes
    // a hard reject.
    if (sanitized.technology && !TECHNOLOGY_VALUES.includes(sanitized.technology)) {
      logger.warn('Unknown technology value (60-day grace period)', {
        technology: sanitized.technology
      });
    }

    // marketingStartDate is server-set on first save and immutable
    // thereafter; the sanitizer never accepts it from the client payload.

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
      const allowedKeys = ['name', 'email', 'contact', 'technology', 'resumeLink'];
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

    const formatted = this.formatCandidateRecord(updated, user);

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
      if (!['recruiter', 'mlead', 'mam', 'mm', 'admin'].includes(normalizedRole)) {
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

    // ----- PRT: sanitize updates + gate PRT-field writes to marketing roles -----
    // The sanitizer validates enums (PO→Placement Offer alias, visaType,
    // company, ackEmail, etc.), enforces the conditional EAD requirement,
    // and normalises dates. We merge so internal fields added below
    // (poDate, _changedBy, _source) and any unknown caller fields pass
    // through unchanged.
    const sanitizedUpdates = this.sanitizeCandidatePayload(updates);
    updates = { ...updates, ...sanitizedUpdates };

    // Only marketing manager / AM / admin may write PRT fields. Other
    // roles (recruiter, mlead, am, lead, expert, user) get a 403. This
    // does NOT touch the legacy-fields permission model — those keep
    // their previous behaviour.
    for (const f of PRT_WRITABLE_FIELDS) {
      if (sanitizedUpdates[f] !== undefined && !PRT_WRITE_ROLES.has(normalizedRole)) {
        const error = new Error(`Only marketing manager or assistant manager can update ${f}`);
        error.statusCode = 403;
        throw error;
      }
    }

    // Auto-set poDate on first Placement Offer
    if (updates.status === 'Placement Offer' && !oldDoc.poDate) {
      updates.poDate = new Date();
    }

    // PRT: auto-set ackEmailAt when ackEmail flips to 'Sent'.
    if (updates.ackEmail === 'Sent' && oldDoc.ackEmail !== 'Sent') {
      updates.ackEmailAt = updates.ackEmailAt instanceof Date ? updates.ackEmailAt : new Date();
    }

    // PRT: build editHistory entries for changed audited fields. The model
    // layer ($push) appends them to the editHistory[] array on the doc.
    const isAuditValueEqual = (a, b) => {
      if (a === b) return true;
      if (a == null && b == null) return true;
      if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
      if (a instanceof Date && typeof b === 'string') return a.toISOString().slice(0, b.length) === b;
      if (b instanceof Date && typeof a === 'string') return b.toISOString().slice(0, a.length) === a;
      return false;
    };
    const editHistoryEntries = CANDIDATE_AUDITED
      .filter((f) => updates[f] !== undefined && !isAuditValueEqual(oldDoc[f], updates[f]))
      .map((f) => ({
        field: f,
        oldValue: oldDoc[f] ?? null,
        newValue: updates[f],
        actor: user.email,
        ts: new Date()
      }));
    if (editHistoryEntries.length > 0) {
      updates._pushEditHistory = editHistoryEntries;
    }

    // Pass caller identity + provenance for statusHistory.
    // Default source 'manual-ui' covers UI-driven updates; callers that
    // know better (Intervue PO email, fireflies summary, admin-bulk)
    // override by setting updates._source explicitly before passing here.
    updates._changedBy = user.email;
    if (updates._source === undefined) updates._source = 'manual-ui';

    const updated = await candidateModel.updateCandidateById(candidateId, updates);

    logger.info('Candidate updated via updateCandidate', {
      candidateId,
      updatedBy: user.email,
      updates
    });

    const formatted = this.formatCandidateRecord(updated, user);

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

    // PRT visibility: strip PRT fields for non-marketing readers (no-op
    // for marketing-track callers). The full-fidelity `formatted` was
    // already broadcast on the domain event above, so internal subscribers
    // are unaffected.
    return this._applyPrtVisibility(formatted, user);
  }

  // ---------- PRT Phase 2: attachment operations ----------
  //
  // Permission model:
  //   role in PRT_ATTACHMENT_ROLES (admin/mm/mam/mlead/recruiter)
  //   + assertRecruiterInScope(user, candidate.recruiter)
  //
  // This is broader than the PRT field write-gate (mm/mam/admin) because
  // attachments are the operational artefact recruiters work with daily,
  // and the existing scope walk already prevents cross-team access.

  async _assertAttachmentPermission(user, candidate) {
    if (!user?.email || !user?.role) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }
    const role = (user.role || '').toString().toLowerCase().trim();
    if (!PRT_ATTACHMENT_ROLES.has(role)) {
      const error = new Error('You do not have permission to manage candidate attachments');
      error.statusCode = 403;
      throw error;
    }
    // Scope: the candidate's recruiter must be reachable from the user's
    // hierarchy. Admins bypass via assertRecruiterInScope's existing
    // self-or-hierarchy semantics. If the candidate has no recruiter on
    // record yet (rare), only admin / mm / mam / mlead can act.
    const recruiterEmail = formatEmail(
      candidate?.recruiter || candidate?.Recruiter || ''
    );
    if (recruiterEmail) {
      this.assertRecruiterInScope(user, recruiterEmail);
    } else if (!['admin', 'mm', 'mam', 'mlead'].includes(role)) {
      const error = new Error('Candidate has no recruiter assigned — escalate to manager');
      error.statusCode = 403;
      throw error;
    }
  }

  async addAttachment(user, candidateId, fileInput) {
    if (!candidateId) {
      const error = new Error('Candidate id is required');
      error.statusCode = 400;
      throw error;
    }
    if (!fileInput || !fileInput.buffer || !(fileInput.buffer instanceof Buffer)) {
      const error = new Error('File payload is required');
      error.statusCode = 400;
      throw error;
    }

    const candidate = await candidateModel.getCandidateById(candidateId);
    if (!candidate) {
      const error = new Error('Candidate not found');
      error.statusCode = 404;
      throw error;
    }

    await this._assertAttachmentPermission(user, candidate);

    // Storage layer enforces MIME whitelist + 10 MB cap and throws 4xx-style
    // Errors on rejection. Bubble them up unchanged.
    const uploadResult = await storageService.uploadAttachment({
      buffer: fileInput.buffer,
      contentType: fileInput.mimetype || fileInput.contentType,
      originalName: fileInput.originalname || fileInput.originalName,
      uploadedBy: user.email,
      candidateId
    });

    const attachment = {
      id: crypto.randomUUID(),
      filename: fileInput.originalname || fileInput.originalName || 'untitled',
      mimeType: uploadResult.contentType,
      size: uploadResult.size,
      s3Key: uploadResult.objectKey,
      url: uploadResult.url,
      uploadedAt: new Date(),
      uploadedBy: user.email
    };

    await candidateModel.updateCandidateById(candidateId, {
      _pushAttachment: attachment,
      _changedBy: user.email,
      _source: 'attachment-upload'
    });

    logger.info('Attachment added to candidate', {
      candidateId,
      attachmentId: attachment.id,
      mimeType: attachment.mimeType,
      size: attachment.size,
      uploadedBy: user.email
    });

    domainEventBus.publish(DomainEvents.CandidateUpdated, {
      eventId: crypto.randomUUID(),
      candidateId,
      actor: {
        email: user.email,
        role: user.role,
        name: user.name || user.displayName || formatDisplayName(user.email)
      },
      changes: ['attachments'],
      changeDetails: { added: [attachment.id] },
      occurredAt: new Date().toISOString()
    });

    return attachment;
  }

  async removeAttachment(user, candidateId, attachmentId) {
    if (!candidateId || !attachmentId) {
      const error = new Error('Candidate id and attachment id are required');
      error.statusCode = 400;
      throw error;
    }

    const candidate = await candidateModel.getCandidateById(candidateId);
    if (!candidate) {
      const error = new Error('Candidate not found');
      error.statusCode = 404;
      throw error;
    }

    const attachment = (Array.isArray(candidate.attachments) ? candidate.attachments : [])
      .find((a) => a && a.id === attachmentId);
    if (!attachment) {
      const error = new Error('Attachment not found on this candidate');
      error.statusCode = 404;
      throw error;
    }

    await this._assertAttachmentPermission(user, candidate);

    // DB pull first so the UI clears the entry even if storage delete is
    // slow. If the attachment was the canonical resume, clear that too —
    // a removed file can't be the source of truth for Resume Forge AI.
    const updates = {
      _pullAttachmentId: attachmentId,
      _changedBy: user.email,
      _source: 'attachment-delete'
    };
    if (candidate.resumeLink && attachment.url && candidate.resumeLink === attachment.url) {
      updates.resumeLink = '';
    }
    await candidateModel.updateCandidateById(candidateId, updates);

    // Best-effort storage cleanup. Failures here are logged but don't
    // fail the request — the DB is already consistent.
    try {
      if (attachment.s3Key) {
        await storageService.deleteObject(attachment.s3Key);
      }
    } catch (err) {
      logger.warn('Attachment storage delete failed (DB entry already removed)', {
        candidateId,
        attachmentId,
        s3Key: attachment.s3Key,
        error: err.message
      });
    }

    logger.info('Attachment removed from candidate', {
      candidateId,
      attachmentId,
      removedBy: user.email,
      wasCanonicalResume: candidate.resumeLink === attachment.url
    });

    domainEventBus.publish(DomainEvents.CandidateUpdated, {
      eventId: crypto.randomUUID(),
      candidateId,
      actor: {
        email: user.email,
        role: user.role,
        name: user.name || user.displayName || formatDisplayName(user.email)
      },
      changes: ['attachments'],
      changeDetails: { removed: [attachmentId] },
      occurredAt: new Date().toISOString()
    });

    return { id: attachmentId, removed: true };
  }

  async setAttachmentAsResume(user, candidateId, attachmentId) {
    if (!candidateId || !attachmentId) {
      const error = new Error('Candidate id and attachment id are required');
      error.statusCode = 400;
      throw error;
    }

    const candidate = await candidateModel.getCandidateById(candidateId);
    if (!candidate) {
      const error = new Error('Candidate not found');
      error.statusCode = 404;
      throw error;
    }

    const attachment = (Array.isArray(candidate.attachments) ? candidate.attachments : [])
      .find((a) => a && a.id === attachmentId);
    if (!attachment) {
      const error = new Error('Attachment not found on this candidate');
      error.statusCode = 404;
      throw error;
    }

    // Resume Forge AI expects a PDF at resumeLink; non-PDF attachments
    // cannot be promoted (would break the cache key + downstream parse).
    if ((attachment.mimeType || '').toLowerCase() !== 'application/pdf') {
      const error = new Error('Only PDF attachments can be set as the canonical resume');
      error.statusCode = 400;
      throw error;
    }

    await this._assertAttachmentPermission(user, candidate);

    await candidateModel.updateCandidateById(candidateId, {
      resumeLink: attachment.url,
      _changedBy: user.email,
      _source: 'attachment-set-resume'
    });

    logger.info('Attachment set as canonical resume', {
      candidateId,
      attachmentId,
      setBy: user.email
    });

    return { id: attachmentId, resumeLink: attachment.url };
  }

  // Used by the controller's streaming download proxy. Validates
  // permission + returns enough metadata for the controller to set
  // Content-Type / Content-Disposition before piping.
  async resolveAttachmentForDownload(user, candidateId, attachmentId) {
    if (!candidateId || !attachmentId) {
      const error = new Error('Candidate id and attachment id are required');
      error.statusCode = 400;
      throw error;
    }
    const candidate = await candidateModel.getCandidateById(candidateId);
    if (!candidate) {
      const error = new Error('Candidate not found');
      error.statusCode = 404;
      throw error;
    }
    const attachment = (Array.isArray(candidate.attachments) ? candidate.attachments : [])
      .find((a) => a && a.id === attachmentId);
    if (!attachment) {
      const error = new Error('Attachment not found on this candidate');
      error.statusCode = 404;
      throw error;
    }
    await this._assertAttachmentPermission(user, candidate);
    return attachment;
  }

  async createCandidateFromManager(user, payload = {}) {
    if (!user?.email || !user?.role) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    const normalizedRole = user.role.trim().toLowerCase();

    // Recruitment creation flow: allow admin, manager, MM, and MAM.
    if (!['admin', 'mm', 'mam'].includes(normalizedRole)) {
      const error = new Error('Access denied. Only MM, MAM, managers, or admins can create candidates.');
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

    if (normalizedRole === ROLE_MAM) {
      const mamBranchResolution = this.resolveDefaultBranchForMam(user);
      if (!mamBranchResolution.branch) {
        logger.warn('Candidate creation blocked for MAM: branch mapping missing', {
          mamEmail: normalizeEmail(user.email),
          reason: mamBranchResolution.reason || null
        });
        const error = new Error(mamBranchResolution.reason || 'MAM branch mapping missing');
        error.statusCode = 403;
        throw error;
      }
      sanitized.branch = mamBranchResolution.branch;
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
    this.assertRecruiterInScope(user, sanitized.recruiter);

    if (!sanitized.name || !sanitized.email) {
      const error = new Error('Candidate name and email are required');
      error.statusCode = 400;
      throw error;
    }

    // PRT: Team Lead is required on the candidate record. If the caller
    // didn't supply one, derive it from the recruiter's user record
    // (recruiter.teamLead is a display-name string; _findEmailByName
    // resolves it to an email).
    if (!sanitized.teamLead) {
      const recruiterRecord = userModel.getUserByEmail(sanitized.recruiter);
      const tlName = recruiterRecord?.teamLead?.toString().trim();
      if (tlName) {
        const tlEmail = this._findEmailByName(tlName);
        if (tlEmail) {
          sanitized.teamLead = formatEmail(tlEmail);
        }
      }
      if (!sanitized.teamLead) {
        const error = new Error('Team Lead is required (could not derive from recruiter — set teamLead on the recruiter\'s user record or supply teamLead explicitly)');
        error.statusCode = 400;
        throw error;
      }
    }

    const document = await candidateModel.createCandidate({
      ...sanitized,
      expert: '',
      workflowStatus: WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
      createdBy: user.email,
      // PRT defaults (the model accepts these too; see Candidate.createCandidate).
      status: sanitized.status || 'New',
      ackEmail: sanitized.ackEmail || 'Pending',
      marketingStartDate: new Date(),
      attachments: [],
      editHistory: [],
      assignmentEmails: []
    });

    const formatted = this.formatCandidateRecord(document, user);

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
    if (!['admin', 'mm'].includes(normalizedRole)) {
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
    const formatted = this.formatCandidateRecord(updated, user);

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
    const formatted = this.formatCandidateRecord(updated, user);

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

    // C20 — accept both legacy and new role names. Map new → legacy here
    // so the rest of this method's branches keep working with their
    // legacy comparisons. Team is used to disambiguate assistantManager
    // (am vs mam) and teamLead (lead vs mlead).
    const rawRole = user.role.trim().toLowerCase();
    const team = (user.team || '').toString().toLowerCase();
    let normalizedRole = rawRole;
    if (rawRole === 'manager') normalizedRole = ROLE_MM;
    else if (rawRole === 'assistantmanager') normalizedRole = team === 'technical' ? 'am' : ROLE_MAM;
    else if (rawRole === 'teamlead') normalizedRole = team === 'technical' ? 'lead' : ROLE_MLEAD;
    else if (rawRole === 'expert') normalizedRole = 'user';

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
      result.options = this.buildCandidateOptions(user);
      return result;
    }

    if (normalizedRole === ROLE_MAM || normalizedRole === ROLE_MLEAD) {
      const hierarchy = await this.collectHierarchyEmails(user);
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
        result.options = this.buildCandidateOptions(user);
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
        result.options = this.buildCandidateOptions(user);
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

        // Match legacy 'lead' AND post-rename 'teamLead' with team:'technical'.
        // Marketing teamLeads stay excluded so they don't bleed into the
        // technical AM's expert pool.
        const personTeam = (person.team || '').toLowerCase();
        const isTechnicalTeamLead = roleKey === 'lead'
          || (roleKey === 'teamlead' && personTeam === 'technical');
        if (isTechnicalTeamLead) {
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
        // Accept legacy/new expert role names, any user with
        // acceptsTasks=true (Darshan/Anusree/Bhavya), and technical
        // teamLeads (legacy 'lead' + post-rename teamLead+team:'technical')
        // — they're part of the IC interview pool by default, even
        // without the per-user acceptsTasks opt-in.
        const personTeam = (person.team || '').toLowerCase();
        const isAssignable = ['user', 'expert'].includes(roleKey)
          || person.acceptsTasks === true
          || roleKey === 'lead'
          || (roleKey === 'teamlead' && personTeam === 'technical');
        if (!isAssignable) continue;
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
      result.options = this.buildCandidateOptions(user, {
        expertChoices: this.buildExpertChoices(expertList)
      });
      return result;
    }

    if (normalizedRole === 'lead') {
      const experts = new Set();
      experts.add(normalizeEmail(user.email));

      const leadName = normalizeName(formatDisplayName(user.email));
      const allUsers = userModel.getAllUsers();

      for (const person of allUsers) {
        const roleKey = (person.role || '').toLowerCase();
        // Accept legacy/new expert role names, any user with
        // acceptsTasks=true (Darshan/Anusree/Bhavya), and technical
        // teamLeads (legacy 'lead' + post-rename teamLead+team:'technical')
        // — they're part of the IC interview pool by default, even
        // without the per-user acceptsTasks opt-in.
        const personTeam = (person.team || '').toLowerCase();
        const isAssignable = ['user', 'expert'].includes(roleKey)
          || person.acceptsTasks === true
          || roleKey === 'lead'
          || (roleKey === 'teamlead' && personTeam === 'technical');
        if (!isAssignable) continue;
        const personLeadName = normalizeName(person.teamLead || '');
        if (personLeadName === leadName) {
          experts.add(normalizeEmail(person.email));
        }
      }

      const expertList = Array.from(experts).filter(Boolean);
      const result = await this.fetchCandidatesByExperts(user, expertList, options);
      result.options = this.buildCandidateOptions(user, {
        expertChoices: this.buildExpertChoices(expertList)
      });
      return result;
    }

    if (normalizedRole === 'user') {
      const expertEmail = normalizeEmail(user.email);
      const result = await this.fetchCandidatesByExperts(user, expertEmail ? [expertEmail] : [], options);
      result.options = this.buildCandidateOptions(user);
      return result;
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
      result.options = this.buildCandidateOptions(user);
      return result;
    }

    // Legacy 'manager' role removed — branch was dead (0 users had it).
    // If a special branch-manager scope is needed, route through 'mm'.

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

    // Try the main candidates collection first
    const candidate = await candidateModel.getCandidateById(candidateId);
    if (candidate) return this.formatCandidateRecord(candidate, user);

    // Fallback: check candidateDetails collection (used by Resume Understanding)
    try {
      const detailsDoc = await database.getCollection('candidateDetails')
        .findOne({ _id: new ObjectId(candidateId) });
      if (detailsDoc) {
        // Return a lightweight record with the fields needed for notifications/alerts
        return {
          id: detailsDoc._id?.toString(),
          _id: detailsDoc._id,
          name: detailsDoc['Candidate Name'] || 'Candidate',
          'Candidate Name': detailsDoc['Candidate Name'],
          Recruiter: detailsDoc.Recruiter,
          recruiterRaw: detailsDoc.Recruiter, // In candidateDetails, Recruiter is the raw email
          recruiter: detailsDoc.Recruiter,
          expertRaw: detailsDoc.Expert,
          expert: detailsDoc.Expert,
          branch: detailsDoc.Branch,
        };
      }
    } catch (fallbackErr) {
      logger.warn('getCandidateById fallback lookup failed', { error: fallbackErr.message, candidateId });
    }

    return null;
  }

  async getActivities(user, candidateId) {
    if (!user?.email) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    const activities = await database.getCollection('candidateactivities')
      .find({ candidateId: new ObjectId(candidateId) })
      .sort({ createdAt: 1 })
      .toArray();

    return activities.map(a => ({
      id: a._id,
      type: a.type,
      outcome: a.outcome,
      notes: a.notes,
      createdBy: a.createdBy,
      createdAt: a.createdAt
    }));
  }

  async addActivity(user, candidateId, { type, outcome, notes }) {
    if (!user?.email) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }

    const validTypes = ['call_attempt', 'document_prepared', 'mock_interview', 'task_created', 'task_recreated', 'call_response'];
    if (!validTypes.includes(type)) {
      const error = new Error('Invalid activity type');
      error.statusCode = 400;
      throw error;
    }

    if (type === 'call_attempt') {
      const validOutcomes = ['connected', 'unavailable'];
      if (!validOutcomes.includes(outcome)) {
        const error = new Error('Invalid outcome for call_attempt');
        error.statusCode = 400;
        throw error;
      }
    }

    const newActivity = {
      candidateId: new ObjectId(candidateId),
      type,
      ...(type === 'call_attempt' && { outcome }),
      ...(notes && { notes }),
      createdBy: {
        email: user.email,
        name: formatDisplayName(user.email),
        role: user.role
      },
      createdAt: new Date()
    };

    const result = await database.getCollection('candidateactivities').insertOne(newActivity);
    const activity = {
      id: result.insertedId,
      type: newActivity.type,
      outcome: newActivity.outcome,
      notes: newActivity.notes,
      createdBy: newActivity.createdBy,
      createdAt: newActivity.createdAt
    };

    if (type === 'call_attempt' && outcome === 'unavailable') {
      const recentActivities = await database.getCollection('candidateactivities')
        .find({ candidateId: new ObjectId(candidateId) })
        .sort({ createdAt: -1 })
        .toArray();

      let count = 0;
      for (const a of recentActivities) {
        if (a.type === 'call_attempt' && a.outcome === 'unavailable') {
          count++;
        } else {
          break;
        }
      }

      if (count >= 2) {
        return { activity, alertRecruiter: true, attemptCount: count };
      }
    }

    return { activity, alertRecruiter: false, attemptCount: 0 };
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
    const canCreateComplaint = ['recruiter', 'mlead', 'mam', 'mm', 'admin'].includes(normalizedRole);

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
  // ─── Persistent Call Alerts ────────────────────────────────────────
  /**
   * Create or update a pending call alert for a recruiter.
   * If one already exists for the same candidate, updates the attemptCount.
   */
  async createPendingCallAlert({ candidateId, candidateName, candidatePhone, candidateEmail, attemptCount, recruiterEmail }) {
    const col = database.getCollection('pendingCallAlerts');
    const now = new Date();

    const result = await col.updateOne(
      { candidateId: new ObjectId(candidateId), recruiterEmail: recruiterEmail.toLowerCase(), status: 'pending' },
      {
        $set: {
          candidateName,
          candidatePhone: candidatePhone || '',
          candidateEmail: candidateEmail || '',
          attemptCount,
          updatedAt: now
        },
        $setOnInsert: {
          candidateId: new ObjectId(candidateId),
          recruiterEmail: recruiterEmail.toLowerCase(),
          status: 'pending',
          createdAt: now
        }
      },
      { upsert: true }
    );

    logger.info('Pending call alert created/updated', { candidateId, recruiterEmail, attemptCount });
    return result;
  }

  /**
   * Get all pending (unresponded) call alerts for a recruiter.
   */
  async getPendingCallAlerts(userEmail) {
    if (!userEmail) return [];
    const col = database.getCollection('pendingCallAlerts');
    return col
      .find({ recruiterEmail: userEmail.toLowerCase(), status: 'pending' })
      .sort({ createdAt: 1 })
      .toArray();
  }

  /**
   * Respond to a call alert — marks it responded and logs the response as an activity.
   */
  async respondToCallAlert(user, alertId, responseText) {
    if (!user?.email) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }
    if (!responseText || !responseText.trim()) {
      const error = new Error('Response text is required');
      error.statusCode = 400;
      throw error;
    }

    const col = database.getCollection('pendingCallAlerts');
    const alert = await col.findOne({ _id: new ObjectId(alertId), status: 'pending' });

    if (!alert) {
      const error = new Error('Alert not found or already responded');
      error.statusCode = 404;
      throw error;
    }

    // Mark alert as responded
    await col.updateOne(
      { _id: new ObjectId(alertId) },
      {
        $set: {
          status: 'responded',
          response: responseText.trim(),
          respondedBy: user.email,
          respondedAt: new Date()
        }
      }
    );

    // Log the response as an activity on the candidate
    const activityCol = database.getCollection('candidateactivities');
    const newActivity = {
      candidateId: alert.candidateId,
      type: 'call_response',
      notes: responseText.trim(),
      createdBy: {
        email: user.email,
        name: formatDisplayName(user.email),
        role: user.role || 'recruiter'
      },
      createdAt: new Date()
    };

    const actResult = await activityCol.insertOne(newActivity);

    logger.info('Call alert responded', { alertId, candidateId: alert.candidateId.toString(), user: user.email });

    return {
      alert,
      activity: {
        id: actResult.insertedId,
        type: newActivity.type,
        notes: newActivity.notes,
        createdBy: newActivity.createdBy,
        createdAt: newActivity.createdAt
      }
    };
  }

  /**
   * One-time backfill: insert a task_created activity for every candidate
   * that doesn't already have one.  Uses the candidate's own created_at
   * timestamp so the Activity timeline is historically accurate.
   */
  async backfillTaskCreatedActivities() {
    const col = database.getCollection('candidateactivities');
    try {
      // Step 1: Remove duplicate task_created entries (keep only the earliest per candidate)
      const dupes = await col.aggregate([
        { $match: { type: 'task_created' } },
        { $sort: { createdAt: 1 } },
        { $group: { _id: '$candidateId', count: { $sum: 1 }, keep: { $first: '$_id' }, ids: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } }
      ]).toArray();

      if (dupes.length > 0) {
        const idsToDelete = dupes.flatMap(d => d.ids.filter(id => id.toString() !== d.keep.toString()));
        if (idsToDelete.length > 0) {
          await col.deleteMany({ _id: { $in: idsToDelete } });
          logger.info(`Cleaned up ${idsToDelete.length} duplicate task_created entries`);
        }
      }

      // Step 2: Build a candidate lookup map (createdBy or Recruiter as fallback)
      const candidates = await database.getCollection('candidateDetails')
        .find({ docType: { $in: [null, 'candidate'] } })
        .project({ _id: 1, createdBy: 1, Recruiter: 1, created_at: 1, updated_at: 1 })
        .toArray();

      if (!candidates.length) return;

      const candidateMap = new Map(candidates.map(c => [c._id.toString(), c]));

      // Step 3: Fix existing "System" entries — replace with actual creator info
      const systemEntries = await col
        .find({ type: 'task_created', 'createdBy.email': 'system' })
        .toArray();

      if (systemEntries.length > 0) {
        const bulkOps = [];
        for (const entry of systemEntries) {
          const cand = candidateMap.get(entry.candidateId.toString());
          if (!cand) continue;
          const creatorEmail = cand.createdBy || cand.Recruiter || '';
          if (!creatorEmail) continue;
          bulkOps.push({
            updateOne: {
              filter: { _id: entry._id },
              update: {
                $set: {
                  'createdBy.email': creatorEmail,
                  'createdBy.name': formatDisplayName(creatorEmail),
                  'createdBy.role': 'recruiter',
                  notes: `Task created by ${formatDisplayName(creatorEmail)}`,
                  createdAt: cand.created_at || cand.updated_at || cand._id.getTimestamp()
                }
              }
            }
          });
        }
        if (bulkOps.length > 0) {
          await col.bulkWrite(bulkOps);
          logger.info(`Fixed creator info on ${bulkOps.length} task_created entries`);
        }
      }

      // Step 4: Backfill candidates that still don't have a task_created entry
      const existing = await col
        .find({ type: 'task_created' })
        .project({ candidateId: 1 })
        .toArray();

      const existingSet = new Set(existing.map(e => e.candidateId.toString()));

      const toInsert = candidates
        .filter(c => !existingSet.has(c._id.toString()))
        .map(c => {
          const creatorEmail = c.createdBy || c.Recruiter || '';
          const createdAt = c.created_at || c.updated_at || c._id.getTimestamp();
          return {
            candidateId: c._id,
            type: 'task_created',
            notes: creatorEmail ? `Task created by ${formatDisplayName(creatorEmail)}` : 'Task created',
            createdBy: {
              email: creatorEmail || 'system',
              name: creatorEmail ? formatDisplayName(creatorEmail) : 'System',
              role: 'recruiter'
            },
            createdAt
          };
        });

      if (toInsert.length > 0) {
        await col.insertMany(toInsert);
        logger.info(`Backfilled task_created activities for ${toInsert.length} candidates`);
      } else {
        logger.info('All candidates already have task_created activity');
      }
    } catch (err) {
      logger.error('task_created backfill failed', { error: err.message });
    }
  }
}

export const candidateService = new CandidateService();
