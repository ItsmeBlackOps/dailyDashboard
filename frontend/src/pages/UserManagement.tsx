import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { API_URL, useAuth } from '@/hooks/useAuth';
import { deriveDisplayNameFromEmail, formatNameInput } from '@/utils/userNames';

interface ManageableUser {
  email: string;
  role: string;
  teamLead?: string;
  manager?: string;
  active: boolean;
}

interface BulkCreatePayload {
  email: string;
  password: string;
  role: string;
  teamLead?: string;
  manager?: string;
  active: boolean;
}

interface BulkUpdateDraft {
  role: string;
  teamLead: string;
  manager: string;
  active: 'unchanged' | 'activate' | 'deactivate';
  password: string;
}

interface BulkCreateResult {
  success: boolean;
  created: Array<{ email: string; role: string }>;
  failures: Array<{ index: number; email: string | null; error: string }>;
}

interface BulkUpdateResult {
  success: boolean;
  updates: Array<{ email: string; appliedChanges: string[] }>;
  failures: Array<{ index: number; email: string | null; error: string }>;
}

const MAX_CREATE_ROWS = 10;

function normalizeRole(role: string) {
  return role.trim().toLowerCase();
}

function canonicalRole(role: string) {
  const normalized = normalizeRole(role);
  switch (normalized) {
    case 'mm':
      return 'MM';
    case 'mam':
      return 'MAM';
    case 'am':
      return 'AM';
    case 'mlead':
      return 'mlead';
    case 'recruiter':
      return 'recruiter';
    case 'admin':
      return 'admin';
    case 'manager':
      return 'manager';
    case 'lead':
      return 'lead';
    case 'user':
      return 'user';
    case 'expert':
      return 'expert';
    default:
      return '';
  }
}

function getCreatableRoles(role: string): string[] {
  const normalized = normalizeRole(role);
  if (normalized === 'admin') {
    return ['admin', 'manager', 'MM', 'MAM', 'AM', 'mlead', 'recruiter', 'lead', 'user', 'expert'];
  }
  if (normalized === 'manager') {
    return ['MM', 'MAM', 'AM', 'mlead', 'recruiter', 'lead', 'user', 'expert'];
  }
  if (normalized === 'mm') {
    return ['MAM'];
  }
  if (normalized === 'mam') {
    return ['mlead', 'recruiter'];
  }
  if (normalized === 'am') {
    return ['lead', 'user'];
  }
  if (normalized === 'lead') {
    return ['user'];
  }
  if (normalized === 'mlead') {
    return ['recruiter'];
  }
  return [];
}

const INITIAL_UPDATE_DRAFT: BulkUpdateDraft = {
  role: '__no_change__',
  teamLead: '',
  manager: '',
  active: 'unchanged',
  password: ''
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UserManagementPage = () => {
  const { authFetch } = useAuth();
  const { toast } = useToast();

  const [role, setRole] = useState('');
  const [manageableUsers, setManageableUsers] = useState<ManageableUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [updateDraft, setUpdateDraft] = useState<BulkUpdateDraft>(INITIAL_UPDATE_DRAFT);
  const [createRows, setCreateRows] = useState<BulkCreatePayload[]>([
    { email: '', password: '', role: '', active: true }
  ]);
  const [createResult, setCreateResult] = useState<BulkCreateResult | null>(null);
  const [updateResult, setUpdateResult] = useState<BulkUpdateResult | null>(null);
  const [selfEmail, setSelfEmail] = useState('');
  const [selfManagerName, setSelfManagerName] = useState('');
  const [selfDisplayNameOverride, setSelfDisplayNameOverride] = useState('');

  const normalizedRole = normalizeRole(role);
  const creatableRoles = useMemo(() => getCreatableRoles(role), [role]);
  const canCreate = creatableRoles.length > 0;
  const canManage = ['admin', 'manager', 'mm', 'mam', 'mlead', 'lead', 'am'].includes(normalizedRole);
  const selfDisplayName = useMemo(() => {
    const derived = deriveDisplayNameFromEmail(selfEmail);
    return derived || selfDisplayNameOverride;
  }, [selfEmail, selfDisplayNameOverride]);
  const normalizedManagerName = useMemo(() => formatNameInput(selfManagerName), [selfManagerName]);

  const enforceRoleDefaults = useCallback(
    (entry: BulkCreatePayload): BulkCreatePayload => {
      const canonical = canonicalRole(entry.role);
      const normalizedTarget = (canonical || '').toLowerCase();
      const currentTeamLead = formatNameInput(entry.teamLead ?? '');
      const currentManager = formatNameInput(entry.manager ?? '');
      const targetDisplayName = formatNameInput(deriveDisplayNameFromEmail(entry.email));

      let next: BulkCreatePayload = { ...entry, role: canonical };

      if (normalizedRole === 'mam' && normalizedTarget === 'mlead') {
        const defaultLead = selfDisplayName;
        if (!currentTeamLead && defaultLead) {
          next = { ...next, teamLead: defaultLead };
        }
        if (!currentManager && targetDisplayName) {
          next = { ...next, manager: targetDisplayName };
        }
      }

      if (normalizedRole === 'am') {
        if (normalizedTarget === 'lead') {
          if (!currentTeamLead && selfDisplayName) {
            next = { ...next, teamLead: selfDisplayName };
          }
          if (!currentManager && normalizedManagerName) {
            next = { ...next, manager: normalizedManagerName };
          }
        }
      }

      if (normalizedRole === 'mlead') {
        next = { ...next, role: 'recruiter' };
        if (!currentTeamLead && selfDisplayName) {
          next = { ...next, teamLead: selfDisplayName };
        }
        if (!currentManager && normalizedManagerName) {
          next = { ...next, manager: normalizedManagerName };
        }
      }

      if (normalizedRole === 'lead') {
        if (!currentTeamLead && selfDisplayName) {
          next = { ...next, teamLead: selfDisplayName };
        }
        if (!currentManager && normalizedManagerName) {
          next = { ...next, manager: normalizedManagerName };
        }
      }

      return next;
    },
    [normalizedRole, selfDisplayName, normalizedManagerName]
  );

  const applyDefaultRole = useCallback(
    (entries: BulkCreatePayload[]): BulkCreatePayload[] => {
      if (creatableRoles.length === 0) {
        return entries.map((entry) => enforceRoleDefaults(entry));
      }
      return entries.map((entry) => {
        const canonical = canonicalRole(entry.role);
        if (!canonical || !creatableRoles.includes(canonical)) {
          return enforceRoleDefaults({ ...entry, role: creatableRoles[0] });
        }
        return enforceRoleDefaults({ ...entry, role: canonical });
      });
    },
    [creatableRoles, enforceRoleDefaults]
  );

  const fetchManageableUsers = useCallback(async () => {
    if (!canManage) {
      setManageableUsers([]);
      return;
    }

    try {
      setLoadingUsers(true);
      setUsersError('');
      const res = await authFetch(`${API_URL}/api/users/manageable`);
      const data = await res.json();
      if (!data?.success) {
        throw new Error(data?.error || 'Unable to load users');
      }
      setManageableUsers(Array.isArray(data.users) ? data.users : []);
      setSelectedEmails(new Set());
    } catch (error: any) {
      setUsersError(error?.message || 'Failed to load manageable users');
      setManageableUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }, [authFetch, canManage]);

  useEffect(() => {
    setRole(localStorage.getItem('role') || '');
    setSelfEmail(localStorage.getItem('email') || '');
    setSelfManagerName(localStorage.getItem('manager') || '');
    setSelfDisplayNameOverride(formatNameInput(localStorage.getItem('displayName') ?? ''));
  }, []);

  useEffect(() => {
    if (canManage) {
      fetchManageableUsers();
    }
  }, [canManage, fetchManageableUsers]);

  useEffect(() => {
    setCreateRows((prev) => applyDefaultRole(prev));
  }, [applyDefaultRole]);

  const roleRosters = useMemo(() => {
    const rosterSets = {
      manager: new Set<string>(),
      mm: new Set<string>(),
      mam: new Set<string>(),
      mlead: new Set<string>(),
      lead: new Set<string>(),
      am: new Set<string>(),
    };

    const addName = (set: Set<string>, name: string) => {
      const formatted = formatNameInput(name);
      if (formatted) {
        set.add(formatted);
      }
    };

    manageableUsers.forEach((user) => {
      const roleKey = (user.role || '').toLowerCase();
      const display = deriveDisplayNameFromEmail(user.email);
      switch (roleKey) {
        case 'manager':
          addName(rosterSets.manager, display);
          break;
        case 'mm':
          addName(rosterSets.mm, display);
          break;
        case 'mam':
          addName(rosterSets.mam, display);
          break;
        case 'mlead':
          addName(rosterSets.mlead, display);
          break;
        case 'lead':
          addName(rosterSets.lead, display);
          break;
        case 'am':
          addName(rosterSets.am, display);
          break;
        default:
          break;
      }
    });

    const normalizedSelfDisplay = formatNameInput(selfDisplayName);
    switch (normalizedRole) {
      case 'manager':
        addName(rosterSets.manager, normalizedSelfDisplay);
        break;
      case 'mm':
        addName(rosterSets.mm, normalizedSelfDisplay);
        break;
      case 'mam':
        addName(rosterSets.mam, normalizedSelfDisplay);
        break;
      case 'mlead':
        addName(rosterSets.mlead, normalizedSelfDisplay);
        break;
      case 'lead':
        addName(rosterSets.lead, normalizedSelfDisplay);
        break;
      case 'am':
        addName(rosterSets.am, normalizedSelfDisplay);
        break;
      default:
        break;
    }

    const toSortedArray = (set: Set<string>) => Array.from(set).sort();
    return {
      manager: toSortedArray(rosterSets.manager),
      mm: toSortedArray(rosterSets.mm),
      mam: toSortedArray(rosterSets.mam),
      mlead: toSortedArray(rosterSets.mlead),
      lead: toSortedArray(rosterSets.lead),
      am: toSortedArray(rosterSets.am),
    };
  }, [manageableUsers, normalizedRole, selfDisplayName]);

  const ensureOptions = useCallback((options: string[], value?: string) => {
    const formatted = formatNameInput(value ?? '');
    if (!formatted) {
      return options;
    }
    if (options.includes(formatted)) {
      return options;
    }
    return [...options, formatted].sort();
  }, []);

  const getTeamLeadOptions = useCallback(
    (canonicalRoleValue: string, existingValue?: string, emailForDefault?: string) => {
      const normalizedTarget = (canonicalRoleValue || '').toLowerCase();
      const derivedDefault = formatNameInput(emailForDefault ? deriveDisplayNameFromEmail(emailForDefault) : '');
      let base: string[] = [];

      switch (normalizedTarget) {
        case 'user':
          base = roleRosters.lead;
          break;
        case 'lead':
          base = roleRosters.am;
          break;
        case 'am':
          base = [];
          break;
        case 'recruiter':
          base = [...roleRosters.mlead, ...roleRosters.mam];
          break;
        case 'mlead':
          base = roleRosters.mam;
          break;
        case 'mam':
          base = [];
          break;
        default:
          base = [];
      }

      let options = [...base];
      options = ensureOptions(options, existingValue);
      options = ensureOptions(options, derivedDefault);
      return options;
    },
    [roleRosters, ensureOptions]
  );

  const getManagerOptions = useCallback(
    (canonicalRoleValue: string, existingValue?: string, fallbackName?: string) => {
      const normalizedTarget = (canonicalRoleValue || '').toLowerCase();
      let base = roleRosters.manager;

      if (normalizedTarget === 'recruiter') {
        base = roleRosters.mm.length > 0 ? roleRosters.mm : base;
      }

      if (base.length === 0 && roleRosters.manager.length === 0 && roleRosters.mm.length > 0) {
        base = roleRosters.mm;
      }

      let options = [...base];
      options = ensureOptions(options, existingValue);
      options = ensureOptions(options, fallbackName);
      return options;
    },
    [roleRosters, ensureOptions]
  );

  const computeManagerValue = useCallback(
    (canonicalRoleValue: string, rawInput?: string, emailForDefault?: string) => {
      const formatted = formatNameInput(rawInput ?? '');
      if (formatted) {
        return formatted;
      }

      const normalizedTarget = (canonicalRoleValue || '').toLowerCase();

      if (normalizedRole === 'am') {
        if (['lead', 'mlead', 'user'].includes(normalizedTarget) && normalizedManagerName) {
          return normalizedManagerName;
        }
      }

      const fallbackFromEmail = formatNameInput(emailForDefault ? deriveDisplayNameFromEmail(emailForDefault) : '');
      const fallbackManager = normalizedManagerName || fallbackFromEmail;
      const options = getManagerOptions(canonicalRoleValue, undefined, fallbackManager);
      return options[0] || '';
    },
    [getManagerOptions, normalizedManagerName, normalizedRole]
  );

  const computeTeamLeadValue = useCallback(
    (canonicalRoleValue: string, rawInput?: string, emailForDefault?: string) => {
      const formatted = formatNameInput(rawInput ?? '');
      if (formatted) {
        return formatted;
      }

      const normalizedTarget = (canonicalRoleValue || '').toLowerCase();

      if (normalizedRole === 'am') {
        if (normalizedTarget === 'user') {
          return '';
        }
        if (normalizedTarget === 'lead' && selfDisplayName) {
          return selfDisplayName;
        }

      }

      const options = getTeamLeadOptions(canonicalRoleValue, undefined, emailForDefault);
      if (options.length > 0) {
        return options[0];
      }

      const derivedDefault = formatNameInput(emailForDefault ? deriveDisplayNameFromEmail(emailForDefault) : '');
      return derivedDefault;
    },
    [getTeamLeadOptions, normalizedRole, selfDisplayName]
  );

  const selectedUsers = useMemo(
    () => manageableUsers.filter((user) => selectedEmails.has(user.email)),
    [manageableUsers, selectedEmails]
  );
  const selectedRolesList = useMemo(
    () => selectedUsers.map((user) => (user.role || '').toLowerCase()),
    [selectedUsers]
  );
  const mmHasSelection = normalizedRole === 'mm' && selectedRolesList.length > 0;
  const mmEditingMamsOnly = normalizedRole === 'mm' && selectedRolesList.length > 0 && selectedRolesList.every((role) => role === 'mam');
  const mmEditingMleadsOnly = normalizedRole === 'mm' && selectedRolesList.length > 0 && selectedRolesList.every((role) => role === 'mlead');
  const mmEditingRecruitersOnly = normalizedRole === 'mm' && selectedRolesList.length > 0 && selectedRolesList.every((role) => role === 'recruiter');

  const updateCreateRow = (index: number, updates: Partial<BulkCreatePayload>) => {
    setCreateRows((prev) => {
      const next = [...prev];
      next[index] = applyDefaultRole([{ ...next[index], ...updates }])[0];
      return next;
    });
  };

  const addCreateRow = () => {
    if (createRows.length >= MAX_CREATE_ROWS) {
      toast({ title: 'Limit reached', description: `You can only add up to ${MAX_CREATE_ROWS} rows at once.` });
      return;
    }
    setCreateRows((prev) => applyDefaultRole([
      ...prev,
      { email: '', password: '', role: creatableRoles[0] ?? '', active: true }
    ]));
  };

  const removeCreateRow = (index: number) => {
    setCreateRows((prev) => {
      if (prev.length === 1) {
        return applyDefaultRole([{ email: '', password: '', role: creatableRoles[0] ?? '', active: true }]);
      }
      const next = prev.filter((_, i) => i !== index);
      return applyDefaultRole(next);
    });
  };

  const toggleSelectedEmail = (email: string, checked: boolean) => {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(email);
      } else {
        next.delete(email);
      }
      return next;
    });
  };

  const resetCreateRows = () => {
    setCreateRows(applyDefaultRole([{ email: '', password: '', role: creatableRoles[0] ?? '', active: true }]));
  };

  const handleBulkCreate = async () => {
    if (!canCreate) return;

    const payload = createRows.map((row) => {
      const canonical = canonicalRole(row.role);
      const teamLeadValue = computeTeamLeadValue(canonical, row.teamLead, row.email);
      const managerValue = computeManagerValue(canonical, row.manager, row.email);

      return {
        email: row.email.trim(),
        password: row.password,
        role: canonical,
        teamLead: teamLeadValue || undefined,
        manager: managerValue || undefined,
        active: row.active
      };
    });

    for (let i = 0; i < payload.length; i += 1) {
      const row = payload[i];
      if (!row.email || !emailRegex.test(row.email)) {
        toast({ title: 'Invalid row', description: `Row ${i + 1} is missing a valid email.`, variant: 'destructive' });
        return;
      }
      if (!row.password || row.password.length < 6) {
        toast({ title: 'Invalid row', description: `Row ${i + 1} needs a password (min 6 chars).`, variant: 'destructive' });
        return;
      }
      if (!row.role || !creatableRoles.includes(row.role)) {
        toast({ title: 'Invalid row', description: `Row ${i + 1} has an unsupported role.`, variant: 'destructive' });
        return;
      }
    }

    try {
      const res = await authFetch(`${API_URL}/api/users/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: payload })
      });
      const data: BulkCreateResult = await res.json();
      setCreateResult(data);

      if (data.success) {
        toast({ title: 'Users created', description: `${data.created.length} user(s) created successfully.` });
        resetCreateRows();
        fetchManageableUsers();
      } else {
        toast({ title: 'Partial completion', description: `${data.created.length} created, ${data.failures.length} failed.`, variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Bulk create failed', description: error?.message || 'Unable to create users', variant: 'destructive' });
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedEmails.size === 0) {
      toast({ title: 'No users selected', description: 'Select at least one user to update.', variant: 'destructive' });
      return;
    }

    const updates = Array.from(selectedEmails).map((email) => {
      const entry: any = { email };
      const targetUser = manageableUsers.find((user) => user.email === email);
      const targetRole = (targetUser?.role || '').toLowerCase();

      if (updateDraft.role !== '__no_change__' && normalizedRole !== 'mlead') {
        entry.role = updateDraft.role;
      }

      const formattedTeamLead = formatNameInput(updateDraft.teamLead);
      if (formattedTeamLead) {
        entry.teamLead = formattedTeamLead;
      }

      const formattedManager = formatNameInput(updateDraft.manager);
      if (formattedManager) {
        entry.manager = formattedManager;
      }

      if (updateDraft.active === 'activate') {
        entry.active = true;
      } else if (updateDraft.active === 'deactivate') {
        entry.active = false;
      }

      if (updateDraft.password.trim()) {
        entry.password = updateDraft.password.trim();
      }

      if (normalizedRole === 'mam') {
        if (targetRole === 'mlead') {
          if (selfDisplayName) {
            entry.teamLead = selfDisplayName;
          }
          if (!entry.manager && normalizedManagerName) {
            entry.manager = normalizedManagerName;
          }
        }
        if (targetRole === 'recruiter') {
          if (!entry.manager) {
            const currentManager = formatNameInput(targetUser?.manager ?? '');
            entry.manager = currentManager || normalizedManagerName || undefined;
          }
          if (!entry.teamLead) {
            const currentTeamLead = formatNameInput(targetUser?.teamLead ?? '');
            entry.teamLead = currentTeamLead || undefined;
          }
        }
      }

      if (normalizedRole === 'mm') {
        const mmManager = selfDisplayName || normalizedManagerName;
        if (mmManager) {
          entry.manager = mmManager;
        }

        if (targetRole === 'mam') {
          delete entry.teamLead;
        }

        if (targetRole === 'mlead' || targetRole === 'recruiter') {
          if (!entry.teamLead) {
            const currentTeamLead = formatNameInput(targetUser?.teamLead ?? '');
            if (currentTeamLead) {
              entry.teamLead = currentTeamLead;
            }
          }
        }
      }

      if (normalizedRole === 'mlead') {
        if (!entry.teamLead && selfDisplayName) {
          entry.teamLead = selfDisplayName;
        }
        if (!entry.manager && normalizedManagerName) {
          entry.manager = normalizedManagerName;
        }
      }

      if (normalizedRole === 'am') {
        if (targetRole === 'lead') {
          if (!entry.teamLead && selfDisplayName) {
            entry.teamLead = selfDisplayName;
          }
          if (!entry.manager && normalizedManagerName) {
            entry.manager = normalizedManagerName;
          }
        }


        if (targetRole === 'user' && !entry.manager && normalizedManagerName) {
          entry.manager = normalizedManagerName;
        }
      }

      return entry;
    });

    const hasChange = updates.some((entry) => Object.keys(entry).length > 1);
    if (!hasChange) {
      toast({ title: 'No changes', description: 'Set at least one field to update.', variant: 'destructive' });
      return;
    }

    try {
      const res = await authFetch(`${API_URL}/api/users/bulk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: updates })
      });
      const data: BulkUpdateResult = await res.json();
      setUpdateResult(data);

      if (data.success) {
        toast({ title: 'Users updated', description: `${data.updates.length} user(s) updated.` });
        setUpdateDraft(INITIAL_UPDATE_DRAFT);
        setSelectedEmails(new Set());
        fetchManageableUsers();
      } else {
        toast({ title: 'Partial update', description: `${data.updates.length} updated, ${data.failures.length} failed.`, variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Bulk update failed', description: error?.message || 'Unable to update users', variant: 'destructive' });
    }
  };

  const assignableRoles = useMemo(() => {
    if (normalizedRole === 'mlead') {
      return ['__no_change__'];
    }
    if (normalizedRole === 'mm') {
      return ['__no_change__', 'MAM', 'mlead', 'recruiter'];
    }
    const roles = getCreatableRoles(role);
    return ['__no_change__', ...roles];
  }, [normalizedRole, role]);

  const updateRoleCanonical = updateDraft.role === '__no_change__' ? '' : updateDraft.role;

  const updateTeamLeadOptions = useMemo(() => {
    const rolesToConsider = updateRoleCanonical
      ? [updateRoleCanonical]
      : Array.from(new Set(selectedRolesList)).filter(Boolean);

    let aggregated: string[] = [];
    rolesToConsider.forEach((roleKey) => {
      const options = getTeamLeadOptions(roleKey, updateDraft.teamLead);
      options.forEach((option) => {
        aggregated = ensureOptions(aggregated, option);
      });
    });

    aggregated = ensureOptions(aggregated, updateDraft.teamLead);
    selectedUsers.forEach((user) => {
      aggregated = ensureOptions(aggregated, user.teamLead);
    });

    return aggregated;
  }, [updateRoleCanonical, selectedRolesList, getTeamLeadOptions, updateDraft.teamLead, selectedUsers, ensureOptions]);

  const updateManagerOptions = useMemo(() => {
    const rolesToConsider = updateRoleCanonical
      ? [updateRoleCanonical]
      : Array.from(new Set(selectedRolesList)).filter(Boolean);

    let aggregated: string[] = [];
    rolesToConsider.forEach((roleKey) => {
      const options = getManagerOptions(roleKey, updateDraft.manager, normalizedManagerName);
      options.forEach((option) => {
        aggregated = ensureOptions(aggregated, option);
      });
    });

    aggregated = ensureOptions(aggregated, updateDraft.manager);
    selectedUsers.forEach((user) => {
      aggregated = ensureOptions(aggregated, user.manager);
    });

    return aggregated;
  }, [updateRoleCanonical, selectedRolesList, getManagerOptions, updateDraft.manager, selectedUsers, ensureOptions, normalizedManagerName]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">User Management</h1>
          <p className="text-muted-foreground text-sm">
            Provision and update users in your hierarchy. Passwords must be at least six characters and new accounts default to active unless specified.
          </p>
        </div>

        {canCreate && (
          <Card>
            <CardHeader>
              <CardTitle>Bulk Create Users</CardTitle>
              <CardDescription>
                {`Create up to ${MAX_CREATE_ROWS} users at once. Roles allowed: ${creatableRoles.join(', ')}.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {createRows.map((row, index) => {
                  const canonical = canonicalRole(row.role);
                  const normalizedRowRole = (canonical || '').toLowerCase();
                  const teamLeadOptionsForRow = getTeamLeadOptions(canonical, row.teamLead, row.email);
                  const managerOptionsForRow = getManagerOptions(canonical, row.manager, normalizedManagerName);
                  const teamLeadListId = `teamLead-options-${index}`;
                  const managerListId = `manager-options-${index}`;
                  const showTeamLeadInput = ['admin', 'manager'].includes(normalizedRole);
                  const hasTeamLeadOptions = teamLeadOptionsForRow.length > 0;
                  const canEditTeamLead =
                    showTeamLeadInput ||
                    normalizedRole === 'mam' ||
                    (normalizedRole === 'am' && normalizedRowRole === 'user');
                  const defaultTeamLead = computeTeamLeadValue(canonical, undefined, row.email);
                  const defaultManager = computeManagerValue(canonical, row.manager, row.email);
                  const teamLeadInputValue = formatNameInput(row.teamLead ?? '') ? row.teamLead ?? '' : defaultTeamLead;
                  const managerInputValue = formatNameInput(row.manager ?? '') ? row.manager ?? '' : defaultManager;
                  const teamLeadLabel = 'Team Lead';
                  const showRoleSelect = normalizedRole !== 'mlead';
                  const isMamCreatingMlead = normalizedRole === 'mam' && normalizedRowRole === 'mlead';
                  const isRecruiterTarget = normalizedRowRole === 'recruiter';
                  const showManagerInput = ['admin', 'manager'].includes(normalizedRole);
                  const autoTeamLead = normalizedRole === 'mm'
                    ? 'Not required'
                    : defaultTeamLead || selfDisplayName || 'Auto assigned';
                  const autoManager = defaultManager
                    || (normalizedRole === 'am'
                      ? (normalizedManagerName || 'Auto assigned')
                      : normalizedRole === 'mam'
                        ? (normalizedManagerName || 'Auto assigned')
                        : normalizedRole === 'mlead'
                          ? (normalizedManagerName || 'Auto assigned')
                          : normalizedRole === 'lead'
                            ? (normalizedManagerName || 'Auto assigned')
                            : (selfDisplayName || normalizedManagerName || 'Auto assigned'));

                  return (
                    <div key={index} className="grid items-start gap-3 md:grid-cols-[repeat(7,minmax(0,1fr))]">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Email</label>
                        <Input
                          placeholder="user@example.com"
                          value={row.email}
                          onChange={(event) => updateCreateRow(index, { email: event.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Password</label>
                        <Input
                          type="password"
                          placeholder="Min 6 characters"
                          value={row.password}
                          onChange={(event) => updateCreateRow(index, { password: event.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Role</label>
                        {showRoleSelect ? (
                          <Select
                            value={row.role || creatableRoles[0] || ''}
                            onValueChange={(value) => updateCreateRow(index, { role: value })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select role" />
                            </SelectTrigger>
                            <SelectContent>
                              {creatableRoles.map((roleOption) => (
                                <SelectItem key={roleOption} value={roleOption}>
                                  {roleOption}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                            recruiter
                          </div>
                        )}
                      </div>

                      {canEditTeamLead ? (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">
                            {teamLeadLabel}
                            {!isMamCreatingMlead && !isRecruiterTarget ? ' (optional)' : ''}
                          </label>
                          {isMamCreatingMlead ? (
                            <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                              {teamLeadInputValue || selfDisplayName || 'Auto assigned'}
                            </div>
                          ) : isRecruiterTarget ? (
                            <Select
                              value={teamLeadInputValue || ''}
                              onValueChange={(value) => updateCreateRow(index, { teamLead: value })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={hasTeamLeadOptions ? 'Select team lead' : 'No team leads available'} />
                              </SelectTrigger>
                              <SelectContent>
                                {teamLeadOptionsForRow.map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {option}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : hasTeamLeadOptions ? (
                            <Select
                              value={teamLeadInputValue || ''}
                              onValueChange={(value) => updateCreateRow(index, { teamLead: value })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select team lead" />
                              </SelectTrigger>
                              <SelectContent>
                                {teamLeadOptionsForRow.map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {option}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <>
                              <Input
                                placeholder="Auto if left blank"
                                value={teamLeadInputValue}
                                list={teamLeadListId}
                                onChange={(event) => updateCreateRow(index, { teamLead: event.target.value })}
                              />
                              <datalist id={teamLeadListId}>
                                {teamLeadOptionsForRow.map((option) => (
                                  <option key={option} value={option} />
                                ))}
                              </datalist>
                            </>
                          )}
                          {normalizedRole === 'mm' && normalizedRowRole === 'mlead' && !isMamCreatingMlead && (
                            <p className="text-[11px] text-muted-foreground">Select the assistant manager who will guide this team lead.</p>
                          )}
                          {normalizedRole === 'mam' && normalizedRowRole === 'recruiter' && (
                            <p className="text-[11px] text-muted-foreground">Assign the recruiter to one of your team leads.</p>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">{teamLeadLabel}</label>
                          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                            {autoTeamLead}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {normalizedRole === 'mm'
                              ? 'Team lead is not required for managers.'
                              : 'Team lead is assigned automatically for your role.'}
                          </p>
                        </div>
                      )}

                      {showManagerInput ? (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Manager (optional)</label>
                          <Input
                            placeholder="Auto if left blank"
                            value={managerInputValue}
                            list={managerListId}
                            onChange={(event) => updateCreateRow(index, { manager: event.target.value })}
                          />
                          <datalist id={managerListId}>
                            {managerOptionsForRow.map((option) => (
                              <option key={option} value={option} />
                            ))}
                          </datalist>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Manager</label>
                          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                            {autoManager}
                          </div>
                          <p className="text-[11px] text-muted-foreground">Manager follows your reporting line and updates automatically.</p>
                        </div>
                      )}

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground" htmlFor={`active-${index}`}>
                          Active
                        </label>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Switch
                              id={`active-${index}`}
                              checked={row.active}
                              onCheckedChange={(checked) => updateCreateRow(index, { active: checked })}
                            />
                            <span className="text-xs text-muted-foreground">{row.active ? 'Enabled' : 'Disabled'}</span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-9 px-3"
                            onClick={() => removeCreateRow(index)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={addCreateRow} disabled={!canCreate}>
                  Add Row
                </Button>
                <Button type="button" onClick={handleBulkCreate} disabled={!canCreate}>
                  Create Users
                </Button>
                <Button type="button" variant="ghost" onClick={resetCreateRows}>
                  Reset
                </Button>
              </div>
              {createResult && (
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>{`Created: ${createResult.created.length}, Failures: ${createResult.failures.length}`}</p>
                  {createResult.failures.length > 0 && (
                    <ul className="list-disc pl-5">
                      {createResult.failures.map((failure) => (
                        <li key={`${failure.index}-${failure.email || 'unknown'}`}>
                          {`Row ${failure.index + 1}${failure.email ? ` (${failure.email})` : ''}: ${failure.error}`}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle>Bulk Update Users</CardTitle>
              <CardDescription>
                Select users below and apply updates such as role changes, team lead reassignment, active status toggles, or password resets.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[repeat(5,minmax(0,1fr))] items-end">
                {normalizedRole !== 'mlead' && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Role</label>
                    <Select
                      value={updateDraft.role}
                      onValueChange={(value) => setUpdateDraft((prev) => ({ ...prev, role: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="No change" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__no_change__">No change</SelectItem>
                        {assignableRoles
                          .filter((roleOption) => roleOption !== '__no_change__')
                          .map((roleOption) => (
                            <SelectItem key={roleOption} value={roleOption}>
                              {roleOption}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(() => {
                  if (['admin', 'manager'].includes(normalizedRole)) {
                    return (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Team Lead</label>
                        <Input
                          placeholder="Leave blank to keep existing"
                          value={updateDraft.teamLead}
                          list="update-teamLead-options"
                          onChange={(event) => setUpdateDraft((prev) => ({ ...prev, teamLead: event.target.value }))}
                        />
                      </div>
                    );
                  }

                  if (normalizedRole === 'mm') {
                    if (!mmHasSelection) {
                      return (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Team Lead</label>
                          <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                            Select users to configure
                          </div>
                        </div>
                      );
                    }

                    if (mmEditingMamsOnly) {
                      return (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Team Lead</label>
                          <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                            {' '}
                          </div>
                          {/* <p className="text-[11px] text-muted-foreground">Team lead is not required for MAM records.</p> */}
                        </div>
                      );
                    }

                    if (mmEditingMleadsOnly || mmEditingRecruitersOnly) {
                      const targetRole = mmEditingMleadsOnly ? 'mlead' : 'recruiter';
                      const options = getTeamLeadOptions(targetRole, updateDraft.teamLead);
                      return (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Team Lead</label>
                          <Select
                            value={updateDraft.teamLead}
                            onValueChange={(value) => setUpdateDraft((prev) => ({ ...prev, teamLead: value }))}
                            disabled={options.length === 0}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={options.length === 0 ? 'No options available' : 'Select team lead'} />
                            </SelectTrigger>
                            <SelectContent>
                              {options.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Team Lead</label>
                        <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                          Mixed-role selection
                        </div>
                      </div>
                    );
                  }

                  if (normalizedRole === 'am') {
                    if (selectedEmails.size === 0) {
                      return (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Team Lead</label>
                          <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                            Select users to update
                          </div>
                        </div>
                      );
                    }

                    const allUsers = selectedUsers.every((user) => (user.role || '').toLowerCase() === 'user');
                    const allLeads = selectedUsers.every((user) => (user.role || '').toLowerCase() === 'lead');

                    if (allUsers) {
                      const options = getTeamLeadOptions('user', updateDraft.teamLead);
                      return (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Team Lead</label>
                          <Select
                            value={updateDraft.teamLead}
                            onValueChange={(value) => setUpdateDraft((prev) => ({ ...prev, teamLead: value }))}
                            disabled={options.length === 0}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={options.length === 0 ? 'No leads available' : 'Select lead'} />
                            </SelectTrigger>
                            <SelectContent>
                              {options.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    }

                    if (allLeads) {
                      return (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Team Lead</label>
                          <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                            {selfDisplayName || 'Auto-managed'}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Team Lead</label>
                        <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                          Mixed-role selection
                        </div>
                      </div>
                    );
                  }

                  if (normalizedRole === 'mam') {
                    if (selectedUsers.length > 0 && selectedUsers.every((user) => (user.role || '').toLowerCase() === 'mlead')) {
                      return (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Team Lead</label>
                          <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                            {selfDisplayName || 'Auto-managed'}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Team Lead</label>
                        <Select
                          value={updateDraft.teamLead}
                          onValueChange={(value) => setUpdateDraft((prev) => ({ ...prev, teamLead: value }))}
                          disabled={selectedEmails.size === 0}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={selectedEmails.size === 0 ? 'Select users to update' : 'Select team lead'} />
                          </SelectTrigger>
                          <SelectContent>
                            {getTeamLeadOptions('recruiter', updateDraft.teamLead).map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Team Lead</label>
                      <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                        {normalizedRole === 'mlead' && selfDisplayName ? selfDisplayName : 'Auto-managed'}
                      </div>
                    </div>
                  );
                })()}
                {['admin', 'manager'].includes(normalizedRole) ? (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Manager</label>
                    <Input
                      placeholder="Leave blank to keep existing"
                      value={updateDraft.manager}
                      list="update-manager-options"
                      onChange={(event) => setUpdateDraft((prev) => ({ ...prev, manager: event.target.value }))}
                    />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Manager</label>
                    <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                      {normalizedRole === 'am' && normalizedManagerName
                        ? normalizedManagerName
                        : normalizedRole === 'mlead' && normalizedManagerName
                          ? normalizedManagerName
                          : normalizedRole === 'mam' && normalizedManagerName
                            ? normalizedManagerName
                            : normalizedRole === 'lead' && normalizedManagerName
                              ? normalizedManagerName
                              : normalizedRole === 'mm' && (selfDisplayName || normalizedManagerName)
                                ? selfDisplayName || normalizedManagerName
                                : 'Auto-managed'}
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Active</label>
                  <Select
                    value={updateDraft.active}
                    onValueChange={(value) => setUpdateDraft((prev) => ({ ...prev, active: value as BulkUpdateDraft['active'] }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unchanged">No change</SelectItem>
                      <SelectItem value="activate">Activate</SelectItem>
                      <SelectItem value="deactivate">Deactivate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Reset Password</label>
                  <Input
                    type="password"
                    placeholder="Leave blank to keep"
                    value={updateDraft.password}
                    onChange={(event) => setUpdateDraft((prev) => ({ ...prev, password: event.target.value }))}
                  />
                </div>
              </div>
              <datalist id="update-teamLead-options">
                {updateTeamLeadOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
              <datalist id="update-manager-options">
                {updateManagerOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={handleBulkUpdate} disabled={selectedEmails.size === 0}>
                  Apply Updates
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setUpdateDraft(INITIAL_UPDATE_DRAFT);
                    setSelectedEmails(new Set());
                  }}
                >
                  Clear Selection
                </Button>
              </div>
              {updateResult && (
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>{`Updated: ${updateResult.updates.length}, Failures: ${updateResult.failures.length}`}</p>
                  {updateResult.failures.length > 0 && (
                    <ul className="list-disc pl-5">
                      {updateResult.failures.map((failure) => (
                        <li key={`${failure.index}-${failure.email || 'unknown'}`}>
                          {`Row ${failure.index + 1}${failure.email ? ` (${failure.email})` : ''}: ${failure.error}`}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Manageable Users</CardTitle>
            <CardDescription>
              {canManage
                ? 'Select users to include in bulk updates. Only roles within your hierarchy appear here.'
                : 'You do not have permissions to manage other users.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingUsers ? (
              <p className="text-sm text-muted-foreground">Loading users…</p>
            ) : usersError ? (
              <p className="text-sm text-destructive">{usersError}</p>
            ) : manageableUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No manageable users found.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          aria-label="Select all"
                          checked={selectedEmails.size > 0 && selectedEmails.size === manageableUsers.length}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedEmails(new Set(manageableUsers.map((user) => user.email)));
                            } else {
                              setSelectedEmails(new Set());
                            }
                          }}
                        />
                      </TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Team Lead</TableHead>
                      <TableHead>Manager</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {manageableUsers.map((user) => (
                      <TableRow key={user.email}>
                        <TableCell>
                          <Checkbox
                            checked={selectedEmails.has(user.email)}
                            onCheckedChange={(checked) => toggleSelectedEmail(user.email, Boolean(checked))}
                            aria-label={`Select ${user.email}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{user.email}</TableCell>
                        <TableCell>{user.role}</TableCell>
                        <TableCell>{user.teamLead || '—'}</TableCell>
                        <TableCell>{user.manager || '—'}</TableCell>
                        <TableCell>
                          {user.active ? (
                            <span className="text-emerald-600">Active</span>
                          ) : (
                            <span className="text-destructive">Inactive</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default UserManagementPage;
