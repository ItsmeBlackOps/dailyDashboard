import moment from 'moment-timezone';
import { candidateModel } from '../models/Candidate.js';
import { userModel } from '../models/User.js';
import { graphMailService } from './graphMailService.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { candidateService } from './candidateService.js';
import { profileService } from './profileService.js';
import { buildEmailSignatureHtml } from '../utils/emailSignature.js';

const ALLOWED_ROLES = new Set(['recruiter', 'mlead', 'mam', 'mm']);
const INTERVIEW_ROUNDS = new Set([
  '1st Round',
  '2nd Round',
  '3rd Round',
  '4th Round',
  '5th Round',
  'Technical Round',
  'Coding Round',
  'Loop Round',
  'Final Round'
]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_TIMEZONE = 'America/New_York';

function normalizeWhitespace(value = '') {
  return value.toString().trim().replace(/\s+/g, ' ');
}

function trimString(value = '') {
  return value.toString().trim();
}

function normalizeName(value = '') {
  return normalizeWhitespace(value).toLowerCase();
}

function toTitleCase(value = '') {
  return normalizeWhitespace(value)
    .split(' ')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ');
}

function formatTechnology(value = '') {
  return normalizeWhitespace(value)
    .split(/\s+/)
    .map((segment) =>
      segment
        .split('/')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('/')
    )
    .join(' ');
}

function deriveDisplayNameFromEmail(email = '') {
  const local = (email || '').split('@')[0];
  return local
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function escapeHtml(value = '') {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTimeForEmail(isoString) {
  const tzMoment = moment.tz(isoString, DEFAULT_TIMEZONE);
  if (!tzMoment.isValid()) {
    throw new Error('Invalid interview date');
  }
  const formatted = tzMoment.format('MMM D, YYYY [at] hh:mm A');
  return {
    subjectFragment: `${formatted} EST`,
    display: `${formatted} EST`,
  };
}

function ensureEmail(value = '', fieldName) {
  const email = value.trim().toLowerCase();
  if (!email || !EMAIL_REGEX.test(email)) {
    const error = new Error(`${fieldName} is invalid or missing`);
    error.statusCode = 400;
    throw error;
  }
  return email;
}

function buildHtmlTable(rows) {
  const body = rows
    .map(({ label, value }) => {
      const safeLabel = escapeHtml(label);
      const safeValue = escapeHtml(value ?? '');
      return `<tr><th align="left" style="padding:6px 12px;background:#031022;color:#fff;">${safeLabel}</th><td style="padding:6px 12px;border:1px solid #0f1e3d;">${safeValue}</td></tr>`;
    })
    .join('');

  return `<table style="border-collapse:collapse;border:1px solid #0f1e3d;font-family:Arial, sans-serif;font-size:14px;min-width:420px;">${body}</table>`;
}

function buildParagraphSection(text = '') {
  const normalized = trimString(text).replace(/\r\n/g, '\n');
  if (!normalized) {
    return '';
  }

  const paragraphs = normalized
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const html = escapeHtml(block).replace(/\n/g, '<br />');
      const marginTop = index === 0 ? 0 : 12;
      return `<p style="margin:${marginTop}px 0 0;font-family:Arial, sans-serif;font-size:14px;line-height:1.5;color:#0f1e3d;">${html}</p>`;
    })
    .join('');

  if (!paragraphs) {
    return '';
  }

  return `<div style="margin-top:16px;">${paragraphs}</div>`;
}

function sanitizeAttachments(files = []) {
  const maxBytes = config.support?.attachmentMaxBytes ?? 5 * 1024 * 1024;
  return files.map((file) => {
    if (!file || !file.buffer || typeof file.originalname !== 'string') {
      const error = new Error('Invalid attachment payload');
      error.statusCode = 400;
      throw error;
    }

    if (!/^application\/pdf$/i.test(file.mimetype)) {
      const error = new Error(`${file.originalname} must be a PDF file`);
      error.statusCode = 400;
      throw error;
    }

    if (file.size > maxBytes) {
      const error = new Error(`${file.originalname} exceeds the maximum size of ${(maxBytes / (1024 * 1024)).toFixed(1)} MB`);
      error.statusCode = 400;
      throw error;
    }

    return {
      filename: file.originalname,
      content: file.buffer,
      contentType: 'application/pdf',
    };
  });
}

class SupportRequestService {
  ensureRoleAllowed(user) {
    const normalizedRole = normalizeName(user?.role ?? '');
    if (!ALLOWED_ROLES.has(normalizedRole)) {
      const error = new Error('You are not permitted to create support requests');
      error.statusCode = 403;
      throw error;
    }
    return normalizedRole;
  }

  async loadCandidate(candidateId) {
    const candidate = await candidateModel.getCandidateById(candidateId);
    if (!candidate) {
      const error = new Error('Candidate not found');
      error.statusCode = 404;
      throw error;
    }
    return candidate;
  }

  ensureAccess(user, candidate, normalizedRole) {
    if (normalizedRole === 'mm' || normalizedRole === 'mam') {
      return;
    }

    const recruiterEmail = (candidate.recruiter || '').toString().trim();
    const normalizedRecruiter = recruiterEmail.toLowerCase();
    const requesterEmail = (user.email || '').toLowerCase();

    if (normalizedRole === 'recruiter' || normalizedRole === 'mlead' || normalizedRole === 'mam') {
      if (!normalizedRecruiter || normalizedRecruiter !== requesterEmail) {
        const error = new Error('This candidate is assigned to a different recruiter');
        error.statusCode = 403;
        throw error;
      }
      return;
    }

    if (normalizedRole === 'mlead') {
      // ✅ If the mlead is also the assigned recruiter, allow access immediately.
      if (normalizedRecruiter && normalizedRecruiter === requesterEmail) {
        return;
      }

      const recruiterRecord = normalizedRecruiter
        ? userModel.getUserByEmail(normalizedRecruiter)
        : null;

      if (!recruiterRecord) {
        const error = new Error('Recruiter record not found for candidate');
        error.statusCode = 403;
        throw error;
      }

      const leadDisplay = normalizeName(recruiterRecord.teamLead ?? '');
      const requesterDisplay = normalizeName(deriveDisplayNameFromEmail(user.email));

      if (!leadDisplay || leadDisplay !== requesterDisplay) {
        const error = new Error('Candidate is not part of your team');
        error.statusCode = 403;
        throw error;
      }

      return;
    }
  }

  gatherHierarchyEmails(recruiterEmail) {
    const nameMap = new Map();
    const allUsers = userModel.getAllUsers();
    for (const user of allUsers) {
      const display = deriveDisplayNameFromEmail(user.email);
      const key = normalizeName(display);
      if (key) {
        nameMap.set(key, user.email.toLowerCase());
      }
    }

    const recruiterRecord = userModel.getUserByEmail(recruiterEmail);
    if (!recruiterRecord) {
      return { teamLeadEmail: null, managerEmail: null };
    }

    const teamLeadKey = normalizeName(recruiterRecord.teamLead ?? '');
    const managerKey = normalizeName(recruiterRecord.manager ?? '');

    return {
      teamLeadEmail: teamLeadKey ? nameMap.get(teamLeadKey) ?? null : null,
      managerEmail: managerKey ? nameMap.get(managerKey) ?? null : null,
    };
  }

  buildSubject(candidateName, technology, when) {
    const safeTechnology = technology || 'Technology';
    return `Interview Support - ${candidateName} - ${safeTechnology} - ${when.subjectFragment}`;
  }

  buildHtmlBody(data) {
    const rows = [
      { label: 'Candidate Name', value: data.candidateName },
      { label: 'Technology', value: data.technology },
      { label: 'End Client', value: data.endClient },
      { label: 'Job Title', value: data.jobTitle },
      { label: 'Interview Round', value: data.interviewRound },
      { label: 'Date & Time (EST)', value: data.interviewDateTimeDisplay },
      { label: 'Duration', value: data.durationDisplay },
      { label: 'Email ID', value: data.emailId },
      { label: 'Contact Number', value: data.contactNumber },
    ];
    const intro = '<p style="font-family:Arial, sans-serif;font-size:14px;color:#0f1e3d;">Interview support request details:</p>';
    const tableHtml = buildHtmlTable(rows);
    const jobDescriptionSection = buildParagraphSection(data.jobDescriptionText);
    return `${intro}${tableHtml}${jobDescriptionSection}`;
  }

  async sendInterviewSupportRequest(user, payload = {}, files = {}, graphAccessToken) {
    const normalizedRole = this.ensureRoleAllowed(user);

    const candidateId = normalizeWhitespace(payload.candidateId || '');
    if (!candidateId) {
      const error = new Error('Candidate id is required');
      error.statusCode = 400;
      throw error;
    }

    const endClient = toTitleCase(payload.endClient || '');
    const jobTitle = toTitleCase(payload.jobTitle || '');
    const interviewRoundRaw = normalizeWhitespace(payload.interviewRound || '');
    const customMessage = trimString(payload.customMessage || '');
    const jobDescriptionText = typeof payload.jobDescriptionText === 'string' ? payload.jobDescriptionText : '';

    if (!endClient) {
      const error = new Error('End client is required');
      error.statusCode = 400;
      throw error;
    }

    if (!jobTitle) {
      const error = new Error('Job title is required');
      error.statusCode = 400;
      throw error;
    }

    if (!INTERVIEW_ROUNDS.has(interviewRoundRaw)) {
      const error = new Error('Interview round is invalid');
      error.statusCode = 400;
      throw error;
    }

    let loopSlotsRaw = [];
    if (payload.loopSlots) {
      try {
        const parsed = typeof payload.loopSlots === 'string'
          ? JSON.parse(payload.loopSlots)
          : payload.loopSlots;
        if (Array.isArray(parsed)) {
          loopSlotsRaw = parsed;
        }
      } catch (error) {
        const parseError = new Error('Invalid loop slot payload');
        parseError.statusCode = 400;
        throw parseError;
      }
    }

    const isLoopRound = normalizeName(interviewRoundRaw).includes('loop');
    const requiresSingleSlot = !isLoopRound || loopSlotsRaw.length === 0;

    const interviewDateTimeInput = trimString(payload.interviewDateTime || '');
    const durationInput = trimString(payload.duration || '');

    const parseSlotMoment = (value) => {
      if (!value) {
        return null;
      }
      const isoCandidate = moment(value, moment.ISO_8601, true);
      if (isoCandidate.isValid()) {
        return isoCandidate.tz(DEFAULT_TIMEZONE);
      }
      const legacyCandidate = moment.tz(value, 'YYYY-MM-DDTHH:mm', DEFAULT_TIMEZONE);
      return legacyCandidate.isValid() ? legacyCandidate : null;
    };

    const now = moment().tz(DEFAULT_TIMEZONE);
    const resolvedSlots = [];

    if (requiresSingleSlot) {
      if (!interviewDateTimeInput) {
        const error = new Error('Interview date and time is required');
        error.statusCode = 400;
        throw error;
      }

      const durationMinutes = Number.parseInt(durationInput, 10);
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        const error = new Error('Duration must be a positive number of minutes');
        error.statusCode = 400;
        throw error;
      }

      if (durationMinutes % 5 !== 0) {
        const error = new Error('Duration must be in 5-minute increments');
        error.statusCode = 400;
        throw error;
      }

      const slotMoment = parseSlotMoment(interviewDateTimeInput);
      if (!slotMoment) {
        const error = new Error('Provide a valid interview date and time in EST');
        error.statusCode = 400;
        throw error;
      }

      if (slotMoment.isBefore(now)) {
        const error = new Error('Interview date and time must be in the future');
        error.statusCode = 400;
        throw error;
      }

      resolvedSlots.push({
        interviewDateTime: slotMoment.toISOString(),
        durationMinutes,
      });
    } else {
      if (loopSlotsRaw.length === 0) {
        const error = new Error('At least one loop slot is required');
        error.statusCode = 400;
        throw error;
      }

      for (const slotRaw of loopSlotsRaw) {
        const slotDateTimeRaw = trimString(slotRaw?.interviewDateTime || slotRaw?.interviewDateTimeISO || '');
        const slotDurationRaw = slotRaw?.durationMinutes ?? slotRaw?.duration;
        const slotDurationMinutes = Number.parseInt(trimString(String(slotDurationRaw ?? '')), 10);

        if (!slotDateTimeRaw) {
          const error = new Error('Loop slot is missing an interview date and time');
          error.statusCode = 400;
          throw error;
        }

        if (!Number.isFinite(slotDurationMinutes) || slotDurationMinutes <= 0) {
          const error = new Error('Loop slot duration must be a positive number of minutes');
          error.statusCode = 400;
          throw error;
        }

        if (slotDurationMinutes % 5 !== 0) {
          const error = new Error('Loop slot duration must be in 5-minute increments');
          error.statusCode = 400;
          throw error;
        }

        const slotMoment = parseSlotMoment(slotDateTimeRaw);
        if (!slotMoment) {
          const error = new Error('Loop slot has an invalid interview date/time');
          error.statusCode = 400;
          throw error;
        }

        if (slotMoment.isBefore(now)) {
          const error = new Error('Loop slot must be scheduled in the future');
          error.statusCode = 400;
          throw error;
        }

        resolvedSlots.push({
          interviewDateTime: slotMoment.toISOString(),
          durationMinutes: slotDurationMinutes,
        });
      }
    }

    const candidateRecord = await this.loadCandidate(candidateId);
    const formattedCandidate = candidateService.formatCandidateRecord(candidateRecord);

    const contactNumber = trimString(
      formattedCandidate.contact ||
      candidateRecord.contact ||
      candidateRecord.Contact ||
      candidateRecord['Contact No'] ||
      ''
    );

    if (!contactNumber) {
      const error = new Error('Contact number is required');
      error.statusCode = 400;
      throw error;
    }

    const recruiterEmail = ensureEmail(
      formattedCandidate.recruiterRaw || candidateRecord.recruiter || candidateRecord.createdBy || '',
      'Recruiter email'
    );
    this.ensureAccess(user, { ...formattedCandidate, recruiter: recruiterEmail }, normalizedRole);

    const candidateName = toTitleCase(formattedCandidate.name || candidateRecord.name || '');
    const technology = formatTechnology(formattedCandidate.technology || candidateRecord.technology || '');
    const emailId = ensureEmail(
      formattedCandidate.email || candidateRecord.email || '',
      'Candidate email'
    );

    const requesterDisplay = deriveDisplayNameFromEmail(user.email);

    let signatureHtml = '';
    try {
      const profileResult = await profileService.getProfile(user.email);
      const profile = profileResult?.profile;
      if (profile?.isComplete) {
        signatureHtml = buildEmailSignatureHtml({
          email: user.email.toLowerCase(),
          displayName: profile.displayName,
          jobRole: profile.jobRole,
          phoneNumber: profile.phoneNumber,
          companyName: profile.companyName,
          companyUrl: profile.companyUrl
        });
      }
    } catch (profileError) {
      logger.warn('Failed to build signature for support email', {
        error: profileError instanceof Error ? profileError.message : profileError,
        email: user.email
      });
    }

    const { teamLeadEmail, managerEmail } = this.gatherHierarchyEmails(recruiterEmail);

    const supportConfig = config.support || {};
    const toRecipients = new Set([supportConfig.supportTo || 'tech.leaders@silverspaceinc.com']);
    const ccRecipients = new Set(supportConfig.supportCcFallback || []);

    if (teamLeadEmail) {
      ccRecipients.add(teamLeadEmail);
    }
    if (managerEmail) {
      ccRecipients.add(managerEmail);
    }

    const sanitizedAttachments = [];
    if (files.resume?.length) {
      sanitizedAttachments.push(...sanitizeAttachments(files.resume));
    }
    if (files.jobDescription?.length) {
      sanitizedAttachments.push(...sanitizeAttachments(files.jobDescription));
    }
    if (files.additionalAttachments?.length) {
      sanitizedAttachments.push(...sanitizeAttachments(files.additionalAttachments));
    }

    const sendForSlot = async ({ interviewDateTime, durationMinutes }) => {
      const interviewMomentDetails = formatDateTimeForEmail(interviewDateTime);

      const htmlBody = this.buildHtmlBody({
        candidateName,
        technology,
        endClient,
        jobTitle,
        interviewRound: interviewRoundRaw,
        interviewDateTimeDisplay: interviewMomentDetails.display,
        durationDisplay: `${durationMinutes} minutes`,
        emailId,
        contactNumber,
        requestedBy: `${requesterDisplay} (${user.email.toLowerCase()})`,
        jobDescriptionText,
      });

      const sections = [];
      if (customMessage) {
        sections.push(`<p style="font-family:Arial, sans-serif;font-size:14px;color:#0f1e3d;">${escapeHtml(customMessage)}</p>`);
      }
      sections.push(htmlBody);
      if (signatureHtml) {
        sections.push(`<div style="margin-top:24px;">${signatureHtml}</div>`);
      }

      const html = sections.join('');
      const subject = this.buildSubject(candidateName, technology, interviewMomentDetails);

      const graphAttachments = sanitizedAttachments.map((attachment) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: attachment.filename,
        contentType: attachment.contentType,
        contentBytes: attachment.content.toString('base64')
      }));

      if (!graphAccessToken) {
        const error = new Error('Missing graph access token');
        error.statusCode = 401;
        throw error;
      }

      const message = {
        subject,
        body: {
          contentType: 'HTML',
          content: html
        },
        toRecipients: Array.from(toRecipients).map((address) => ({
          emailAddress: { address }
        })),
        ccRecipients: Array.from(ccRecipients).map((address) => ({
          emailAddress: { address }
        }))
      };

      if (graphAttachments.length > 0) {
        message.attachments = graphAttachments;
      }

      await graphMailService.sendDelegatedMail(graphAccessToken, {
        message,
        saveToSentItems: true
      });

      logger.info('Interview support request submitted', {
        candidateId,
        requestedBy: user.email,
        interviewDateTime,
        durationMinutes,
        to: Array.from(toRecipients),
        cc: Array.from(ccRecipients)
      });
    };

    for (const slot of resolvedSlots) {
      await sendForSlot(slot);
    }

    const message = resolvedSlots.length > 1
      ? `Support requests sent for ${resolvedSlots.length} slots`
      : 'Support request sent successfully';

    return {
      success: true,
      message
    };
  }
}

export const supportRequestService = new SupportRequestService();
