import { describe, it, expect } from 'vitest';
import {
  canCreate,
  canAssign,
  fieldPolicy,
  type ActorContext,
  type FieldKey,
} from '../rolePolicy';

const ctx: ActorContext = {
  selfDisplayName: 'Self Lead',
  actorManager: 'Actor Manager',
};

describe('rolePolicy', () => {
  // ---------------------------------------------------------------- canCreate
  describe('canCreate', () => {
    it('admin can create all eight roles', () => {
      expect(canCreate('admin')).toEqual([
        'admin',
        'mm',
        'mam',
        'am',
        'mlead',
        'lead',
        'recruiter',
        'user',
      ]);
    });

    it('mm can create mam, mlead, recruiter', () => {
      expect(canCreate('mm')).toEqual(['mam', 'mlead', 'recruiter']);
    });

    it('mam can create mlead, recruiter', () => {
      expect(canCreate('mam')).toEqual(['mlead', 'recruiter']);
    });

    it('am can create lead, user', () => {
      expect(canCreate('am')).toEqual(['lead', 'user']);
    });

    it('lead can create user', () => {
      expect(canCreate('lead')).toEqual(['user']);
    });

    it('mlead can create recruiter', () => {
      expect(canCreate('mlead')).toEqual(['recruiter']);
    });

    it('recruiter can create nothing', () => {
      expect(canCreate('recruiter')).toEqual([]);
    });

    it('user can create nothing', () => {
      expect(canCreate('user')).toEqual([]);
    });

    it('normalizes case and unknown actors', () => {
      expect(canCreate('ADMIN')).toEqual(canCreate('admin'));
      expect(canCreate('nonsense')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------- canAssign
  describe('canAssign', () => {
    it('admin can assign all eight roles', () => {
      expect(canAssign('admin')).toEqual([
        'admin',
        'mm',
        'mam',
        'am',
        'mlead',
        'lead',
        'recruiter',
        'user',
      ]);
    });

    it('mm can assign mam, mlead, recruiter', () => {
      expect(canAssign('mm')).toEqual(['mam', 'mlead', 'recruiter']);
    });

    it('mam can assign mlead, recruiter', () => {
      expect(canAssign('mam')).toEqual(['mlead', 'recruiter']);
    });

    it('am can assign lead, user', () => {
      expect(canAssign('am')).toEqual(['lead', 'user']);
    });

    it('lead can assign user', () => {
      expect(canAssign('lead')).toEqual(['user']);
    });

    it('mlead role is locked — assigns nothing', () => {
      expect(canAssign('mlead')).toEqual([]);
    });

    it('recruiter and user assign nothing', () => {
      expect(canAssign('recruiter')).toEqual([]);
      expect(canAssign('user')).toEqual([]);
    });
  });

  // --------------------------------------------------------------- fieldPolicy
  describe('fieldPolicy — admin', () => {
    it('makes every field editable', () => {
      const fields: FieldKey[] = [
        'role',
        'team',
        'teamLead',
        'manager',
        'active',
        'acceptsTasks',
        'password',
      ];
      fields.forEach((field) => {
        expect(fieldPolicy('admin', 'recruiter', field, ctx).state).toBe('editable');
      });
    });
  });

  describe('fieldPolicy — mm', () => {
    // DISCREPANCY (flagged in handoff): the matrix's per-field cell says
    // "mm: role locked", but the matrix's own canAssign row gives mm
    // [mam,mlead,recruiter] AND the current page renders the role <Select>
    // for mm on update (guard is only `normalizedRole !== 'mlead'`). The
    // page is the cited source of truth, so role is EDITABLE for mm — the
    // field state is derived from canAssign (locked iff nothing assignable).
    it('keeps the role field editable (canAssign(mm) is non-empty)', () => {
      expect(fieldPolicy('mm', 'mam', 'role', ctx).state).toBe('editable');
    });

    it('forces manager to self when present (auto)', () => {
      const r = fieldPolicy('mm', 'mam', 'manager', ctx);
      expect(r.state).toBe('auto');
      expect(r.value).toBe('Self Lead');
    });

    it('falls back manager to actorManager when self is blank', () => {
      const r = fieldPolicy('mm', 'mam', 'manager', { selfDisplayName: '', actorManager: 'Actor Manager' });
      expect(r.state).toBe('auto');
      expect(r.value).toBe('Actor Manager');
    });

    it('hides teamLead when the target is mam', () => {
      expect(fieldPolicy('mm', 'mam', 'teamLead', ctx).state).toBe('hidden');
    });

    it('makes teamLead editable when the target is not mam', () => {
      expect(fieldPolicy('mm', 'mlead', 'teamLead', ctx).state).toBe('editable');
      expect(fieldPolicy('mm', 'recruiter', 'teamLead', ctx).state).toBe('editable');
    });

    it('hides team and keeps active/password editable', () => {
      expect(fieldPolicy('mm', 'mam', 'team', ctx).state).toBe('hidden');
      expect(fieldPolicy('mm', 'mam', 'active', ctx).state).toBe('editable');
      expect(fieldPolicy('mm', 'mam', 'password', ctx).state).toBe('editable');
      expect(fieldPolicy('mm', 'mam', 'acceptsTasks', ctx).state).toBe('editable');
    });
  });

  describe('fieldPolicy — mam', () => {
    it('keeps role editable', () => {
      expect(fieldPolicy('mam', 'mlead', 'role', ctx).state).toBe('editable');
    });

    it('target=mlead → teamLead auto=self, manager auto=actorManager', () => {
      const tl = fieldPolicy('mam', 'mlead', 'teamLead', ctx);
      expect(tl.state).toBe('auto');
      expect(tl.value).toBe('Self Lead');
      const mgr = fieldPolicy('mam', 'mlead', 'manager', ctx);
      expect(mgr.state).toBe('auto');
      expect(mgr.value).toBe('Actor Manager');
    });

    it('target=recruiter → teamLead editable, manager editable', () => {
      expect(fieldPolicy('mam', 'recruiter', 'teamLead', ctx).state).toBe('editable');
      expect(fieldPolicy('mam', 'recruiter', 'manager', ctx).state).toBe('editable');
    });

    it('hides team, keeps active/password editable', () => {
      expect(fieldPolicy('mam', 'recruiter', 'team', ctx).state).toBe('hidden');
      expect(fieldPolicy('mam', 'recruiter', 'active', ctx).state).toBe('editable');
      expect(fieldPolicy('mam', 'recruiter', 'password', ctx).state).toBe('editable');
    });
  });

  describe('fieldPolicy — am', () => {
    it('keeps role editable', () => {
      expect(fieldPolicy('am', 'lead', 'role', ctx).state).toBe('editable');
    });

    it('target=lead → teamLead auto=self, manager auto=actorManager', () => {
      const tl = fieldPolicy('am', 'lead', 'teamLead', ctx);
      expect(tl.state).toBe('auto');
      expect(tl.value).toBe('Self Lead');
      const mgr = fieldPolicy('am', 'lead', 'manager', ctx);
      expect(mgr.state).toBe('auto');
      expect(mgr.value).toBe('Actor Manager');
    });

    it('target=user → teamLead editable, manager auto=actorManager', () => {
      expect(fieldPolicy('am', 'user', 'teamLead', ctx).state).toBe('editable');
      const mgr = fieldPolicy('am', 'user', 'manager', ctx);
      expect(mgr.state).toBe('auto');
      expect(mgr.value).toBe('Actor Manager');
    });

    it('hides team, keeps active/password editable', () => {
      expect(fieldPolicy('am', 'user', 'team', ctx).state).toBe('hidden');
      expect(fieldPolicy('am', 'user', 'active', ctx).state).toBe('editable');
      expect(fieldPolicy('am', 'user', 'password', ctx).state).toBe('editable');
    });
  });

  describe('fieldPolicy — mlead', () => {
    it('locks the role field', () => {
      expect(fieldPolicy('mlead', 'recruiter', 'role', ctx).state).toBe('locked');
    });

    it('locks teamLead to self', () => {
      const tl = fieldPolicy('mlead', 'recruiter', 'teamLead', ctx);
      expect(tl.state).toBe('locked');
      expect(tl.value).toBe('Self Lead');
    });

    it('locks manager to actorManager', () => {
      const mgr = fieldPolicy('mlead', 'recruiter', 'manager', ctx);
      expect(mgr.state).toBe('locked');
      expect(mgr.value).toBe('Actor Manager');
    });

    it('hides team, keeps active/password editable', () => {
      expect(fieldPolicy('mlead', 'recruiter', 'team', ctx).state).toBe('hidden');
      expect(fieldPolicy('mlead', 'recruiter', 'active', ctx).state).toBe('editable');
      expect(fieldPolicy('mlead', 'recruiter', 'password', ctx).state).toBe('editable');
    });
  });

  describe('fieldPolicy — lead', () => {
    it('keeps role editable', () => {
      expect(fieldPolicy('lead', 'user', 'role', ctx).state).toBe('editable');
    });

    it('locks teamLead to self and manager to actorManager', () => {
      const tl = fieldPolicy('lead', 'user', 'teamLead', ctx);
      expect(tl.state).toBe('locked');
      expect(tl.value).toBe('Self Lead');
      const mgr = fieldPolicy('lead', 'user', 'manager', ctx);
      expect(mgr.state).toBe('locked');
      expect(mgr.value).toBe('Actor Manager');
    });

    it('hides team, keeps active/password editable', () => {
      expect(fieldPolicy('lead', 'user', 'team', ctx).state).toBe('hidden');
      expect(fieldPolicy('lead', 'user', 'active', ctx).state).toBe('editable');
      expect(fieldPolicy('lead', 'user', 'password', ctx).state).toBe('editable');
    });
  });

  describe('fieldPolicy — recruiter / user (non-managing)', () => {
    it('locks every field for recruiter', () => {
      const fields: FieldKey[] = [
        'role',
        'team',
        'teamLead',
        'manager',
        'active',
        'acceptsTasks',
        'password',
      ];
      fields.forEach((field) => {
        expect(fieldPolicy('recruiter', 'user', field, ctx).state).toBe('locked');
      });
    });

    it('locks every field for user', () => {
      const fields: FieldKey[] = [
        'role',
        'team',
        'teamLead',
        'manager',
        'active',
        'acceptsTasks',
        'password',
      ];
      fields.forEach((field) => {
        expect(fieldPolicy('user', 'user', field, ctx).state).toBe('locked');
      });
    });
  });

  describe('fieldPolicy — normalization', () => {
    it('lowercases actor and targetRole', () => {
      expect(fieldPolicy('MM', 'MAM', 'teamLead', ctx).state).toBe('hidden');
      expect(fieldPolicy('Admin', 'Recruiter', 'team', ctx).state).toBe('editable');
    });
  });
});
