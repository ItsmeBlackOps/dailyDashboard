/**
 * Build per-candidate Apify inputs for both Fantastic Jobs actors:
 *   - fantastic-jobs/career-site-job-listing-api  (career-site / ATS feeds)
 *   - fantastic-jobs/advanced-linkedin-job-search-api  (LinkedIn)
 *
 * Both actors are pay-per-result — empty 1h windows cost ~$0 — making
 * tight, narrow per-candidate filtering economical at hourly cadence.
 *
 * Inputs are derived from the candidate's forgeProfile (resume-derived):
 *   titles[]           → titleSearch
 *   keywords[]         → descriptionSearch
 *   industries[]       → aiTaxonomiesPrimaryFilter
 *   baseline_skills[]  → top-up for descriptionSearch when keywords short
 *   years_min/max      → bucket + descriptionExclusionSearch + titleExclusionSearch
 */

const FIXED_LOCATION_SEARCH = [
  'United States',
  'Alabama:*', 'Alaska:*', 'Arizona:*', 'Arkansas:*', 'California:*',
  'Colorado:*', 'Connecticut:*', 'Delaware:*', 'Florida:*', 'Georgia:*',
  'Hawaii:*', 'Idaho:*', 'Illinois:*', 'Indiana:*', 'Iowa:*',
  'Kansas:*', 'Kentucky:*', 'Louisiana:*', 'Maine:*', 'Maryland:*',
  'Massachusetts:*', 'Michigan:*', 'Minnesota:*', 'Mississippi:*', 'Missouri:*',
  'Montana:*', 'Nebraska:*', 'Nevada:*', 'New Hampshire:*', 'New Jersey:*',
  'New Mexico:*', 'New York:*', 'North Carolina:*', 'North Dakota:*', 'Ohio:*',
  'Oklahoma:*', 'Oregon:*', 'Pennsylvania:*', 'Rhode Island:*', 'South Carolina:*',
  'South Dakota:*', 'Tennessee:*', 'Texas:*', 'Utah:*', 'Vermont:*',
  'Virginia:*', 'Washington:*', 'West Virginia:*', 'Wisconsin:*', 'Wyoming:*',
  'District of Columbia:*',
  'Remote',
];

// Single primary bucket from years_max (4yr → "2-5", not bucket-overlap).
function bucketsForActor(yearsMin, yearsMax) {
  const yMax = Number(yearsMax ?? yearsMin ?? 0);
  if (yMax < 2) return ['0-2'];
  if (yMax < 5) return ['2-5'];
  if (yMax < 10) return ['5-10'];
  return ['10+'];
}

function buildDescriptionExclusion(yearsMax, upperTol = 1) {
  const ceiling = Number(yearsMax ?? 0) + upperTol;
  const exclusions = [];
  for (let n = ceiling + 1; n <= 12; n++) exclusions.push(`${n}+ years`);
  exclusions.push('visa sponsorship required');
  exclusions.push('must have green card');
  exclusions.push('us citizen only');
  return exclusions;
}

function buildTitleExclusion(yearsMax) {
  const y = Number(yearsMax ?? 0);
  const always = ['Intern', 'Internship'];
  if (y < 2)  return [...always, 'Senior', 'Sr.', 'Lead', 'Principal', 'Staff', 'Manager', 'Director', 'Head', 'VP', 'Chief', 'III', 'IV'];
  if (y < 5)  return [...always, 'Manager', 'Director', 'Principal', 'Staff', 'Lead', 'Head', 'VP', 'Chief', 'IV'];
  if (y < 10) return [...always, 'VP', 'Chief', 'Head of'];
  return always;
}

const TAXONOMY_RULES = [
  [/data analyst|business intelligence|bi analyst|analytics|data scientist|data engineer|ml engineer|machine learning/i,
    ['Data & Analytics', 'Technology', 'Software']],
  [/business analyst|financial analyst|operations analyst|risk|product analyst/i,
    ['Data & Analytics', 'Finance & Accounting', 'Consulting']],
  [/healthcare|clinical|medicare|medicaid|hedis|claims|pharma/i, ['Healthcare']],
  [/software engineer|backend|full[- ]stack|frontend|developer|java|python|node|react|swe/i,
    ['Software', 'Technology', 'Engineering']],
  [/devops|sre|site reliability|cloud engineer|platform engineer|infrastructure/i,
    ['Software', 'Technology', 'Engineering']],
  [/security|cybersecurity|infosec/i, ['Security & Safety', 'Technology']],
  [/qa|quality assurance|sdet|test engineer/i, ['Software', 'Technology']],
  [/sales|account executive|business development/i, ['Sales']],
  [/marketing|growth|seo/i, ['Marketing']],
];

function deriveTaxonomiesFallback(titles, baselineSkills) {
  const haystack = [...(titles || []), ...(baselineSkills || [])].join(' ').toLowerCase();
  const set = new Set();
  for (const [pattern, tags] of TAXONOMY_RULES) {
    if (pattern.test(haystack)) tags.forEach(t => set.add(t));
  }
  if (set.size === 0) ['Technology', 'Software', 'Data & Analytics'].forEach(t => set.add(t));
  return [...set];
}

function descriptionSearchFromForge(fp) {
  const kw = Array.isArray(fp.keywords) ? fp.keywords.filter(Boolean) : [];
  const sk = Array.isArray(fp.baseline_skills) ? fp.baseline_skills.filter(Boolean) : [];
  // Prefer keywords (already curated). Top up with skills until ~16. Title-case
  // for prettier output (the actor matches case-insensitive anyway).
  const merged = [...new Set([...kw, ...sk])].slice(0, 16);
  return merged.map((s) => (s.length > 1 ? s[0].toUpperCase() + s.slice(1) : s));
}

// Compute "N back from now" as the actor's expected ISO-ish format
// "YYYY-MM-DD HH:mm:ss UTC". timeRange '1h' → 1 hour ago.
function datePostedAfterFromTimeRange(tr = '1h') {
  const ms = tr === '1h' ? 3600 * 1000
    : tr === '24h' ? 86400 * 1000
    : tr === '7d' ? 7 * 86400 * 1000
    : 30 * 86400 * 1000;
  return new Date(Date.now() - ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function commonInputs(candidate, opts = {}) {
  const fp = candidate.forgeProfile || {};
  const titles = Array.isArray(fp.titles) ? fp.titles.filter(Boolean) : [];
  if (titles.length === 0) {
    throw new Error('Candidate has no forgeProfile.titles — cannot build Apify input');
  }
  const taxonomies = (Array.isArray(fp.industries) && fp.industries.length > 0)
    ? fp.industries
    : deriveTaxonomiesFallback(titles, fp.baseline_skills);

  return {
    titleSearch: [...new Set(titles)].slice(0, 25),
    titleExclusionSearch: buildTitleExclusion(fp.years_max),
    descriptionSearch: descriptionSearchFromForge(fp),
    descriptionExclusionSearch: buildDescriptionExclusion(fp.years_max),
    descriptionType: 'text',
    locationSearch: FIXED_LOCATION_SEARCH,
    aiExperienceLevelFilter: bucketsForActor(fp.years_min, fp.years_max),
    aiWorkArrangementFilter: ['On-site', 'Hybrid', 'Remote OK', 'Remote Solely'],
    aiTaxonomiesPrimaryFilter: taxonomies,
    aiHasSalary: false,
    aiVisaSponsorshipFilter: opts.needsVisaSponsorship === true,
    includeAi: true,
    populateAiRemoteLocation: false,
    populateAiRemoteLocationDerived: false,
    limit: opts.limit || 500,
  };
}

/**
 * Build input for fantastic-jobs/career-site-job-listing-api.
 *
 * Uses `datePostedAfter` (not `timeRange`) so we get exact "past N hours"
 * windowing. Also sets `noDirectApply: true` and `removeAgency: false`
 * per spec.
 */
export function buildCareerSiteInput(candidate, opts = {}) {
  return {
    ...commonInputs(candidate, opts),
    datePostedAfter: datePostedAfterFromTimeRange(opts.timeRange || '1h'),
    aiEmploymentTypeFilter: ['FULL_TIME', 'CONTRACTOR'],
    includeLinkedIn: false,
    removeAgency: false,
    noDirectApply: true,
    'remote only (legacy)': false,
  };
}

/**
 * Build input for fantastic-jobs/advanced-linkedin-job-search-api.
 * Distinct fields: directApply, excludeATSDuplicate, externalApplyUrl,
 * populateExternalApplyURL, remote (boolean), datePostedAfter.
 */
export function buildLinkedInInput(candidate, opts = {}) {
  return {
    ...commonInputs(candidate, opts),
    datePostedAfter: datePostedAfterFromTimeRange(opts.timeRange || '1h'),
    directApply: false,
    excludeATSDuplicate: false,
    externalApplyUrl: false,
    populateExternalApplyURL: false,
    noDirectApply: false,
    remote: false,
    removeAgency: false,
  };
}

/**
 * Convenience wrapper. Pick the right builder by actor key.
 *   actor: 'career-site' (default) | 'linkedin'
 */
export function buildApifyInput(candidate, opts = {}) {
  const actor = opts.actor || 'career-site';
  if (actor === 'linkedin') return buildLinkedInInput(candidate, opts);
  return buildCareerSiteInput(candidate, opts);
}

export const _internals = {
  buildDescriptionExclusion,
  buildTitleExclusion,
  bucketsForActor,
  deriveTaxonomiesFallback,
  descriptionSearchFromForge,
  FIXED_LOCATION_SEARCH,
};
