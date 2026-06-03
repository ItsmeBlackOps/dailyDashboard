import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { userModel } from '../src/models/User.js';

// Perf regression guard for the Branch Candidates LIST path. The list formats
// ~1,400 rows per load; the only per-row directory hit inside
// formatCandidateRecord is the team-lead resolution, which fans out to
// userModel.getAllUsers (an in-memory cache rebuilt + scanned per call).
// `{ lean: true }` must skip that resolution entirely so a full list format
// touches the user directory ZERO times. The frontend list/edit never reads
// teamLead from list records, so dropping it for the list is safe; detail and
// update paths keep the full (non-lean) formatter.

const origGetAll = userModel.getAllUsers;
const origGetByEmail = userModel.getUserByEmail;

afterEach(() => {
  userModel.getAllUsers = origGetAll;
  userModel.getUserByEmail = origGetByEmail;
  jest.restoreAllMocks();
});

const USERS = [
  { email: 'satyam@vizvainc.com', name: 'Satyam Gupta', role: 'teamLead', team: 'marketing' },
  { email: 'rec@vizvainc.com', name: 'Aadesh Chauhan', role: 'recruiter', teamLead: 'Satyam Gupta' },
];

function mockDirectory() {
  userModel.getAllUsers = jest.fn(() => USERS);
  userModel.getUserByEmail = jest.fn((e) => USERS.find((u) => u.email === (e || '').toLowerCase()) || null);
}

// A doc carrying every field the Branch Candidates list/edit dialog reads,
// plus a recruiter whose team lead is resolvable (so non-lean DOES resolve).
function sampleDoc(overrides = {}) {
  return {
    _id: { toString: () => 'b'.repeat(24) },
    name: 'dhanya sree nathani',
    'Email ID': 'dhanya@x.com',
    'Contact No': '+12193688385',
    technology: 'software developer',
    Recruiter: 'rec@vizvainc.com',
    expert: 'expert@x.com',
    status: 'Active',
    visaType: 'H1B',
    company: 'SST',
    eadEndDate: '2026-12-31',
    teamLead: 'Satyam Gupta',
    ...overrides,
  };
}

const MARKETING_VIEWER = { email: 'mm@x.com', role: 'mm' };

describe('candidateService.formatCandidateRecord — lean LIST mode', () => {
  it('formats many candidates without EVER hitting the user directory in lean mode', () => {
    mockDirectory();
    const docs = Array.from({ length: 5 }, () => sampleDoc());

    docs.forEach((doc) => candidateService.formatCandidateRecord(doc, MARKETING_VIEWER, { lean: true }));

    // The whole point of the fix: zero getAllUsers calls across the full list.
    expect(userModel.getAllUsers).not.toHaveBeenCalled();
    expect(userModel.getUserByEmail).not.toHaveBeenCalled();
  });

  it('lean output still carries every frontend-read list/edit field', () => {
    mockDirectory();
    const out = candidateService.formatCandidateRecord(sampleDoc(), MARKETING_VIEWER, { lean: true });

    expect(out.name).toBe('Dhanya Sree Nathani');
    expect(out.email).toBe('dhanya@x.com');
    expect(out.contact).toBe('+12193688385');
    expect(out.technology).toBe('Software Developer');
    // recruiter/expert display names are derived from the email local-part by
    // formatDisplayName — they do NOT read the user directory.
    expect(out.recruiter).toBe('Rec');
    expect(out.recruiterRaw).toBe('rec@vizvainc.com');
    expect(out.expert).toBe('Expert');
    expect(out.expertRaw).toBe('expert@x.com');
    expect(out.status).toBe('Active');
    expect(out.expiringInDays).toEqual(expect.any(Number));
    expect(out.visaType).toBe('H1B');
    expect(out.company).toBe('SST');
  });

  it('lean output has no resolved teamLead (null/undefined)', () => {
    mockDirectory();
    const out = candidateService.formatCandidateRecord(sampleDoc(), MARKETING_VIEWER, { lean: true });
    expect(out.teamLead == null).toBe(true);
  });

  it('NON-lean mode (default) still resolves teamLead via the directory', () => {
    mockDirectory();
    const out = candidateService.formatCandidateRecord(sampleDoc(), MARKETING_VIEWER);

    expect(userModel.getAllUsers).toHaveBeenCalled();
    expect(out.teamLead).toBe('satyam@vizvainc.com');
  });

  it('still strips PRT fields for a non-marketing viewer in lean mode (visibility intact)', () => {
    mockDirectory();
    const out = candidateService.formatCandidateRecord(sampleDoc(), { email: 'e@x.com', role: 'expert' }, { lean: true });

    expect(out.visaType).toBeUndefined();
    expect(out.company).toBeUndefined();
    expect(out.teamLead).toBeUndefined();
    // non-PRT fields survive the strip
    expect(out.name).toBe('Dhanya Sree Nathani');
    expect(out.email).toBe('dhanya@x.com');
  });
});
