// PRT Phase 3 — pure builder for the Assignment Email.
//
// This file owns the verbatim PRD §6.2 body template and token
// substitution. It performs NO I/O — all data (candidate fields,
// resolved recipient emails, attachment bytes) is passed in by
// candidateService.sendAssignmentEmail.
//
// Why a separate module?
//   - Keeps the §6.2 template integrity testable in isolation (no DB
//     or Graph mocks required).
//   - candidateService can keep the orchestration logic (retry, audit,
//     ackEmail flip) free of template/markup details.

const TEMPLATE_LINES = [
  '__GREETING__',
  'Kindly assign this candidate profile to __RECRUITER__ and initiate the marketing within 24 hours. If for any reason it is delayed, please reply all to this email.',
  'Candidate contact details and supporting documents are attached to this email for your reference.',
  'Once the introductory call is completed, please reply to this email with the following details for the compliance email:',
  '__LIST_COMPLIANCE__',
  'Kindly collect the below documents: (Do NOT ask if already attached - only verify)',
  '__LIST_DOCUMENTS__',
  'Note 1: Please check with the candidate for actual experience(s) which may or may not be on the resume. Ensure the reason for any omission is clarified and take written confirmation from the candidate.',
  'Note 2: Once I receive your response, I will send an acknowledgment email to the candidate and BCC both you and the recruiter. Only after the candidate confirms, you may proceed with the marketing efforts for this profile.',
  'Best Regards,',
  '__SENDER__'
];

const COMPLIANCE_BULLETS = [
  "Candidate's location preference",
  'Salary expectations',
  'Visa status',
  'EAD start date and end date',
  'A brief summary of what was discussed during the intro call'
];

const DOCUMENT_BULLETS = [
  'References, if the candidate has a client on the resume',
  'Credentials for marketing'
];

const SAFE_TEXT_FALLBACK = '—';

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphHtml(text) {
  return `<p>${escapeHtml(text)}</p>`;
}

function listHtml(items) {
  return `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

function dedupeLower(emails) {
  const seen = new Set();
  const result = [];
  for (const raw of emails) {
    const trimmed = (raw || '').toString().trim().toLowerCase();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function err(message, statusCode = 400) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

/**
 * Build the Microsoft Graph sendMail payload for the Assignment Email.
 *
 * @param {object} args
 * @param {string} args.candidateName       — for subject token
 * @param {string} [args.technology]        — for subject token
 * @param {string} [args.visaType]          — for subject token
 * @param {string} args.recruiterEmail      — primary To recipient
 * @param {string} args.recruiterDisplayName — body token [Recruiter Name]
 * @param {string} args.teamLeadEmail       — CC recipient
 * @param {string} args.teamLeadDisplayName — body token [Team Lead Name]
 * @param {string} [args.managerEmail]      — CC recipient (recruiter's manager)
 * @param {string} args.permanentCcEmail    — server-injected, never optional
 * @param {string} args.senderEmail         — only used for logging / audit
 * @param {string} args.senderDisplayName   — body token [Sender Name]
 * @param {Array<{ filename: string, mimeType: string, contentBytesBase64: string }>} args.attachments
 * @param {string} [args.appendBody]        — optional user prepend (read-only template below)
 */
export function buildAssignmentEmail(args = {}) {
  const {
    candidateName,
    technology,
    visaType,
    recruiterEmail,
    recruiterDisplayName,
    teamLeadEmail,
    teamLeadDisplayName,
    managerEmail,
    permanentCcEmail,
    senderEmail,
    senderDisplayName,
    attachments,
    appendBody
  } = args;

  if (!candidateName) throw err('Candidate Name is required');
  if (!recruiterEmail) throw err('Recruiter email is required');
  if (!recruiterDisplayName) throw err('Recruiter name is required');
  if (!teamLeadDisplayName) throw err('Team Lead is required');
  if (!senderDisplayName) throw err('Sender display name is required');
  if (!permanentCcEmail) throw err('Permanent CC is not configured');
  if (!Array.isArray(attachments) || attachments.length === 0) {
    throw err('At least one attachment is required');
  }
  for (const a of attachments) {
    if (!a || !a.filename || !a.mimeType || !a.contentBytesBase64) {
      throw err('Invalid attachment payload');
    }
  }

  const subject = `Assignment: ${candidateName} – ${technology || SAFE_TEXT_FALLBACK} – ${visaType || SAFE_TEXT_FALLBACK}`;

  const sectionsHtml = TEMPLATE_LINES.map((token) => {
    switch (token) {
      case '__GREETING__':
        return paragraphHtml(`Hi ${teamLeadDisplayName},`);
      case '__SENDER__':
        return paragraphHtml(senderDisplayName);
      case '__LIST_COMPLIANCE__':
        return listHtml(COMPLIANCE_BULLETS);
      case '__LIST_DOCUMENTS__':
        return listHtml(DOCUMENT_BULLETS);
      default:
        return paragraphHtml(token.replace('__RECRUITER__', recruiterDisplayName));
    }
  }).join('');

  const prepend = appendBody && String(appendBody).trim().length > 0
    ? `${paragraphHtml(String(appendBody).trim())}<hr/>`
    : '';

  const bodyHtml = `${prepend}${sectionsHtml}`;

  // Recipients — server-injected permanentCc ALWAYS present in CC, even
  // if the UI tried to remove it. Per PRD §6.3 the locked chip is
  // decorative; the server is source of truth.
  const ccEmails = dedupeLower([managerEmail, teamLeadEmail, permanentCcEmail]);
  const toEmails = dedupeLower([recruiterEmail]);

  return {
    message: {
      subject,
      body: { contentType: 'HTML', content: bodyHtml },
      toRecipients: toEmails.map((address) => ({ emailAddress: { address } })),
      ccRecipients: ccEmails.map((address) => ({ emailAddress: { address } })),
      bccRecipients: [],
      attachments: attachments.map((a) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.filename,
        contentType: a.mimeType,
        contentBytes: a.contentBytesBase64
      }))
    },
    saveToSentItems: true,
    // Audit-only metadata (NOT sent to Graph). The orchestrator pulls
    // these into the assignmentEmails[] entry.
    _audit: {
      subject,
      senderEmail: (senderEmail || '').toLowerCase(),
      to: toEmails,
      cc: ccEmails,
      bcc: [],
      attachmentIds: attachments.map((a) => a.id).filter(Boolean)
    }
  };
}
