import { describe, it, expect } from 'vitest';
import {
  filterUsers,
  sortUsers,
  groupUsers,
  type ManageableUser,
} from '../grouping';

const make = (over: Partial<ManageableUser> & { email: string }): ManageableUser => ({
  role: 'recruiter',
  active: true,
  acceptsTasks: false,
  teamLead: '',
  manager: '',
  team: null,
  ...over,
});

const users: ManageableUser[] = [
  make({ email: 'aarav.patel@x.com', role: 'recruiter', team: 'marketing', teamLead: 'Brhamdev Sharma', manager: 'Tushar Ahuja', active: true, acceptsTasks: true }),
  make({ email: 'priya.singh@x.com', role: 'mlead', team: 'marketing', teamLead: 'Brhamdev Sharma', manager: 'Tushar Ahuja', active: false, acceptsTasks: false }),
  make({ email: 'rahul.verma@x.com', role: 'user', team: 'technical', teamLead: 'Akash Avasthi', manager: 'Adnan Shaikh', active: true, acceptsTasks: false }),
  make({ email: 'zoya.khan@x.com', role: 'lead', team: 'technical', teamLead: '', manager: 'Adnan Shaikh', active: true, acceptsTasks: true }),
];

describe('grouping', () => {
  describe('filterUsers', () => {
    it('returns all users when filters are empty/all', () => {
      const out = filterUsers(users, {
        search: '',
        role: 'all',
        team: 'all',
        active: 'all',
        acceptsTasks: 'all',
      });
      expect(out).toHaveLength(4);
    });

    it('matches search against the derived name', () => {
      // aarav.patel@x.com -> "Aarav Patel"
      const out = filterUsers(users, {
        search: 'aarav',
        role: 'all',
        team: 'all',
        active: 'all',
        acceptsTasks: 'all',
      });
      expect(out.map((u) => u.email)).toEqual(['aarav.patel@x.com']);
    });

    it('matches search against the email (case-insensitive)', () => {
      const out = filterUsers(users, {
        search: 'PRIYA.SINGH@X.COM',
        role: 'all',
        team: 'all',
        active: 'all',
        acceptsTasks: 'all',
      });
      expect(out.map((u) => u.email)).toEqual(['priya.singh@x.com']);
    });

    it('matches a derived last name fragment', () => {
      // rahul.verma -> "Rahul Verma"
      const out = filterUsers(users, {
        search: 'verma',
        role: 'all',
        team: 'all',
        active: 'all',
        acceptsTasks: 'all',
      });
      expect(out.map((u) => u.email)).toEqual(['rahul.verma@x.com']);
    });

    it('filters by role equality', () => {
      const out = filterUsers(users, {
        search: '',
        role: 'mlead',
        team: 'all',
        active: 'all',
        acceptsTasks: 'all',
      });
      expect(out.map((u) => u.email)).toEqual(['priya.singh@x.com']);
    });

    it('filters by team equality', () => {
      const out = filterUsers(users, {
        search: '',
        role: 'all',
        team: 'technical',
        active: 'all',
        acceptsTasks: 'all',
      });
      expect(out.map((u) => u.email).sort()).toEqual([
        'rahul.verma@x.com',
        'zoya.khan@x.com',
      ]);
    });

    it('filters by active = inactive', () => {
      const out = filterUsers(users, {
        search: '',
        role: 'all',
        team: 'all',
        active: 'inactive',
        acceptsTasks: 'all',
      });
      expect(out.map((u) => u.email)).toEqual(['priya.singh@x.com']);
    });

    it('filters by active = active', () => {
      const out = filterUsers(users, {
        search: '',
        role: 'all',
        team: 'all',
        active: 'active',
        acceptsTasks: 'all',
      });
      expect(out.map((u) => u.email).sort()).toEqual([
        'aarav.patel@x.com',
        'rahul.verma@x.com',
        'zoya.khan@x.com',
      ]);
    });

    it('filters by acceptsTasks = yes / no', () => {
      const yes = filterUsers(users, {
        search: '',
        role: 'all',
        team: 'all',
        active: 'all',
        acceptsTasks: 'yes',
      });
      expect(yes.map((u) => u.email).sort()).toEqual([
        'aarav.patel@x.com',
        'zoya.khan@x.com',
      ]);
      const no = filterUsers(users, {
        search: '',
        role: 'all',
        team: 'all',
        active: 'all',
        acceptsTasks: 'no',
      });
      expect(no.map((u) => u.email).sort()).toEqual([
        'priya.singh@x.com',
        'rahul.verma@x.com',
      ]);
    });

    it('combines multiple filters', () => {
      const out = filterUsers(users, {
        search: '',
        role: 'all',
        team: 'marketing',
        active: 'active',
        acceptsTasks: 'yes',
      });
      expect(out.map((u) => u.email)).toEqual(['aarav.patel@x.com']);
    });
  });

  describe('sortUsers', () => {
    it('sorts by derived name ascending', () => {
      const out = sortUsers(users, 'name', 'asc');
      expect(out.map((u) => u.email)).toEqual([
        'aarav.patel@x.com', // Aarav Patel
        'priya.singh@x.com', // Priya Singh
        'rahul.verma@x.com', // Rahul Verma
        'zoya.khan@x.com', // Zoya Khan
      ]);
    });

    it('sorts by name descending', () => {
      const out = sortUsers(users, 'name', 'desc');
      expect(out.map((u) => u.email)).toEqual([
        'zoya.khan@x.com',
        'rahul.verma@x.com',
        'priya.singh@x.com',
        'aarav.patel@x.com',
      ]);
    });

    it('sorts by role and by team', () => {
      const byRole = sortUsers(users, 'role', 'asc').map((u) => u.role);
      expect(byRole).toEqual([...byRole].sort());
      const byTeam = sortUsers(users, 'team', 'asc').map((u) => u.team ?? '');
      expect(byTeam).toEqual([...byTeam].sort());
    });

    it('does not mutate the input array', () => {
      const copy = [...users];
      sortUsers(users, 'name', 'desc');
      expect(users).toEqual(copy);
    });

    it('is stable for equal keys', () => {
      const sameName: ManageableUser[] = [
        make({ email: 'a@x.com', role: 'recruiter' }),
        make({ email: 'b@x.com', role: 'recruiter' }),
        make({ email: 'c@x.com', role: 'recruiter' }),
      ];
      const out = sortUsers(sameName, 'role', 'asc');
      expect(out.map((u) => u.email)).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
    });
  });

  describe('groupUsers', () => {
    it('groups by teamLead with a (none) bucket for blanks, sorted', () => {
      const groups = groupUsers(users, 'teamLead');
      expect(groups.map((g) => g.label)).toEqual([
        'Akash Avasthi',
        'Brhamdev Sharma',
        '(none)',
      ]);
      const brhamdev = groups.find((g) => g.label === 'Brhamdev Sharma');
      expect(brhamdev?.users.map((u) => u.email).sort()).toEqual([
        'aarav.patel@x.com',
        'priya.singh@x.com',
      ]);
      const none = groups.find((g) => g.label === '(none)');
      expect(none?.users.map((u) => u.email)).toEqual(['zoya.khan@x.com']);
    });

    it('groups by team', () => {
      const groups = groupUsers(users, 'team');
      expect(groups.map((g) => g.label)).toEqual(['marketing', 'technical']);
    });

    it('groups by manager', () => {
      const groups = groupUsers(users, 'manager');
      expect(groups.map((g) => g.label)).toEqual(['Adnan Shaikh', 'Tushar Ahuja']);
    });

    it('returns a single group for by = none', () => {
      const groups = groupUsers(users, 'none');
      expect(groups).toHaveLength(1);
      expect(groups[0].users).toHaveLength(4);
    });
  });
});
