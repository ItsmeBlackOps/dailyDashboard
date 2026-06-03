import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { candidateModel } from '../src/models/Candidate.js';
import { userModel } from '../src/models/User.js';
import { userService } from '../src/services/userService.js';
import {
  STATUS_VALUES,
  STATUS_ALIASES,
  TECHNOLOGY_VALUES,
  VISA_TYPE_VALUES,
  EAD_REQUIRED_VISA_TYPES,
  COMPANY_VALUES,
  ACK_EMAIL_VALUES,
  CANDIDATE_AUDITED
} from '../src/models/Candidate.js';

const SAMPLE_RESUME_LINK = 'https://egvjgtfjstxgszpzvvbx.supabase.co/storage/v1/object/public/resumes/sample.pdf';

const originalCreateCandidate = candidateModel.createCandidate;
const originalGetCandidateByEmail = candidateModel.getCandidateByEmail;
const originalGetCandidateById = candidateModel.getCandidateById;
const originalUpdateCandidateById = candidateModel.updateCandidateById;
const originalGetUserByEmail = userModel.getUserByEmail;
const originalGetAllUsers = userModel.getAllUsers;
const originalCollectManageableUsers = userService.collectManageableUsers;

afterEach(() => {
  candidateModel.createCandidate = originalCreateCandidate;
  candidateModel.getCandidateByEmail = originalGetCandidateByEmail;
  candidateModel.getCandidateById = originalGetCandidateById;
  candidateModel.updateCandidateById = originalUpdateCandidateById;
  userModel.getUserByEmail = originalGetUserByEmail;
  userModel.getAllUsers = originalGetAllUsers;
  userService.collectManageableUsers = originalCollectManageableUsers;
  jest.restoreAllMocks();
});

describe('PRT enums exported from Candidate.js', () => {
  it('STATUS_VALUES is the 7 PRD values keeping Placement Offer (not PO)', () => {
    expect(STATUS_VALUES).toEqual([
      'Active', 'Low Priority', 'Temp. Hold', 'Hold', 'New', 'Placement Offer', 'Backout'
    ]);
    expect(STATUS_VALUES).not.toContain('PO');
  });

  it('STATUS_ALIASES normalises PO → Placement Offer', () => {
    expect(STATUS_ALIASES.get('po')).toBe('Placement Offer');
  });

  it('TECHNOLOGY_VALUES has 20 entries from PRD §4.3 (incl. AI ML Engineer, Non IT)', () => {
    expect(TECHNOLOGY_VALUES).toHaveLength(20);
    expect(TECHNOLOGY_VALUES).toContain('AI ML Engineer');
    expect(TECHNOLOGY_VALUES).toContain('Non IT');
    expect(TECHNOLOGY_VALUES).toContain('Software Developer');
  });

  it('VISA_TYPE_VALUES has 11 entries incl. Day 1 CPT', () => {
    expect(VISA_TYPE_VALUES).toHaveLength(11);
    expect(VISA_TYPE_VALUES).toContain('Day 1 CPT');
    expect(VISA_TYPE_VALUES).toContain('H4-EAD');
  });

  it('EAD_REQUIRED_VISA_TYPES matches PRD §4.4', () => {
    expect([...EAD_REQUIRED_VISA_TYPES].sort()).toEqual(
      ['CPT', 'Day 1 CPT', 'H4-EAD', 'L2', 'OPT', 'STEM OPT']
    );
  });

  it('COMPANY_VALUES = [SST, VCS, FED]', () => {
    expect(COMPANY_VALUES).toEqual(['SST', 'VCS', 'FED']);
  });

  it('ACK_EMAIL_VALUES = [Sent, Confirmed, Pending]', () => {
    expect(ACK_EMAIL_VALUES).toEqual(['Sent', 'Confirmed', 'Pending']);
  });

  it('CANDIDATE_AUDITED includes the 12 audited PRT fields', () => {
    expect(CANDIDATE_AUDITED).toEqual(expect.arrayContaining([
      'status', 'recruiter', 'expert', 'teamLead', 'branch',
      'visaType', 'eadStartDate', 'eadEndDate', 'company',
      'ackEmail', 'experienceYears', 'technology'
    ]));
  });
});

describe('candidateService.sanitizeCandidatePayload — PRT extensions', () => {
  describe('status', () => {
    it('accepts the new values Temp. Hold and New', () => {
      expect(candidateService.sanitizeCandidatePayload({ status: 'Temp. Hold' }).status).toBe('Temp. Hold');
      expect(candidateService.sanitizeCandidatePayload({ status: 'New' }).status).toBe('New');
    });

    it('normalises incoming PO → Placement Offer (case-insensitive)', () => {
      expect(candidateService.sanitizeCandidatePayload({ status: 'PO' }).status).toBe('Placement Offer');
      expect(candidateService.sanitizeCandidatePayload({ status: 'po' }).status).toBe('Placement Offer');
    });

    it('keeps Placement Offer as-is (canonical DB value)', () => {
      expect(candidateService.sanitizeCandidatePayload({ status: 'Placement Offer' }).status).toBe('Placement Offer');
    });

    it('rejects unknown status values', () => {
      expect(() => candidateService.sanitizeCandidatePayload({ status: 'Bogus' })).toThrow(/Status must be one of/);
    });
  });

  describe('visaType', () => {
    it('accepts each PRD visa type (with EAD dates where required by visa)', () => {
      for (const v of VISA_TYPE_VALUES) {
        const payload = { visaType: v };
        if (EAD_REQUIRED_VISA_TYPES.has(v)) {
          payload.eadStartDate = '2025-01-15';
          payload.eadEndDate = '2027-01-15';
        }
        expect(candidateService.sanitizeCandidatePayload(payload).visaType).toBe(v);
      }
    });

    it('rejects unknown visaType', () => {
      expect(() => candidateService.sanitizeCandidatePayload({ visaType: 'XYZ' })).toThrow(/Visa Type must be one of/);
    });
  });

  describe('experienceYears', () => {
    it('accepts 1 and 20 (inclusive bounds)', () => {
      expect(candidateService.sanitizeCandidatePayload({ experienceYears: 1 }).experienceYears).toBe(1);
      expect(candidateService.sanitizeCandidatePayload({ experienceYears: 20 }).experienceYears).toBe(20);
    });

    it('coerces a numeric string', () => {
      expect(candidateService.sanitizeCandidatePayload({ experienceYears: '5' }).experienceYears).toBe(5);
    });

    it('rejects 0, 21, non-integer, and non-numeric', () => {
      expect(() => candidateService.sanitizeCandidatePayload({ experienceYears: 0 })).toThrow(/Experience/);
      expect(() => candidateService.sanitizeCandidatePayload({ experienceYears: 21 })).toThrow(/Experience/);
      expect(() => candidateService.sanitizeCandidatePayload({ experienceYears: 3.5 })).toThrow(/Experience/);
      expect(() => candidateService.sanitizeCandidatePayload({ experienceYears: 'abc' })).toThrow(/Experience/);
    });
  });

  describe('company', () => {
    it('accepts SST/VCS/FED and uppercase-normalises', () => {
      expect(candidateService.sanitizeCandidatePayload({ company: 'SST' }).company).toBe('SST');
      expect(candidateService.sanitizeCandidatePayload({ company: 'vcs' }).company).toBe('VCS');
    });

    it('rejects unknown company', () => {
      expect(() => candidateService.sanitizeCandidatePayload({ company: 'OTHER' })).toThrow(/Company must be one of/);
    });
  });

  describe('ackEmail', () => {
    it('accepts Sent / Confirmed / Pending', () => {
      expect(candidateService.sanitizeCandidatePayload({ ackEmail: 'Sent' }).ackEmail).toBe('Sent');
      expect(candidateService.sanitizeCandidatePayload({ ackEmail: 'Confirmed' }).ackEmail).toBe('Confirmed');
      expect(candidateService.sanitizeCandidatePayload({ ackEmail: 'Pending' }).ackEmail).toBe('Pending');
    });

    it('rejects unknown ackEmail values', () => {
      expect(() => candidateService.sanitizeCandidatePayload({ ackEmail: 'Maybe' })).toThrow(/Ack Email must be one of/);
    });
  });

  describe('city / state / teamLead', () => {
    it('trims city and state', () => {
      const s = candidateService.sanitizeCandidatePayload({ city: '  Ahmedabad  ', state: '  Gujarat  ' });
      expect(s.city).toBe('Ahmedabad');
      expect(s.state).toBe('Gujarat');
    });

    it('normalises teamLead as a lowercase email', () => {
      const s = candidateService.sanitizeCandidatePayload({ teamLead: '  Foo.Bar@Example.COM  ' });
      expect(s.teamLead).toBe('foo.bar@example.com');
    });

    it('rejects an invalid teamLead email', () => {
      expect(() => candidateService.sanitizeCandidatePayload({ teamLead: 'not-an-email' })).toThrow(/Invalid team lead email/);
    });
  });

  describe('EAD dates (conditional on visaType)', () => {
    it('accepts eadStartDate / eadEndDate as Date when visaType requires them', () => {
      const s = candidateService.sanitizeCandidatePayload({
        visaType: 'OPT',
        eadStartDate: '2025-01-15',
        eadEndDate: '2027-01-15'
      });
      expect(s.eadStartDate).toBeInstanceOf(Date);
      expect(s.eadEndDate).toBeInstanceOf(Date);
      expect(s.eadEndDate.getTime()).toBeGreaterThan(s.eadStartDate.getTime());
    });

    it('requires eadStartDate when visaType ∈ EAD_REQUIRED_VISA_TYPES', () => {
      expect(() => candidateService.sanitizeCandidatePayload({ visaType: 'OPT' })).toThrow(/EAD Start Date is required/);
      expect(() => candidateService.sanitizeCandidatePayload({ visaType: 'STEM OPT', eadStartDate: null })).toThrow(/EAD Start Date is required/);
    });

    it('requires eadEndDate when eadStartDate is set', () => {
      expect(() => candidateService.sanitizeCandidatePayload({
        visaType: 'OPT', eadStartDate: '2025-01-15'
      })).toThrow(/EAD End Date is required/);
    });

    it('rejects eadEndDate that is not after eadStartDate', () => {
      expect(() => candidateService.sanitizeCandidatePayload({
        visaType: 'OPT', eadStartDate: '2025-01-15', eadEndDate: '2025-01-15'
      })).toThrow(/EAD End Date must be after/);
    });

    it('does NOT require EAD dates for non-EAD visa types (USC, PR, H1B, Green Card, Asylum)', () => {
      for (const v of ['USC', 'PR', 'H1B', 'Green Card', 'Asylum']) {
        const s = candidateService.sanitizeCandidatePayload({ visaType: v });
        expect(s.visaType).toBe(v);
        expect(s.eadStartDate).toBeUndefined();
        expect(s.eadEndDate).toBeUndefined();
      }
    });

    it('rejects malformed date strings for EAD', () => {
      expect(() => candidateService.sanitizeCandidatePayload({
        visaType: 'OPT', eadStartDate: 'not-a-date', eadEndDate: '2027-01-15'
      })).toThrow(/Invalid EAD Start Date/);
    });
  });

  describe('technology (60-day warn-only window)', () => {
    it('accepts a value from the enum verbatim', () => {
      expect(candidateService.sanitizeCandidatePayload({ technology: 'Software Developer' }).technology).toBe('Software Developer');
    });

    it('accepts an unknown technology with a warn log (60-day grace)', () => {
      // The sanitizer should NOT throw for unknown tech values during the
      // transition window — it should log a warning and pass the value
      // through (existing data has free-text values).
      const s = candidateService.sanitizeCandidatePayload({ technology: 'Bogus Tech' });
      expect(s.technology).toBe('Bogus Tech');
    });
  });

  describe('marketingStartDate', () => {
    it('is NOT auto-set by the sanitizer (createCandidateFromManager stamps it)', () => {
      const s = candidateService.sanitizeCandidatePayload({ name: 'Jane Doe' });
      expect(s.marketingStartDate).toBeUndefined();
    });

    it('drops any marketingStartDate sent by the client (server-only field)', () => {
      const s = candidateService.sanitizeCandidatePayload({ marketingStartDate: '2020-01-01' });
      expect(s.marketingStartDate).toBeUndefined();
    });
  });
});

describe('candidateService.createCandidateFromManager — PRT defaults + teamLead derivation', () => {
  beforeEach(() => {
    // Duplicate guard calls getCandidateByEmail; default to no existing
    // candidate so these create-path tests proceed to insert.
    candidateModel.getCandidateByEmail = jest.fn().mockResolvedValue(null);
  });

  it('derives teamLead from the recruiter user record when not supplied', async () => {
    candidateModel.createCandidate = jest.fn().mockResolvedValue({
      _id: { toString: () => 'derived-tl' }
    });

    userModel.getUserByEmail = jest.fn((email) => {
      const e = String(email || '').toLowerCase();
      if (e === 'mam.user@company.com') {
        return { email: e, role: 'mam', manager: 'tushar.ahuja@silverspaceinc.com', active: true };
      }
      if (e === 'tushar.ahuja@silverspaceinc.com') {
        return { email: e, role: 'manager', team: 'marketing', active: true };
      }
      if (e === 'recruiter@example.com') {
        // The recruiter's `teamLead` is a display-name string, mirroring prod.
        return { email: e, role: 'recruiter', teamLead: 'Brhamdev Sharma', active: true };
      }
      if (e === 'brhamdev.sharma@example.com') {
        return { email: e, role: 'lead', active: true };
      }
      return null;
    });

    // `_findEmailByName` reads `userModel.getAllUsers()` and matches the
    // display name to a user via `deriveDisplayNameFromEmail`.
    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'brhamdev.sharma@example.com', role: 'lead' }
    ]);

    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter', active: true }
    ]);

    await candidateService.createCandidateFromManager(
      { email: 'mam.user@company.com', role: 'MAM' },
      {
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        technology: 'Software Developer',
        branch: 'LKN', // MAM path will override to whatever Tushar's branch is
        recruiter: 'recruiter@example.com',
        resumeLink: SAMPLE_RESUME_LINK,
        // SP1: marketing info is now hard-required at creation.
        visaType: 'H1B',
        company: 'SST',
        experienceYears: 5,
        city: 'Ahmedabad',
        state: 'Gujarat'
        // teamLead deliberately omitted — must be derived
      }
    );

    expect(candidateModel.createCandidate).toHaveBeenCalledWith(expect.objectContaining({
      teamLead: 'brhamdev.sharma@example.com'
    }));
  });

  it('throws "Team Lead is required" when neither payload nor recruiter record provides one', async () => {
    userModel.getUserByEmail = jest.fn((email) => {
      const e = String(email || '').toLowerCase();
      if (e === 'mam.user@company.com') {
        return { email: e, role: 'mam', manager: 'tushar.ahuja@silverspaceinc.com', active: true };
      }
      if (e === 'tushar.ahuja@silverspaceinc.com') {
        return { email: e, role: 'manager', team: 'marketing', active: true };
      }
      if (e === 'recruiter@example.com') {
        // Recruiter without a teamLead — derivation should fail.
        return { email: e, role: 'recruiter', teamLead: '', active: true };
      }
      return null;
    });
    userModel.getAllUsers = jest.fn().mockReturnValue([]);
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter', active: true }
    ]);

    await expect(
      candidateService.createCandidateFromManager(
        { email: 'mam.user@company.com', role: 'MAM' },
        {
          name: 'Jane Doe',
          email: 'jane.doe@example.com',
          technology: 'Software Developer',
          branch: 'LKN',
          recruiter: 'recruiter@example.com',
          resumeLink: SAMPLE_RESUME_LINK
        }
      )
    ).rejects.toThrow(/Team Lead is required/);
  });

  it('stamps PRT defaults on create (status=New, ackEmail=Pending, marketingStartDate=now, empty arrays)', async () => {
    candidateModel.createCandidate = jest.fn().mockResolvedValue({
      _id: { toString: () => 'defaults-stamped' }
    });

    userModel.getUserByEmail = jest.fn((email) => {
      const e = String(email || '').toLowerCase();
      if (e === 'mam.user@company.com') {
        return { email: e, role: 'mam', manager: 'tushar.ahuja@silverspaceinc.com', active: true };
      }
      if (e === 'tushar.ahuja@silverspaceinc.com') {
        return { email: e, role: 'manager', team: 'marketing', active: true };
      }
      return null;
    });
    userModel.getAllUsers = jest.fn().mockReturnValue([]);
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter', active: true }
    ]);

    const before = Date.now();
    await candidateService.createCandidateFromManager(
      { email: 'mam.user@company.com', role: 'MAM' },
      {
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        technology: 'Software Developer',
        branch: 'LKN',
        recruiter: 'recruiter@example.com',
        teamLead: 'tlead@example.com',
        resumeLink: SAMPLE_RESUME_LINK,
        // SP1: marketing info is now hard-required at creation.
        visaType: 'H1B',
        company: 'SST',
        experienceYears: 5,
        city: 'Ahmedabad',
        state: 'Gujarat'
      }
    );
    const after = Date.now();

    expect(candidateModel.createCandidate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'New',
      ackEmail: 'Pending',
      attachments: [],
      editHistory: [],
      assignmentEmails: []
    }));

    const args = candidateModel.createCandidate.mock.calls[0][0];
    expect(args.marketingStartDate).toBeInstanceOf(Date);
    expect(args.marketingStartDate.getTime()).toBeGreaterThanOrEqual(before);
    expect(args.marketingStartDate.getTime()).toBeLessThanOrEqual(after);
  });
});

describe('candidateService.createCandidateFromManager — SP1 marketing-info hard-required at creation', () => {
  // A complete, valid manager-create payload. visaType is a NON-EAD type so
  // EAD start/end are not pulled in (the sanitizer's conditional-EAD rule is
  // covered separately); these cases isolate the presence guards.
  const validPayload = () => ({
    name: 'Jane Doe',
    email: 'jane.doe@example.com',
    technology: 'Software Developer',
    branch: 'LKN',
    recruiter: 'recruiter@example.com',
    teamLead: 'tlead@example.com',
    resumeLink: SAMPLE_RESUME_LINK,
    visaType: 'H1B',
    company: 'SST',
    experienceYears: 5,
    city: 'Ahmedabad',
    state: 'Gujarat'
  });

  beforeEach(() => {
    // Happy-path harness: no existing duplicate, recruiter is in scope, and
    // the MAM branch resolves via Tushar — so a complete payload reaches the
    // createCandidate model call.
    candidateModel.getCandidateByEmail = jest.fn().mockResolvedValue(null);
    candidateModel.createCandidate = jest.fn().mockResolvedValue({
      _id: { toString: () => 'sp1-created' }
    });
    userModel.getUserByEmail = jest.fn((email) => {
      const e = String(email || '').toLowerCase();
      if (e === 'mam.user@company.com') {
        return { email: e, role: 'mam', manager: 'tushar.ahuja@silverspaceinc.com', active: true };
      }
      if (e === 'tushar.ahuja@silverspaceinc.com') {
        return { email: e, role: 'manager', team: 'marketing', active: true };
      }
      return null;
    });
    userModel.getAllUsers = jest.fn().mockReturnValue([]);
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter', active: true }
    ]);
  });

  const callCreate = (payload) =>
    candidateService.createCandidateFromManager(
      { email: 'mam.user@company.com', role: 'MAM' },
      payload
    );

  it('succeeds with a complete payload (additional attachments omitted is fine)', async () => {
    await callCreate(validPayload());
    expect(candidateModel.createCandidate).toHaveBeenCalledTimes(1);
    expect(candidateModel.createCandidate).toHaveBeenCalledWith(expect.objectContaining({
      visaType: 'H1B',
      company: 'SST',
      experienceYears: 5,
      city: 'Ahmedabad',
      state: 'Gujarat'
    }));
  });

  it('rejects when visaType is missing and does NOT call createCandidate', async () => {
    const payload = validPayload();
    delete payload.visaType;
    await expect(callCreate(payload)).rejects.toThrow(/Visa Type is required/);
    expect(candidateModel.createCandidate).not.toHaveBeenCalled();
  });

  it('rejects when company is missing and does NOT call createCandidate', async () => {
    const payload = validPayload();
    delete payload.company;
    await expect(callCreate(payload)).rejects.toThrow(/Company is required/);
    expect(candidateModel.createCandidate).not.toHaveBeenCalled();
  });

  it('rejects when experienceYears is missing and does NOT call createCandidate', async () => {
    const payload = validPayload();
    delete payload.experienceYears;
    await expect(callCreate(payload)).rejects.toThrow(/Experience \(years\) is required/);
    expect(candidateModel.createCandidate).not.toHaveBeenCalled();
  });

  it('rejects when city is missing and does NOT call createCandidate', async () => {
    const payload = validPayload();
    delete payload.city;
    await expect(callCreate(payload)).rejects.toThrow(/City is required/);
    expect(candidateModel.createCandidate).not.toHaveBeenCalled();
  });

  it('rejects when state is missing and does NOT call createCandidate', async () => {
    const payload = validPayload();
    delete payload.state;
    await expect(callCreate(payload)).rejects.toThrow(/State is required/);
    expect(candidateModel.createCandidate).not.toHaveBeenCalled();
  });

  it('attaches statusCode 400 to each required-field rejection', async () => {
    for (const field of ['visaType', 'company', 'experienceYears', 'city', 'state']) {
      const payload = validPayload();
      delete payload[field];
      await expect(callCreate(payload)).rejects.toMatchObject({ statusCode: 400 });
    }
  });
});

describe('candidateService.updateCandidate — PRT sanitizer + write gating', () => {
  const setUpdateMocks = () => {
    candidateModel.getCandidateById = jest.fn().mockResolvedValue({
      _id: 'cand1',
      'Candidate Name': 'Jane Doe',
      status: 'Active',
      visaType: '',
      teamLead: ''
    });
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({
      _id: 'cand1',
      'Candidate Name': 'Jane Doe',
      status: 'Active',
      visaType: 'OPT',
      teamLead: ''
    });
  };

  it('runs the sanitizer at the top — PO normalises to Placement Offer and triggers poDate auto-set', async () => {
    candidateModel.getCandidateById = jest.fn().mockResolvedValue({
      _id: 'cand1',
      status: 'Active',
      poDate: null
    });
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({ _id: 'cand1', status: 'Placement Offer' });

    await candidateService.updateCandidate(
      { email: 'mm.user@company.com', role: 'mm' },
      'cand1',
      { status: 'PO' }
    );

    const passedUpdates = candidateModel.updateCandidateById.mock.calls[0][1];
    expect(passedUpdates.status).toBe('Placement Offer');
    expect(passedUpdates.poDate).toBeInstanceOf(Date);
  });

  it('rejects PRT-field updates from a recruiter (not in [admin, mm, mam])', async () => {
    setUpdateMocks();
    await expect(
      candidateService.updateCandidate(
        { email: 'rec@company.com', role: 'recruiter' },
        'cand1',
        { visaType: 'OPT', eadStartDate: '2025-01-15', eadEndDate: '2027-01-15' }
      )
    ).rejects.toThrow(/Only marketing manager or assistant manager can update visaType/);
    expect(candidateModel.updateCandidateById).not.toHaveBeenCalled();
  });

  it('rejects PRT-field updates from technical roles (lead / am / expert)', async () => {
    setUpdateMocks();
    for (const role of ['lead', 'am', 'expert', 'user']) {
      await expect(
        candidateService.updateCandidate(
          { email: `${role}@company.com`, role },
          'cand1',
          { company: 'SST' }
        )
      ).rejects.toThrow(/Only marketing manager or assistant manager can update company/);
    }
  });

  it('rejects teamLead updates from mlead (marketing team lead is read-only on PRT)', async () => {
    setUpdateMocks();
    await expect(
      candidateService.updateCandidate(
        { email: 'mlead.user@company.com', role: 'mlead' },
        'cand1',
        { teamLead: 'other.lead@company.com' }
      )
    ).rejects.toThrow(/Only marketing manager or assistant manager can update teamLead/);
  });

  it('allows mm to update PRT fields', async () => {
    setUpdateMocks();
    await candidateService.updateCandidate(
      { email: 'mm.user@company.com', role: 'mm' },
      'cand1',
      { visaType: 'OPT', eadStartDate: '2025-01-15', eadEndDate: '2027-01-15', company: 'SST' }
    );
    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith(
      'cand1',
      expect.objectContaining({
        visaType: 'OPT',
        company: 'SST'
      })
    );
  });

  it('allows mam to update PRT fields', async () => {
    setUpdateMocks();
    await candidateService.updateCandidate(
      { email: 'mam.user@company.com', role: 'mam' },
      'cand1',
      { teamLead: 'lead@company.com', experienceYears: 7 }
    );
    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith(
      'cand1',
      expect.objectContaining({
        teamLead: 'lead@company.com',
        experienceYears: 7
      })
    );
  });

  it('still allows non-PRT updates (e.g. status) from existing recruitment roles', async () => {
    setUpdateMocks();
    await candidateService.updateCandidate(
      { email: 'rec@company.com', role: 'recruiter' },
      'cand1',
      { status: 'Hold' }
    );
    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith(
      'cand1',
      expect.objectContaining({ status: 'Hold' })
    );
  });

  it('rejects an invalid status via the sanitizer (not via the legacy RBAC check)', async () => {
    setUpdateMocks();
    await expect(
      candidateService.updateCandidate(
        { email: 'mm.user@company.com', role: 'mm' },
        'cand1',
        { status: 'Bogus' }
      )
    ).rejects.toThrow(/Status must be one of/);
  });

  it('pushes editHistory entries for CHANGED audited fields only', async () => {
    candidateModel.getCandidateById = jest.fn().mockResolvedValue({
      _id: 'cand1',
      status: 'Active',
      visaType: 'OPT',
      company: 'SST',
      teamLead: 'old.lead@company.com'
    });
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({ _id: 'cand1' });

    await candidateService.updateCandidate(
      { email: 'mm.user@company.com', role: 'mm' },
      'cand1',
      { status: 'Active', visaType: 'STEM OPT', company: 'SST', teamLead: 'new.lead@company.com', eadStartDate: '2025-01-15', eadEndDate: '2027-01-15' }
    );

    const passed = candidateModel.updateCandidateById.mock.calls[0][1];
    expect(Array.isArray(passed._pushEditHistory)).toBe(true);
    const changedFields = passed._pushEditHistory.map((e) => e.field).sort();
    // status: unchanged (Active === Active) → should NOT push
    // visaType: changed (OPT → STEM OPT) → push
    // company: unchanged (SST === SST) → should NOT push
    // teamLead: changed → push
    // eadStartDate/eadEndDate: changed (undefined → date) → push
    expect(changedFields).toEqual(['eadEndDate', 'eadStartDate', 'teamLead', 'visaType']);
    for (const entry of passed._pushEditHistory) {
      expect(entry).toMatchObject({ actor: 'mm.user@company.com' });
      expect(entry.ts).toBeInstanceOf(Date);
    }
  });

  it('does NOT push editHistory when no audited field changed', async () => {
    candidateModel.getCandidateById = jest.fn().mockResolvedValue({
      _id: 'cand1',
      status: 'Active',
      visaType: 'H1B'
    });
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({ _id: 'cand1' });

    // Send only same-value status; no other audited field touched.
    await candidateService.updateCandidate(
      { email: 'mm.user@company.com', role: 'mm' },
      'cand1',
      { status: 'Active' }
    );

    const passed = candidateModel.updateCandidateById.mock.calls[0][1];
    expect(passed._pushEditHistory).toBeUndefined();
  });

  it('auto-sets ackEmailAt when ackEmail transitions to "Sent"', async () => {
    candidateModel.getCandidateById = jest.fn().mockResolvedValue({
      _id: 'cand1',
      ackEmail: 'Pending'
    });
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({ _id: 'cand1' });

    await candidateService.updateCandidate(
      { email: 'mm.user@company.com', role: 'mm' },
      'cand1',
      { ackEmail: 'Sent' }
    );

    const passed = candidateModel.updateCandidateById.mock.calls[0][1];
    expect(passed.ackEmail).toBe('Sent');
    expect(passed.ackEmailAt).toBeInstanceOf(Date);
  });
});

describe('candidateService.formatCandidateRecord — PRT derived getters + visibility', () => {
  it('computes expiringInDays from eadEndDate (positive when in the future)', () => {
    const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const formatted = candidateService.formatCandidateRecord({
      _id: 'cand1',
      'Candidate Name': 'X',
      eadEndDate: future
    });
    expect(formatted.expiringInDays).toBeGreaterThanOrEqual(59);
    expect(formatted.expiringInDays).toBeLessThanOrEqual(60);
  });

  it('returns null derived getters when source dates are absent', () => {
    const formatted = candidateService.formatCandidateRecord({ _id: 'cand1' });
    expect(formatted.expiringInDays).toBeNull();
    expect(formatted.daysInMarketing).toBeNull();
  });

  it('computes daysInMarketing from marketingStartDate (positive when in the past)', () => {
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const formatted = candidateService.formatCandidateRecord({
      _id: 'cand1',
      marketingStartDate: past
    });
    expect(formatted.daysInMarketing).toBeGreaterThanOrEqual(10);
    expect(formatted.daysInMarketing).toBeLessThanOrEqual(11);
  });

  it('strips PRT fields when reader is non-marketing (lead / am / expert / user)', () => {
    const source = {
      _id: 'cand1',
      'Candidate Name': 'X',
      visaType: 'OPT',
      company: 'SST',
      teamLead: 'tl@company.com',
      marketingStartDate: new Date(),
      eadEndDate: new Date(),
      attachments: [{ id: 'a1' }]
    };
    for (const role of ['lead', 'am', 'expert', 'user']) {
      const formatted = candidateService.formatCandidateRecord(source, { role });
      // PRT fields removed
      for (const f of ['visaType', 'company', 'teamLead', 'marketingStartDate', 'eadEndDate', 'attachments', 'editHistory', 'assignmentEmails', 'expiringInDays', 'daysInMarketing']) {
        expect(formatted[f]).toBeUndefined();
      }
      // Legacy projection intact
      expect(formatted.name).toBe('X');
    }
  });

  it('preserves PRT fields for marketing readers (admin / mm / mam / mlead / recruiter)', () => {
    const source = {
      _id: 'cand1',
      visaType: 'OPT',
      company: 'SST',
      marketingStartDate: new Date()
    };
    for (const role of ['admin', 'mm', 'mam', 'mlead', 'recruiter']) {
      const formatted = candidateService.formatCandidateRecord(source, { role });
      expect(formatted.visaType).toBe('OPT');
      expect(formatted.company).toBe('SST');
      expect(formatted.marketingStartDate).toBeInstanceOf(Date);
    }
  });

  it('returns full data when no user is provided (backwards compat for internal callers)', () => {
    const formatted = candidateService.formatCandidateRecord({ _id: 'cand1', visaType: 'OPT' });
    expect(formatted.visaType).toBe('OPT');
  });
});
