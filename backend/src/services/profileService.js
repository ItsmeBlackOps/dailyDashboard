import { userModel } from '../models/User.js';
import { logger } from '../utils/logger.js';

const COMPANY_PROFILES = [
  {
    domains: ['vizvaconsultancyservices.com', 'vizvainc.com', 'vizva.inc'],
    name: 'Vizva Consultancy Services',
    url: 'https://www.vizvaconsultancyservices.com'
  },
  {
    domains: ['silverspaceinc.com'],
    name: 'Silverspace Inc.',
    url: 'https://www.silverspaceinc.com'
  }
];

function deriveDisplayNameFromEmail(email = '') {
  const local = email.split('@')[0] || '';
  return local
    .split(/[._\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function determineCompany(email = '') {
  const lower = email.toLowerCase();
  const profile = COMPANY_PROFILES.find(({ domains }) =>
    domains.some((domain) => lower.endsWith(`@${domain}`) || lower.endsWith(domain))
  );

  if (profile) {
    return profile;
  }

  return {
    name: '',
    url: ''
  };
}

function sanitizeLine(value = '', { allowSymbols = false } = {}) {
  const trimmed = value.toString().trim();
  if (!trimmed) return '';
  const withoutTags = trimmed.replace(/<[^>]*>/g, '').replace(/[<>]/g, '');
  const pattern = allowSymbols
    ? /[^\p{L}\d\s.,&()\-+/'#]/gu
    : /[^\p{L}\d\s]/gu;
  return withoutTags.replace(pattern, '').slice(0, 120);
}

function formatUsPhone(value = '') {
  const digits = value.replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  let normalized = digits;
  if (normalized.length === 10) {
    normalized = `1${normalized}`;
  }

  if (normalized.length !== 11 || !normalized.startsWith('1')) {
    return '';
  }

  const area = normalized.slice(1, 4);
  const prefix = normalized.slice(4, 7);
  const line = normalized.slice(7, 11);

  return `+1 (${area}) ${prefix}-${line}`;
}

class ProfileService {
  async getProfile(email) {
    if (!email) {
      throw new Error('Email is required');
    }

    const lowerEmail = email.toLowerCase();
    const [record, company] = await Promise.all([
      userModel.getUserProfileMetadata(lowerEmail),
      Promise.resolve(determineCompany(lowerEmail))
    ]);

    const stored = record?.metadata ?? record?.profile ?? {};

    const profile = {
      email: lowerEmail,
      displayName: sanitizeLine(stored.displayName || deriveDisplayNameFromEmail(lowerEmail), { allowSymbols: true }),
      jobRole: sanitizeLine(stored.jobRole || '', { allowSymbols: true }),
      phoneNumber: formatUsPhone(stored.phoneNumber || ''),
      companyName: company.name || sanitizeLine(stored.companyName || '', { allowSymbols: true }),
      companyUrl: company.url || (typeof stored.companyUrl === 'string' ? stored.companyUrl : ''),
    };

    const isComplete = Boolean(
      profile.displayName && profile.jobRole && profile.phoneNumber && profile.companyName && profile.companyUrl
    );

    return {
      success: true,
      profile: {
        ...profile,
        isComplete
      }
    };
  }

  async updateProfile(email, payload = {}) {
    if (!email) {
      throw new Error('Email is required');
    }

    const lowerEmail = email.toLowerCase();
    const company = determineCompany(lowerEmail);

    const displayName = sanitizeLine(payload.displayName || deriveDisplayNameFromEmail(lowerEmail), { allowSymbols: true });
    const jobRole = sanitizeLine(payload.jobRole || '', { allowSymbols: true });
    const formattedPhone = formatUsPhone(payload.phoneNumber || '');

    if (!displayName) {
      const error = new Error('Display name is required');
      error.statusCode = 400;
      throw error;
    }

    if (!jobRole) {
      const error = new Error('Job role is required');
      error.statusCode = 400;
      throw error;
    }

    if (!formattedPhone) {
      const error = new Error('Phone number must follow +1 (123) 456-7890 format');
      error.statusCode = 400;
      throw error;
    }

    const metadata = {
      displayName,
      jobRole,
      phoneNumber: formattedPhone,
      companyName: company.name,
      companyUrl: company.url
    };

    try {
      await userModel.upsertUserProfileMetadata(lowerEmail, metadata);
    } catch (error) {
      throw error;
    }

    logger.info('User profile metadata updated', {
      email: lowerEmail,
      company: metadata.companyName
    });

    return {
      success: true,
      profile: {
        email: lowerEmail,
        ...metadata,
        isComplete: Boolean(metadata.displayName && metadata.jobRole && metadata.phoneNumber && metadata.companyName && metadata.companyUrl)
      }
    };
  }
}

export const profileService = new ProfileService();
