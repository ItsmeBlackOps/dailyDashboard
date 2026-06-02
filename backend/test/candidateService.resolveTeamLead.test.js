import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { userModel } from '../src/models/User.js';

const origGetAll = userModel.getAllUsers;
const origGetByEmail = userModel.getUserByEmail;

afterEach(() => {
  userModel.getAllUsers = origGetAll;
  userModel.getUserByEmail = origGetByEmail;
  jest.restoreAllMocks();
});

const USERS = [
  { email: 'satyam@vizvainc.com', name: 'Satyam Gupta', role: 'teamLead', team: 'marketing' },
  { email: 'aadeshsingh.chauhan@vizvainc.com', name: 'Aadeshsingh Chauhan', role: 'recruiter', teamLead: 'Satyam Gupta' },
  { email: 'norecruiter@vizvainc.com', name: 'No Lead', role: 'recruiter', teamLead: '' },
];

function mockUsers() {
  userModel.getAllUsers = jest.fn(() => USERS);
  userModel.getUserByEmail = jest.fn((e) => USERS.find((u) => u.email === (e || '').toLowerCase()) || null);
}

describe('candidateService.resolveTeamLeadEmail', () => {
  it('returns an explicitly-stored team-lead email, normalised', () => {
    mockUsers();
    expect(
      candidateService.resolveTeamLeadEmail('Nusrat.Perween@Vizvainc.com', 'aadeshsingh.chauhan@vizvainc.com')
    ).toBe('nusrat.perween@vizvainc.com');
  });

  it('derives the team-lead email from the recruiter when teamLead is missing', () => {
    mockUsers();
    expect(
      candidateService.resolveTeamLeadEmail('', 'aadeshsingh.chauhan@vizvainc.com')
    ).toBe('satyam@vizvainc.com');
  });

  it('returns empty when the recruiter has no team lead', () => {
    mockUsers();
    expect(candidateService.resolveTeamLeadEmail('', 'norecruiter@vizvainc.com')).toBe('');
  });

  it('returns empty when there is no stored team lead and no recruiter', () => {
    mockUsers();
    expect(candidateService.resolveTeamLeadEmail('', '')).toBe('');
  });

  it('resolves a stored team-lead NAME to an email via the users table', () => {
    mockUsers();
    expect(candidateService.resolveTeamLeadEmail('Satyam Gupta', 'whatever@x.com')).toBe('satyam@vizvainc.com');
  });

  it('returns empty for a stored name that matches no user (never emails a bare name)', () => {
    mockUsers();
    expect(candidateService.resolveTeamLeadEmail('Ghost Person', 'whatever@x.com')).toBe('');
  });
});
