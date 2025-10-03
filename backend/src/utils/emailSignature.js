function escapeHtml(value = '') {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const COMPANY_ASSETS = {
  'Vizva Consultancy Services': {
    logo: 'https://egvjgtfjstxgszpzvvbx.supabase.co/storage/v1/object/public/images//20250611_1634_3D%20Logo%20Design_remix_01jxgb3x1qebfa2hsxw7sdagw1%20(1).png'
  },
  'Silverspace Inc.': {
    logo: 'https://egvjgtfjstxgszpzvvbx.supabase.co/storage/v1/object/public/images//20250610_1111_3D%20Gradient%20Logo_remix_01jxd69dc9ex29jbj9r701yjkf%20(2).png'
  }
};

function normalizeUrl(url = '') {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed.replace(/^\/*/, '')}`;
}

export function buildEmailSignatureHtml(profile) {
  if (!profile) return '';
  const {
    email,
    displayName,
    jobRole,
    phoneNumber,
    companyName,
    companyUrl
  } = profile;

  if (!displayName || !jobRole || !phoneNumber || !companyName || !companyUrl || !email) {
    return '';
  }

  const safeEmail = escapeHtml(email.toLowerCase());
  const safeName = escapeHtml(displayName);
  const safeRole = escapeHtml(jobRole);
  const safePhone = escapeHtml(phoneNumber);
  const normalizedUrl = normalizeUrl(companyUrl);
  const safeCompanyName = escapeHtml(companyName);
  const urlForDisplay = normalizedUrl.replace(/^https?:\/\//i, '');
  const assets = COMPANY_ASSETS[companyName] || {};

  const logoSrc = assets.logo || '';
  const logoCell = logoSrc
    ? `<td style="padding-right:20px;vertical-align:top;">
        <img src="${logoSrc}" alt="${safeCompanyName} logo" width="130" style="display:block;max-width:100%;height:auto;" />
      </td>`
    : '';

  return `
    <table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial, sans-serif;font-size:14px;color:#0f1e3d;">
      <tbody>
        <tr>
          ${logoCell}
          <td style="padding-left:${logoCell ? '20px' : '0'};border-left:${logoCell ? '2px solid #f86295' : 'none'};">
            <strong style="font-size:18px;color:#0f1e3d;display:block;margin-bottom:4px;">${safeName}</strong>
            <span style="display:block;margin-bottom:4px;color:#1f2a55;">${safeRole}</span>
            <span style="display:block;margin-bottom:12px;color:#4b4e6d;">${safeCompanyName}</span>
            <a href="mailto:${safeEmail}" style="color:#1f2a55;text-decoration:none;display:block;margin-bottom:4px;">📧 ${safeEmail}</a>
            <a href="tel:${escapeHtml(phoneNumber.replace(/[^0-9+]/g, ''))}" style="color:#1f2a55;text-decoration:none;display:block;margin-bottom:4px;">📞 ${safePhone}</a>
            <a href="${escapeHtml(normalizedUrl)}" style="color:#1f2a55;text-decoration:none;display:block;" target="_blank" rel="noopener noreferrer">🔗 ${escapeHtml(urlForDisplay)}</a>
          </td>
        </tr>
      </tbody>
    </table>
  `.trim();
}
