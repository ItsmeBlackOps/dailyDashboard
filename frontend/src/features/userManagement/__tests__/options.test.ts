import { describe, it, expect } from 'vitest';
import { teamLeadOptionsFor, managerOptionsFor } from '../options';
import type { ManageableUser } from '../grouping';

// A small roster spanning every legacy role. Display names are derived
// from the email local-part (deriveDisplayNameFromEmail), so e.g.
// "manish.gupta@x.com" → "Manish Gupta".
const make = (over: Partial<ManageableUser> & { email: string }): ManageableUser => ({
  role: 'recruiter',
  active: true,
  acceptsTasks: false,
  teamLead: '',
  manager: '',
  team: null,
  ...over,
});

const fixture: ManageableUser[] = [
  make({ email: 'manish.gupta@x.com', role: 'mm' }), // Marketing Manager
  make({ email: 'tushar.ahuja@x.com', role: 'mm' }), // another MM
  make({ email: 'meena.mam@x.com', role: 'mam' }), // Asst Mgr (marketing)
  make({ email: 'arjun.am@x.com', role: 'am' }), // Asst Mgr (technical)
  make({ email: 'brhamdev.sharma@x.com', role: 'mlead' }), // Team Lead (marketing)
  make({ email: 'prateek.narvariya@x.com', role: 'lead' }), // Team Lead (technical)
  make({ email: 'rahul.recruiter@x.com', role: 'recruiter' }),
  make({ email: 'amartya.kumar@x.com', role: 'user' }), // Expert
];

describe('teamLeadOptionsFor', () => {
  it("target 'user' → technical-side leads {lead, am, mm}; excludes recruiters/experts/marketing-leads", () => {
    const opts = teamLeadOptionsFor('user', fixture);
    expect(opts).toContain('Prateek Narvariya'); // lead
    expect(opts).toContain('Arjun Am'); // am
    expect(opts).toContain('Manish Gupta'); // mm
    expect(opts).toContain('Tushar Ahuja'); // mm
    // not in {lead, am, mm}
    expect(opts).not.toContain('Rahul Recruiter');
    expect(opts).not.toContain('Amartya Kumar');
    expect(opts).not.toContain('Brhamdev Sharma'); // mlead
    expect(opts).not.toContain('Meena Mam'); // mam
  });

  it("target 'recruiter' → marketing-side {mlead, mam, mm}", () => {
    const opts = teamLeadOptionsFor('recruiter', fixture);
    expect(opts).toContain('Brhamdev Sharma'); // mlead
    expect(opts).toContain('Meena Mam'); // mam
    expect(opts).toContain('Manish Gupta'); // mm
    expect(opts).not.toContain('Prateek Narvariya'); // lead
    expect(opts).not.toContain('Arjun Am'); // am
  });

  it("target 'lead' → {am, mm}", () => {
    const opts = teamLeadOptionsFor('lead', fixture);
    expect(opts).toContain('Arjun Am');
    expect(opts).toContain('Manish Gupta');
    expect(opts).not.toContain('Prateek Narvariya'); // a lead is not a teamLead for a lead
  });

  it("target 'am' → {mm} only", () => {
    const opts = teamLeadOptionsFor('am', fixture);
    expect(opts).toEqual(['Manish Gupta', 'Tushar Ahuja']); // sorted, mm only
  });

  it("target 'mlead' → {mam, mm}", () => {
    const opts = teamLeadOptionsFor('mlead', fixture);
    expect(opts).toContain('Meena Mam');
    expect(opts).toContain('Manish Gupta');
    expect(opts).not.toContain('Brhamdev Sharma');
  });

  it("target 'mam' → {mm} only", () => {
    const opts = teamLeadOptionsFor('mam', fixture);
    expect(opts).toEqual(['Manish Gupta', 'Tushar Ahuja']);
  });

  it("target 'mm' (and unknown) → []", () => {
    expect(teamLeadOptionsFor('mm', fixture)).toEqual([]);
    expect(teamLeadOptionsFor('admin', fixture)).toEqual([]);
  });

  it('returns a de-duped, alphabetically sorted list', () => {
    const dupes = [
      make({ email: 'manish.gupta@x.com', role: 'mm' }),
      make({ email: 'manish.gupta@x.com', role: 'mm' }), // exact dupe
      make({ email: 'arjun.am@x.com', role: 'am' }),
    ];
    expect(teamLeadOptionsFor('user', dupes)).toEqual(['Arjun Am', 'Manish Gupta']);
  });
});

describe('managerOptionsFor', () => {
  it('returns the mm roster regardless of target role', () => {
    expect(managerOptionsFor('recruiter', fixture)).toEqual(['Manish Gupta', 'Tushar Ahuja']);
    expect(managerOptionsFor('user', fixture)).toEqual(['Manish Gupta', 'Tushar Ahuja']);
    expect(managerOptionsFor('mlead', fixture)).toEqual(['Manish Gupta', 'Tushar Ahuja']);
  });

  it('de-dupes and sorts', () => {
    const dupes = [
      make({ email: 'tushar.ahuja@x.com', role: 'mm' }),
      make({ email: 'tushar.ahuja@x.com', role: 'mm' }),
      make({ email: 'manish.gupta@x.com', role: 'mm' }),
    ];
    expect(managerOptionsFor('recruiter', dupes)).toEqual(['Manish Gupta', 'Tushar Ahuja']);
  });

  it('returns [] when no managers exist', () => {
    const noMm = [make({ email: 'rahul.recruiter@x.com', role: 'recruiter' })];
    expect(managerOptionsFor('recruiter', noMm)).toEqual([]);
  });
});
