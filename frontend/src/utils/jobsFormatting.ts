// Ported from .aurora-design-ref/jobs-design/jobs/components.jsx

export const STATE_MAP: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS',
  Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI',
  Wyoming: 'WY', Ontario: 'ON', Quebec: 'QC',
};

export function shortLoc(l: string | null | undefined): string {
  if (!l) return '—';
  if (l.toLowerCase().includes('remote')) {
    const rest = l.replace(/remote,?/i, '').trim().replace(/^,\s*/, '');
    return rest ? `Remote · ${rest}` : 'Remote';
  }
  const parts = l.split(',').map((s) => s.trim());
  if (parts.length >= 3) {
    const st = STATE_MAP[parts[1]] || parts[1];
    return `${parts[0]}, ${st}`;
  }
  return parts.slice(0, 2).join(', ');
}

export function relTime(d: Date, now?: Date): string {
  const ref = now ?? new Date();
  const diff = (ref.getTime() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export const ATS_LABEL: Record<string, string> = {
  workday: 'Workday',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  paycom: 'Paycom',
  jazzhr: 'JazzHR',
  adp: 'ADP',
  jobvite: 'Jobvite',
  smartrecruiters: 'SmartRecruiters',
  linkedin: 'LinkedIn',
};

export function companyInitials(company: string): string {
  return company
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

const HUES = [264, 188, 320, 90, 38, 12, 158, 220];
export function companyHue(company: string): number {
  const seed = company.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return HUES[seed % HUES.length];
}
