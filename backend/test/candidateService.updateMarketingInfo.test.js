import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { candidateModel } from '../src/models/Candidate.js';
import { userModel } from '../src/models/User.js';
import { userService } from '../src/services/userService.js';

// SP1 Task 6a — narrowly-scoped marketing-info write path.
//
// updateMarketingInfo reuses the SAME role+scope gate as attachments
// (_assertAttachmentPermission): role ∈ {admin, mm, mam, mlead, recruiter}
// AND the candidate's recruiter must be self-or-in-active-hierarchy
// (assertRecruiterInScope → resolveActiveHierarchyEmails →
// userService.collectManageableUsers + userModel.getUserByEmail(self)).
//
// It writes ONLY visaType / company / eadStartDate / eadEndDate — never any
// other PRT field — so it cannot escalate writes to teamLead/recruiter/status.
// These tests are the security contract: the 403 scope/role cases and the
// "extra fields are dropped" case are the point of the task.

const originalGetCandidateById = candidateModel.getCandidateById;
const originalUpdateCandidateById = candidateModel.updateCandidateById;
const originalGetUserByEmail = userModel.getUserByEmail;
const originalGetAllUsers = userModel.getAllUsers;
const originalCollectManageableUsers = userService.collectManageableUsers;

afterEach(() => {
  candidateModel.getCandidateById = originalGetCandidateById;
  candidateModel.updateCandidateById = originalUpdateCandidateById;
  userModel.getUserByEmail = originalGetUserByEmail;
  userModel.getAllUsers = originalGetAllUsers;
  userService.collectManageableUsers = originalCollectManageableUsers;
  jest.restoreAllMocks();
});

// Mirror the attachments test harness: a candidate owned by rec.one, with the
// acting recruiter (rec.one) "in scope" by virtue of managing themselves.
// Individual tests override recruiter / collectManageableUsers for the
// out-of-scope case.
const setupInScope = (candidateOverrides = {}) => {
  const candidate = {
    _id: 'cand1',
    'Candidate Name': 'Jane Doe',
    Recruiter: 'rec.one@company.com',
    recruiter: 'rec.one@company.com',
    visaType: '',
    company: '',
    eadStartDate: null,
    eadEndDate: null,
    ...candidateOverrides
  };
  candidateModel.getCandidateById = jest.fn().mockResolvedValue(candidate);
  candidateModel.updateCandidateById = jest.fn().mockResolvedValue({ ...candidate });
  userService.collectManageableUsers = jest.fn().mockReturnValue([
    { email: 'rec.one@company.com', role: 'recruiter', active: true }
  ]);
  userModel.getUserByEmail = jest.fn((email) => {
    if ((email || '').toLowerCase() === 'rec.one@company.com') {
      return { email: 'rec.one@company.com', role: 'recruiter', active: true };
    }
    return null;
  });
  return candidate;
};

describe('candidateService.updateMarketingInfo', () => {
  it('lets an in-scope recruiter fill marketing info on their OWN candidate', async () => {
    setupInScope();
    const result = await candidateService.updateMarketingInfo(
      { email: 'rec.one@company.com', role: 'recruiter' },
      'cand1',
      { visaType: 'H1B', company: 'SST' }
    );

    expect(result).toBeTruthy();
    expect(candidateModel.updateCandidateById).toHaveBeenCalledTimes(1);
    const [calledId, updates] = candidateModel.updateCandidateById.mock.calls[0];
    expect(calledId).toBe('cand1');
    expect(updates).toMatchObject({
      visaType: 'H1B',
      company: 'SST',
      _changedBy: 'rec.one@company.com',
      _source: 'marketing-info'
    });
    // editHistory recorded for the changed fields.
    expect(Array.isArray(updates._pushEditHistory)).toBe(true);
    const changed = updates._pushEditHistory.map((e) => e.field).sort();
    expect(changed).toEqual(['company', 'visaType']);
    for (const entry of updates._pushEditHistory) {
      expect(entry).toMatchObject({ actor: 'rec.one@company.com' });
      expect(entry.ts).toBeInstanceOf(Date);
    }
  });

  it('writes the EAD dates for an EAD-card visa type', async () => {
    setupInScope();
    await candidateService.updateMarketingInfo(
      { email: 'rec.one@company.com', role: 'recruiter' },
      'cand1',
      { visaType: 'OPT', company: 'SST', eadStartDate: '2025-01-15', eadEndDate: '2027-01-15' }
    );
    const updates = candidateModel.updateCandidateById.mock.calls[0][1];
    expect(updates.visaType).toBe('OPT');
    // EAD dates are stored as Date objects (uniform type for sort/filter);
    // the read mapper normalizes to YYYY-MM-DD for display.
    expect(updates.eadStartDate).toBeInstanceOf(Date);
    expect(updates.eadEndDate).toBeInstanceOf(Date);
  });

  it('rejects an out-of-scope recruiter with 403 and does NOT write', async () => {
    setupInScope({ Recruiter: 'rec.other@company.com', recruiter: 'rec.other@company.com' });
    // The acting recruiter does NOT manage rec.other.
    userService.collectManageableUsers = jest.fn().mockReturnValue([]);
    await expect(
      candidateService.updateMarketingInfo(
        { email: 'rec.one@company.com', role: 'recruiter' },
        'cand1',
        { visaType: 'H1B', company: 'SST' }
      )
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(candidateModel.updateCandidateById).not.toHaveBeenCalled();
  });

  it('rejects non-marketing roles (expert / user / lead / am) with 403', async () => {
    setupInScope();
    for (const role of ['expert', 'user', 'lead', 'am']) {
      await expect(
        candidateService.updateMarketingInfo(
          { email: `${role}@company.com`, role },
          'cand1',
          { visaType: 'H1B', company: 'SST' }
        )
      ).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(candidateModel.updateCandidateById).not.toHaveBeenCalled();
  });

  it('rejects 401 when no user is provided', async () => {
    setupInScope();
    await expect(
      candidateService.updateMarketingInfo(undefined, 'cand1', { visaType: 'H1B', company: 'SST' })
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(candidateModel.updateCandidateById).not.toHaveBeenCalled();
  });

  it('rejects EAD-card visa with no EAD dates via the sanitizer (400)', async () => {
    setupInScope();
    await expect(
      candidateService.updateMarketingInfo(
        { email: 'mm.user@company.com', role: 'mm' },
        'cand1',
        { visaType: 'OPT' } // OPT ∈ EAD_REQUIRED_VISA_TYPES but no dates
      )
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(candidateModel.updateCandidateById).not.toHaveBeenCalled();
  });

  it('NEVER writes non-marketing PRT fields even if the caller sends them', async () => {
    setupInScope();
    await candidateService.updateMarketingInfo(
      { email: 'mm.user@company.com', role: 'mm' },
      'cand1',
      {
        visaType: 'H1B',
        company: 'SST',
        // Extras that must be ignored — this endpoint must not become a
        // back-door to write teamLead/recruiter/status/experienceYears/etc.
        status: 'Placement Offer',
        teamLead: 'evil.lead@company.com',
        recruiter: 'evil.rec@company.com',
        experienceYears: 12,
        city: 'Hacktown',
        ackEmail: 'Sent'
      }
    );
    const updates = candidateModel.updateCandidateById.mock.calls[0][1];
    expect(updates.visaType).toBe('H1B');
    expect(updates.company).toBe('SST');
    // None of the extras may leak into the write.
    for (const f of ['status', 'teamLead', 'recruiter', 'experienceYears', 'city', 'ackEmail']) {
      expect(updates[f]).toBeUndefined();
    }
  });

  it('rejects 400 when no marketing field is supplied', async () => {
    setupInScope();
    await expect(
      candidateService.updateMarketingInfo(
        { email: 'mm.user@company.com', role: 'mm' },
        'cand1',
        { status: 'Active' } // only a non-marketing field → nothing to write
      )
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(candidateModel.updateCandidateById).not.toHaveBeenCalled();
  });

  it('returns 404 when the candidate does not exist', async () => {
    candidateModel.getCandidateById = jest.fn().mockResolvedValue(null);
    candidateModel.updateCandidateById = jest.fn();
    await expect(
      candidateService.updateMarketingInfo(
        { email: 'mm.user@company.com', role: 'mm' },
        'missing',
        { visaType: 'H1B', company: 'SST' }
      )
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(candidateModel.updateCandidateById).not.toHaveBeenCalled();
  });

  it('returns 400 when no candidate id is provided', async () => {
    await expect(
      candidateService.updateMarketingInfo(
        { email: 'mm.user@company.com', role: 'mm' },
        '',
        { visaType: 'H1B', company: 'SST' }
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
