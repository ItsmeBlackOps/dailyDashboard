import React from 'react';
import DOMPurify from 'dompurify';

export interface EmailSignatureData {
  email: string;
  displayName: string;
  jobRole: string;
  phoneNumber: string;
  companyName: string;
  companyUrl: string;
}

const COMPANY_ASSETS: Record<string, { logo?: string }> = {
  'Vizva Consultancy Services': {
    logo: 'https://egvjgtfjstxgszpzvvbx.supabase.co/storage/v1/object/public/images//20250611_1634_3D%20Logo%20Design_remix_01jxgb3x1qebfa2hsxw7sdagw1%20(1).png'
  },
  'Silverspace Inc.': {
    logo: 'https://egvjgtfjstxgszpzvvbx.supabase.co/storage/v1/object/public/images//20250610_1111_3D%20Gradient%20Logo_remix_01jxd69dc9ex29jbj9r701yjkf%20(2).png'
  }
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeUrl(url: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed.replace(/^\/*/, '')}`;
}

export function buildEmailSignatureHtml(data: EmailSignatureData | null | undefined): string {
  if (!data) return '';
  const { email, displayName, jobRole, phoneNumber, companyName, companyUrl } = data;

  if (!email || !displayName || !jobRole || !phoneNumber || !companyName || !companyUrl) {
    return '';
  }

  const normalizedEmail = email.toLowerCase();
  const safeEmail = escapeHtml(normalizedEmail);
  const safeName = escapeHtml(displayName);
  const safeRole = escapeHtml(jobRole);
  const safePhone = escapeHtml(phoneNumber);
  const normalizedUrl = normalizeUrl(companyUrl);
  const safeCompanyName = escapeHtml(companyName);
  const displayUrl = escapeHtml(normalizedUrl.replace(/^https?:\/\//i, ''));
  const phoneHref = escapeHtml(phoneNumber.replace(/[^0-9+]/g, ''));
  const assets = COMPANY_ASSETS[companyName] || {};

  const logoCell = assets.logo
    ? `<td style="padding-right:20px;vertical-align:top;">
        <img src="${escapeHtml(assets.logo)}" alt="${safeCompanyName} logo" width="130" style="display:block;max-width:100%;height:auto;" />
      </td>`
    : '';

  const borderStyles = logoCell ? 'border-left:2px solid #f86295;padding-left:20px;' : '';

  return `
    <table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial, sans-serif;font-size:14px;color:#0f1e3d;">
      <tbody>
        <tr>
          ${logoCell}
          <td style="${borderStyles}">
            <strong style="font-size:18px;color:#0f1e3d;display:block;margin-bottom:4px;">${safeName}</strong>
            <span style="display:block;margin-bottom:4px;color:#1f2a55;">${safeRole}</span>
            <span style="display:block;margin-bottom:12px;color:#4b4e6d;">${safeCompanyName}</span>
            <a href="mailto:${safeEmail}" style="color:#1f2a55;text-decoration:none;display:block;margin-bottom:4px;">📧 ${safeEmail}</a>
            <a href="tel:${phoneHref}" style="color:#1f2a55;text-decoration:none;display:block;margin-bottom:4px;">📞 ${safePhone}</a>
            <a href="${escapeHtml(normalizedUrl)}" target="_blank" rel="noopener noreferrer" style="color:#1f2a55;text-decoration:none;display:block;">🔗 ${displayUrl}</a>
          </td>
        </tr>
      </tbody>
    </table>
  `.trim();
}

interface EmailSignatureProps {
  data: EmailSignatureData | null;
}

export const EmailSignature: React.FC<EmailSignatureProps> = ({ data }) => {
  const html = buildEmailSignatureHtml(data);
  if (!html) {
    return null;
  }

  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['table', 'tbody', 'tr', 'td', 'strong', 'span', 'a', 'img'],
    ALLOWED_ATTR: {
      table: ['cellpadding', 'cellspacing', 'border', 'style'],
      td: ['style'],
      tr: ['style'],
      strong: ['style'],
      span: ['style'],
      a: ['href', 'style', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'style']
    }
  });

  return <div dangerouslySetInnerHTML={{ __html: sanitized }} />;
};

export default EmailSignature;
