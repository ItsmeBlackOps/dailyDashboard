import path from 'path';
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
const SAME_DAY_LEAD_MINUTES = 4 * 60;

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

function hasExplicitTimezone(value = '') {
  return /([zZ]|[+-]\d{2}:?\d{2})$/u.test(trimString(value));
}

function buildUtcOffsetLabel(momentInstance) {
  if (!moment.isMoment(momentInstance)) {
    return '';
  }
  const offset = momentInstance.format('Z');
  if (!offset) {
    return '';
  }
  return offset === '+00:00' ? 'UTC' : `UTC${offset}`;
}

function formatDateTimeForEmail(input, options = {}) {
  const {
    timezone = DEFAULT_TIMEZONE,
    convertToTimezone = true,
    customLabel
  } = options;

  const trimmedCustomLabel = typeof customLabel === 'string' ? customLabel.trim() : '';

  let tzMoment;
  let shouldConvert = Boolean(convertToTimezone && timezone);

  if (moment.isMoment(input)) {
    tzMoment = input.clone();
  } else if (typeof input === 'string') {
    const trimmedInput = trimString(input);
    const inputHasExplicitTimezone = hasExplicitTimezone(trimmedInput);

    if (shouldConvert && inputHasExplicitTimezone) {
      shouldConvert = false;
    }

    if (shouldConvert && timezone) {
      tzMoment = moment.tz(trimmedInput, timezone);
    } else {
      tzMoment = moment.parseZone(trimmedInput, moment.ISO_8601, true);
      if (!tzMoment.isValid()) {
        tzMoment = moment(trimmedInput);
      }
    }
  } else {
    throw new Error('Invalid interview date');
  }

  if (!tzMoment.isValid()) {
    throw new Error('Invalid interview date');
  }

  if (shouldConvert && timezone) {
    tzMoment = tzMoment.tz(timezone);
  }

  const formatted = tzMoment.format('MMM D, YYYY [at] hh:mm A');

  let zoneLabel = trimmedCustomLabel;
  if (!zoneLabel) {
    if (shouldConvert && timezone === DEFAULT_TIMEZONE) {
      zoneLabel = 'EST';
    } else if (!shouldConvert && timezone === DEFAULT_TIMEZONE) {
      const comparisonMoment = moment.tz(tzMoment.valueOf(), timezone);
      zoneLabel = comparisonMoment.utcOffset() === tzMoment.utcOffset() ? 'EST' : buildUtcOffsetLabel(tzMoment);
    } else {
      zoneLabel = buildUtcOffsetLabel(tzMoment);
    }
  }

  const suffix = zoneLabel ? ` ${zoneLabel}` : '';
  return {
    subjectFragment: `${formatted}${suffix}`,
    display: `${formatted}${suffix}`,
    zoneLabel
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

function buildMockHtmlBody(details) {
  const caution = `<p style="font-family:Arial, sans-serif;font-size:14px;font-weight:600;color:#b91c1c;margin:0 0 12px;">Complete the mock before the day of interview.</p>`;
  const schedule = `<p style="font-family:Arial, sans-serif;font-size:14px;color:#0f1e3d;margin:0 0 12px;">Interview Round <strong>${escapeHtml(details.interviewRound)}</strong> is scheduled at <strong>${escapeHtml(details.interviewDateTimeDisplay)}</strong>.</p>`;
  const rows = [
    { label: 'Candidate Name', value: details.candidateName },
    { label: 'Email', value: details.candidateEmail },
    { label: 'Technology', value: details.technology },
    { label: 'Phone Number', value: details.contactNumber },
    { label: 'End Client', value: details.endClient }
  ];
  const tableHtml = buildHtmlTable(rows);
  const jobDescriptionSection = buildParagraphSection(details.jobDescriptionText);
  return `${caution}${schedule}${tableHtml}${jobDescriptionSection}`;
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

function buildAdditionalInfoSection(text = '') {
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

  return `<div style="margin:12px 0;">${paragraphs}</div>`;
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

function sanitizeStoredMockAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return [];
  }

  const maxBytes = config.support?.attachmentMaxBytes ?? 5 * 1024 * 1024;
  const allowedCategories = new Set(['resume', 'jobdescription']);
  const sanitized = [];

  for (const item of attachments) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const category = normalizeWhitespace(item.category || '').toLowerCase();
    if (category && !allowedCategories.has(category)) {
      continue;
    }

    const name = trimString(item.name || '');
    const rawData = typeof item.data === 'string' ? item.data.trim() : '';
    if (!name || !rawData) {
      continue;
    }

    let buffer;
    try {
      buffer = Buffer.from(rawData, 'base64');
    } catch (error) {
      continue;
    }

    if (buffer.length === 0 || buffer.length > maxBytes) {
      continue;
    }

    const contentTypeCandidate = trimString(item.type || '');
    const contentType = contentTypeCandidate || 'application/pdf';

    sanitized.push({
      name,
      contentType,
      contentBytes: buffer.toString('base64')
    });
  }

  return sanitized;
}

function sanitizeFlexibleAttachments(files = []) {
  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  const maxBytes = config.support?.attachmentMaxBytes ?? 5 * 1024 * 1024;
  return files.map((file) => {
    if (!file || typeof file.originalname !== 'string' || !file.buffer) {
      const error = new Error('Invalid attachment payload');
      error.statusCode = 400;
      throw error;
    }

    if (file.size > maxBytes) {
      const error = new Error(`${file.originalname} exceeds the maximum size of ${(maxBytes / (1024 * 1024)).toFixed(1)} MB`);
      error.statusCode = 400;
      throw error;
    }

    const rawName = path.basename(file.originalname).trim();
    const sanitizedName = rawName
      .replace(/[^\w.\-()\[\]\s]/g, '_')
      .replace(/\s+/g, ' ')
      .slice(0, 120) || 'attachment.dat';

    const contentType = file.mimetype && typeof file.mimetype === 'string'
      ? file.mimetype
      : 'application/octet-stream';

    return {
      filename: sanitizedName,
      content: file.buffer,
      contentType
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

    if (normalizedRole === 'recruiter') {
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

  buildAssessmentHtmlBody(data) {
    const sections = [];
    sections.push('<p style="font-family:Arial, sans-serif;font-size:14px;color:#0f1e3d;">Assessment support request details:</p>');

    if (data.screeningDone) {
      sections.push('<p style="font-family:Arial, sans-serif;font-size:14px;font-weight:700;color:#b91c1c;margin:0 0 12px;">Screening is done so prioritize this task.</p>');
    }

    const additionalInfo = typeof data.additionalInfo === 'string' ? data.additionalInfo : '';
    const additionalInfoSection = buildAdditionalInfoSection(additionalInfo);
    if (additionalInfoSection) {
      sections.push('<div style="font-family:Arial, sans-serif;font-size:13px;font-weight:600;color:#0f1e3d;margin:8px 0 4px;">Additional Info</div>');
      sections.push(additionalInfoSection);
    }

    const assessmentLabel = data.assessmentZoneLabel
      ? `Assessment Received (${data.assessmentZoneLabel})`
      : 'Assessment Received';

    const rows = [
      { label: assessmentLabel, value: data.assessmentDateTimeDisplay, highlight: true },
      { label: 'Candidate Name', value: data.candidateName },
      { label: 'Technology', value: data.technology },
      { label: 'Email ID', value: data.candidateEmail },
      { label: 'Contact Number', value: data.contactNumber },
      { label: 'End Client', value: data.endClient },
      { label: 'Job Title', value: data.jobTitle },
      { label: 'Assessment Duration', value: data.durationDisplay || 'Not provided' },
    ];

    const headerBaseStyle = 'padding:6px 12px;background:#031022;color:#fff;';
    const cellBaseStyle = 'padding:6px 12px;border:1px solid #0f1e3d;';
    const headerHighlightStyle = 'padding:6px 12px;background:#9a3412;color:#fff;font-weight:700;';
    const cellHighlightStyle = 'padding:6px 12px;border:2px solid #ca8a04;background:#fef08a;font-weight:700;color:#78350f;';

    const tableRows = rows
      .map((row) => {
        const safeLabel = escapeHtml(row.label);
        const safeValue = escapeHtml(row.value ?? '');
        const headerStyle = row.highlight ? headerHighlightStyle : headerBaseStyle;
        const cellStyle = row.highlight ? cellHighlightStyle : cellBaseStyle;
        return `<tr><th align="left" style="${headerStyle}">${safeLabel}</th><td style="${cellStyle}">${safeValue}</td></tr>`;
      })
      .join('');

    sections.push(`<table style="border-collapse:collapse;border:1px solid #0f1e3d;font-family:Arial, sans-serif;font-size:14px;min-width:420px;margin-top:8px;">${tableRows}</table>`);

    const jobDescriptionSection = buildParagraphSection(data.jobDescriptionText);
    if (jobDescriptionSection) {
      sections.push('<div style="font-family:Arial, sans-serif;font-size:13px;font-weight:600;color:#0f1e3d;margin-top:16px;">Job Description</div>');
      sections.push(jobDescriptionSection);
    }

    return sections.join('');
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
      const trimmed = trimString(value);
      if (!trimmed) {
        return null;
      }

      if (hasExplicitTimezone(trimmed)) {
        const zoned = moment.parseZone(trimmed, moment.ISO_8601, true);
        if (!zoned.isValid()) {
          return null;
        }
        return {
          moment: zoned,
          normalizedValue: trimmed
        };
      }

      const estMoment = moment.tz(trimmed, 'YYYY-MM-DDTHH:mm', DEFAULT_TIMEZONE);
      if (!estMoment.isValid()) {
        return null;
      }
      return {
        moment: estMoment,
        normalizedValue: estMoment.format('YYYY-MM-DDTHH:mm')
      };
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

      const parsedSlot = parseSlotMoment(interviewDateTimeInput);
      if (!parsedSlot) {
        const error = new Error('Provide a valid interview date and time in EST');
        error.statusCode = 400;
        throw error;
      }

      const slotMoment = parsedSlot.moment;

      if (slotMoment.isBefore(now)) {
        const error = new Error('Interview date and time must be in the future');
        error.statusCode = 400;
        throw error;
      }



      resolvedSlots.push({
        interviewDateTime: parsedSlot.normalizedValue,
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

        const parsedSlot = parseSlotMoment(slotDateTimeRaw);
        if (!parsedSlot) {
          const error = new Error('Loop slot has an invalid interview date/time');
          error.statusCode = 400;
          throw error;
        }

        const slotMoment = parsedSlot.moment;

        if (slotMoment.isBefore(now)) {
          const error = new Error('Loop slot must be scheduled in the future');
          error.statusCode = 400;
          throw error;
        }


        resolvedSlots.push({
          interviewDateTime: parsedSlot.normalizedValue,
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

  async sendAssessmentSupportRequest(user, payload = {}, files = {}, graphAccessToken) {
    const normalizedRole = this.ensureRoleAllowed(user);

    if (!graphAccessToken) {
      const error = new Error('Missing graph access token');
      error.statusCode = 401;
      throw error;
    }

    const candidateId = normalizeWhitespace(payload.candidateId || '');
    if (!candidateId) {
      const error = new Error('Candidate id is required');
      error.statusCode = 400;
      throw error;
    }

    const endClient = toTitleCase(payload.endClient || '');
    if (!endClient) {
      const error = new Error('End client is required');
      error.statusCode = 400;
      throw error;
    }

    const jobTitle = toTitleCase(payload.jobTitle || '');
    if (!jobTitle) {
      const error = new Error('Job title is required');
      error.statusCode = 400;
      throw error;
    }

    const receivedInputRaw = trimString(payload.assessmentReceivedDateTime || '');
    if (!receivedInputRaw) {
      const error = new Error('Assessment received date and time is required');
      error.statusCode = 400;
      throw error;
    }

    const hasSourceTimezone = hasExplicitTimezone(receivedInputRaw);
    let receivedMoment = moment.parseZone(receivedInputRaw, moment.ISO_8601, true);
    let preserveSourceTimezone = false;

    if (receivedMoment.isValid() && hasSourceTimezone) {
      preserveSourceTimezone = true;
    } else {
      receivedMoment = moment.tz(receivedInputRaw, 'YYYY-MM-DDTHH:mm', DEFAULT_TIMEZONE);
    }

    if (!receivedMoment.isValid()) {
      const error = new Error('Assessment received date and time is invalid');
      error.statusCode = 400;
      throw error;
    }

    const nowEst = moment().tz(DEFAULT_TIMEZONE);
    const comparisonMoment = preserveSourceTimezone
      ? receivedMoment.clone().tz(DEFAULT_TIMEZONE)
      : receivedMoment.clone();

    if (!comparisonMoment.isBefore(nowEst)) {
      const error = new Error('Assessment received date and time must be in the past');
      error.statusCode = 400;
      throw error;
    }

    const assessmentMomentDetails = formatDateTimeForEmail(receivedMoment, {
      convertToTimezone: !preserveSourceTimezone,
      timezone: DEFAULT_TIMEZONE,
      customLabel: preserveSourceTimezone ? buildUtcOffsetLabel(receivedMoment) : 'EST'
    });

    const noDurationMentioned = String(payload.noDurationMentioned ?? '').toLowerCase() === 'true';
    const rawDuration = trimString(payload.assessmentDuration || '');
    let durationDisplay = 'Not provided';
    if (noDurationMentioned) {
      durationDisplay = 'No duration mentioned';
    } else if (rawDuration) {
      durationDisplay = /^\d+$/u.test(rawDuration)
        ? `${rawDuration} minutes`
        : rawDuration;
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
    const technology = formatTechnology(
      payload.technology ||
      formattedCandidate.technology ||
      candidateRecord.technology ||
      ''
    );
    const candidateEmail = ensureEmail(
      formattedCandidate.email || candidateRecord.email || '',
      'Candidate email'
    );

    const requesterEmail = ensureEmail(user.email || '', 'Requester email');
    const requesterDisplay = deriveDisplayNameFromEmail(requesterEmail);

    let signatureHtml = '';
    try {
      const profileResult = await profileService.getProfile(requesterEmail);
      const profile = profileResult?.profile;
      if (profile?.isComplete) {
        signatureHtml = buildEmailSignatureHtml({
          email: requesterEmail,
          displayName: profile.displayName,
          jobRole: profile.jobRole,
          phoneNumber: profile.phoneNumber,
          companyName: profile.companyName,
          companyUrl: profile.companyUrl
        });
      }
    } catch (profileError) {
      logger.warn('Failed to build signature for assessment support email', {
        error: profileError instanceof Error ? profileError.message : profileError,
        email: requesterEmail
      });
    }

    const { teamLeadEmail, managerEmail } = this.gatherHierarchyEmails(recruiterEmail);

    const supportConfig = config.support || {};
    const toRecipients = new Set([supportConfig.supportTo || 'tech.leaders@silverspaceinc.com']);
    const ccRecipients = new Set(supportConfig.supportCcFallback || []);
    ccRecipients.add(requesterEmail);
    if (teamLeadEmail) {
      ccRecipients.add(teamLeadEmail);
    }
    if (managerEmail) {
      ccRecipients.add(managerEmail);
    }

    const resumeAttachments = sanitizeFlexibleAttachments(files.resume);
    const assessmentInfoAttachments = sanitizeFlexibleAttachments(files.assessmentInfo);
    const additionalAttachments = sanitizeFlexibleAttachments(files.additionalAttachments);

    if (resumeAttachments.length === 0) {
      const error = new Error('Attach the candidate resume before sending.');
      error.statusCode = 400;
      throw error;
    }

    if (assessmentInfoAttachments.length === 0) {
      const error = new Error('Attach the assessment information before sending.');
      error.statusCode = 400;
      throw error;
    }

    const allAttachments = [
      resumeAttachments[0],
      assessmentInfoAttachments[0],
      ...additionalAttachments
    ];

    const additionalInfo = typeof payload.additionalInfo === 'string' ? payload.additionalInfo : '';
    const jobDescriptionText = typeof payload.jobDescriptionText === 'string'
      ? payload.jobDescriptionText
      : '';
    const screeningDone = String(payload.screeningDone ?? '').toLowerCase() === 'true';

    const htmlBody = this.buildAssessmentHtmlBody({
      candidateName,
      technology,
      candidateEmail,
      contactNumber,
      endClient,
      jobTitle,
      assessmentDateTimeDisplay: assessmentMomentDetails.display,
      assessmentZoneLabel: assessmentMomentDetails.zoneLabel,
      durationDisplay,
      additionalInfo,
      jobDescriptionText,
      screeningDone
    });

    const preface = `<p style="font-family:Arial, sans-serif;font-size:14px;color:#0f1e3d;">Requested by <strong>${escapeHtml(requesterDisplay)}</strong> </p>`;
    const sections = [preface, htmlBody];
    if (signatureHtml) {
      sections.push(`<div style="margin-top:24px;">${signatureHtml}</div>`);
    }

    const message = {
      subject: `Assessment Support - ${candidateName} - ${jobTitle} - ${assessmentMomentDetails.subjectFragment}`,
      body: {
        contentType: 'HTML',
        content: sections.join('')
      },
      toRecipients: Array.from(toRecipients).map((address) => ({
        emailAddress: { address }
      })),
      ccRecipients: Array.from(ccRecipients).map((address) => ({
        emailAddress: { address }
      }))
    };

    if (allAttachments.length > 0) {
      message.attachments = allAttachments.map((attachment) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: attachment.filename,
        contentType: attachment.contentType,
        contentBytes: attachment.content.toString('base64')
      }));
    }

    await graphMailService.sendDelegatedMail(graphAccessToken, {
      message,
      saveToSentItems: true
    });

    logger.info('Assessment support request sent', {
      candidateEmail,
      requestedBy: requesterEmail,
      assessmentReceived: assessmentMomentDetails.display,
      to: Array.from(toRecipients),
      cc: Array.from(ccRecipients),
      attachments: allAttachments.length
    });

    return {
      success: true,
      message: 'Assessment support request sent'
    };
  }

  async sendMockInterviewRequest(user, payload = {}, graphAccessToken) {
    this.ensureRoleAllowed(user);

    if (!graphAccessToken) {
      const error = new Error('Missing graph access token');
      error.statusCode = 401;
      throw error;
    }

    const candidateName = toTitleCase(payload.candidateName || '');
    if (!candidateName) {
      const error = new Error('Candidate name is required');
      error.statusCode = 400;
      throw error;
    }

    const candidateEmail = ensureEmail(payload.candidateEmail || '', 'Candidate email');

    const contactNumber = trimString(payload.contactNumber || '');
    if (!contactNumber) {
      const error = new Error('Contact number is required');
      error.statusCode = 400;
      throw error;
    }

    const technology = formatTechnology(payload.technology || '');
    if (!technology) {
      const error = new Error('Technology is required');
      error.statusCode = 400;
      throw error;
    }

    const endClient = toTitleCase(payload.endClient || '');
    if (!endClient) {
      const error = new Error('End client is required');
      error.statusCode = 400;
      throw error;
    }

    const interviewRound = toTitleCase(payload.interviewRound || '');
    if (!interviewRound) {
      const error = new Error('Interview round is required');
      error.statusCode = 400;
      throw error;
    }

    const interviewDateTime = trimString(payload.interviewDateTime || '');
    if (!interviewDateTime) {
      const error = new Error('Interview date and time is required');
      error.statusCode = 400;
      throw error;
    }

    const interviewMomentDetails = formatDateTimeForEmail(interviewDateTime);

    const jobDescriptionText = typeof payload.jobDescriptionText === 'string'
      ? payload.jobDescriptionText
      : '';

    const storedAttachments = sanitizeStoredMockAttachments(payload.attachments);

    const supportConfig = config.support || {};
    const toRecipients = new Set([
      supportConfig.supportTo || 'tech.leaders@silverspaceinc.com'
    ]);
    const ccRecipients = new Set(supportConfig.supportCcFallback || []);

    const requesterEmail = ensureEmail(user.email || '', 'Requester email');
    ccRecipients.add(requesterEmail);

    const hierarchy = this.gatherHierarchyEmails(requesterEmail);
    if (hierarchy.teamLeadEmail) {
      ccRecipients.add(hierarchy.teamLeadEmail);
    }
    if (hierarchy.managerEmail) {
      ccRecipients.add(hierarchy.managerEmail);
    }

    let signatureHtml = '';
    try {
      const profileResult = await profileService.getProfile(requesterEmail);
      const profile = profileResult?.profile;
      if (profile?.isComplete) {
        signatureHtml = buildEmailSignatureHtml({
          email: requesterEmail,
          displayName: profile.displayName,
          jobRole: profile.jobRole,
          phoneNumber: profile.phoneNumber,
          companyName: profile.companyName,
          companyUrl: profile.companyUrl
        });
      }
    } catch (profileError) {
      logger.warn('Failed to build signature for mock request email', {
        error: profileError instanceof Error ? profileError.message : profileError,
        email: requesterEmail
      });
    }

    const htmlBody = buildMockHtmlBody({
      candidateName,
      candidateEmail,
      technology,
      contactNumber,
      endClient,
      interviewRound,
      interviewDateTimeDisplay: interviewMomentDetails.display,
      jobDescriptionText
    });

    const sections = [htmlBody];
    if (signatureHtml) {
      sections.push(`<div style="margin-top:24px;">${signatureHtml}</div>`);
    }

    const subjectTechnology = technology || 'General';
    const message = {
      subject: `Mock Interview - ${candidateName} - ${subjectTechnology} - Training - ${interviewMomentDetails.subjectFragment}`,
      body: {
        contentType: 'HTML',
        content: sections.join('')
      },
      toRecipients: Array.from(toRecipients).map((address) => ({
        emailAddress: { address }
      })),
      ccRecipients: Array.from(ccRecipients).map((address) => ({
        emailAddress: { address }
      }))
    };

    if (storedAttachments.length > 0) {
      message.attachments = storedAttachments.map((attachment) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: attachment.name,
        contentType: attachment.contentType,
        contentBytes: attachment.contentBytes
      }));
    }

    await graphMailService.sendDelegatedMail(graphAccessToken, {
      message,
      saveToSentItems: true
    });

    logger.info('Mock interview request sent', {
      candidateEmail,
      requestedBy: requesterEmail,
      interviewDateTime,
      to: Array.from(toRecipients),
      cc: Array.from(ccRecipients),
      attachments: storedAttachments.length
    });

    return {
      success: true,
      message: 'Mock interview request sent'
    };
  }
}

export const supportRequestService = new SupportRequestService();
