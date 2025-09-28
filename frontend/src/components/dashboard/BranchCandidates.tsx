import { useCallback, useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { io, Socket } from "socket.io-client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth, API_URL } from "@/hooks/useAuth";

interface BranchCandidatesProps {
  role: string;
}

interface CandidateRow {
  id: string;
  name: string;
  branch: string;
  recruiter: string;
  recruiterRaw?: string;
  expert: string;
  expertRaw?: string;
  technology: string;
  email: string;
  contact: string;
  receivedDate?: string | null;
  updatedAt?: string | null;
  lastWriteAt?: string | null;
  workflowStatus?: string;
  resumeUnderstandingStatus?: string;
  resumeUnderstanding?: boolean;
}

interface RecruiterOption {
  value: string;
  label: string;
}

interface BranchCandidatesResponse {
  success: boolean;
  scope?: {
    type: 'branch' | 'hierarchy' | 'expert';
    value: unknown;
  };
  branch?: string;
  recruiters?: string[];
  candidates?: CandidateRow[];
  meta?: {
    count: number;
    branch?: string;
    recruiters?: string[];
    experts?: string[];
    appliedLimit?: number | null;
    hasSearch?: boolean;
  };
  options?: {
    recruiterChoices?: RecruiterOption[];
    expertChoices?: RecruiterOption[];
  };
  error?: string;
}

const MAX_LIMIT = 200;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Convert an email or identifier into a human-friendly display name.
 *
 * Splits the input on '@' (taking the local part) and on common separators ('.', '_', '-', or whitespace),
 * capitalizes each segment, and joins them with spaces.
 *
 * @param value - The email or identifier to format; may be an empty string
 * @returns The formatted display name, or an empty string if `value` is falsy
 */
function formatEmailDisplay(value: string): string {
  if (!value) return '';
  const local = value.includes('@') ? value.split('@')[0] : value;
  return local
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Renders the "Branch Candidates" UI section for managing and viewing candidates within a branch/hierarchy/expert scope.
 *
 * The component displays a searchable table of candidates, a scope badge, and conditional dialogs for creating or editing
 * candidates. UI controls and editable fields are enabled or disabled based on the provided `role`. It also loads and
 * refreshes candidate data from the server (using a socket connection) and updates recruiter/expert option lists returned by the server.
 *
 * @param role - The current user's role; governs visibility, editing permissions, and available actions.
 * @returns The component's rendered UI, or `null` when the `role` does not permit viewing candidates.
 */
export function BranchCandidates({ role }: BranchCandidatesProps) {
  const [scope, setScope] = useState<{ type: 'branch' | 'hierarchy' | 'expert'; value: string | string[] } | null>(null);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const normalizedRole = role.trim().toLowerCase();
  const canView = ["admin", "mm", "mam", "mlead", "lead", "user", "am", "recruiter"].includes(normalizedRole);
  const canEdit = ["mm", "mam", "mlead", "recruiter", "lead", "am","admin"].includes(normalizedRole);
  const canEditBasicFields = ["mm", "mam", "mlead", "recruiter"].includes(normalizedRole);
  const canChangeRecruiterField = ['mm', 'mam', 'mlead',"admin"].includes(normalizedRole);
  const canChangeContactField = ['mm', 'mam','mlead', 'recruiter',"admin"].includes(normalizedRole);
  const canChangeExpertField = ['lead', 'am',"admin"].includes(normalizedRole);
  const isManager = normalizedRole === 'manager';
  const showCreateButton = isManager || normalizedRole === 'mm';
  const [loading, setLoading] = useState<boolean>(canView);
  const [error, setError] = useState<string>(""); 
  const [search, setSearch] = useState<string>("");
  const { refreshAccessToken } = useAuth();
  const { toast } = useToast();
  const [recruiterOptions, setRecruiterOptions] = useState<RecruiterOption[]>([]);
  const [expertOptions, setExpertOptions] = useState<RecruiterOption[]>([]);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editCandidateId, setEditCandidateId] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    name: '',
    email: '',
    technology: '',
    recruiter: '',
    contact: '',
    expert: ''
  });
  const [updateError, setUpdateError] = useState('');
  const [updating, setUpdating] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    technology: '',
    recruiter: '',
    branch: '',
    contact: ''
  });
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const normalizeOptionList = useCallback((options?: RecruiterOption[]) => {
    if (!Array.isArray(options)) {
      return [] as RecruiterOption[];
    }

    const seen = new Set<string>();
    const normalized: RecruiterOption[] = [];

    for (const option of options) {
      if (!option?.value) continue;
      const value = String(option.value).trim().toLowerCase();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      normalized.push({
        value,
        label: option.label?.trim() || formatEmailDisplay(value)
      });
    }

    return normalized.sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  const combinedExpertOptions = useMemo(() => {
    if (!canChangeExpertField) {
      return [] as RecruiterOption[];
    }

    const normalizedOptions: RecruiterOption[] = [];
    const seen = new Set<string>();

    const considerOption = (option?: RecruiterOption) => {
      if (!option?.value) return;
      const normalizedValue = option.value.trim().toLowerCase();
      if (!normalizedValue || seen.has(normalizedValue)) return;
      seen.add(normalizedValue);
      normalizedOptions.push({
        value: normalizedValue,
        label: option.label?.trim() || formatEmailDisplay(normalizedValue)
      });
    };

    expertOptions.forEach((option) => considerOption(option));
    considerOption(formState.expert ? { value: formState.expert, label: formatEmailDisplay(formState.expert) } : undefined);

    return normalizedOptions.sort((a, b) => a.label.localeCompare(b.label));
  }, [canChangeExpertField, expertOptions, formState.expert]);

  const currentExpertLabel = useMemo(() => {
    if (!formState.expert) {
      return '';
    }
    const normalized = formState.expert.trim().toLowerCase();
    const match = combinedExpertOptions.find((option) => option.value === normalized);
    return match?.label || formatEmailDisplay(normalized);
  }, [combinedExpertOptions, formState.expert]);

  const socket: Socket | null = useMemo(() => {
    if (!canView) return null;
    const token = localStorage.getItem("accessToken") || "";
    return io(API_URL, {
      autoConnect: false,
      transports: ["websocket"],
      auth: { token }
    });
  }, [canView]);

  const fetchCandidates = useCallback(() => {
    if (!socket) return;
    setLoading(true);
    setError("");

    socket.emit(
      "getBranchCandidates",
      { limit: MAX_LIMIT },
      (resp: BranchCandidatesResponse) => {
        if (!resp?.success) {
          setCandidates([]);
          setScope(null);
          setError(resp?.error || "Unable to load candidates");
          setLoading(false);
          return;
        }

        setCandidates((resp.candidates || []).map((candidate) => ({
          ...candidate,
          recruiter: candidate.recruiter || '',
          recruiterRaw: candidate.recruiterRaw || '',
          expert: candidate.expert || '',
          expertRaw: candidate.expertRaw || '',
          resumeUnderstanding: Boolean(candidate.resumeUnderstanding),
          resumeUnderstandingStatus: candidate.resumeUnderstandingStatus,
          workflowStatus: candidate.workflowStatus
        })));
        setRecruiterOptions(normalizeOptionList(resp.options?.recruiterChoices));
        setExpertOptions(normalizeOptionList(resp.options?.expertChoices));

        if (resp.scope) {
          if (resp.scope.type === 'branch') {
            const branchValue = String(resp.scope.value ?? resp.branch ?? resp.meta?.branch ?? '');
            setScope({ type: 'branch', value: branchValue });
          } else if (resp.scope.type === 'hierarchy') {
            const hierarchyValue = Array.isArray(resp.scope.value)
              ? resp.scope.value.map((email) => String(email))
              : [];
            setScope({ type: 'hierarchy', value: hierarchyValue });
          } else if (resp.scope.type === 'expert') {
            const expertValue = Array.isArray(resp.scope.value)
              ? resp.scope.value.map((email) => String(email))
              : [];
            setScope({ type: 'expert', value: expertValue });
          } else {
            setScope(null);
          }
        } else if (resp.branch || resp.meta?.branch) {
          setScope({ type: 'branch', value: resp.branch || resp.meta?.branch || '' });
        } else if (resp.recruiters || resp.meta?.recruiters) {
          const recruiters = resp.recruiters || resp.meta?.recruiters || [];
          setScope({ type: 'hierarchy', value: recruiters });
        } else if (resp.meta?.experts) {
          const experts = Array.isArray(resp.meta.experts) ? resp.meta.experts.map((email: unknown) => String(email)) : [];
          setScope({ type: 'expert', value: experts });
        } else {
          setScope(null);
        }
        setLoading(false);
      }
    );
  }, [socket, normalizeOptionList]);

  useEffect(() => {
    if (!socket) {
      setLoading(false);
      return;
    }

    const handleConnect = () => fetchCandidates();

    const handleAuthError = async (err: Error) => {
      if (err.message !== "Unauthorized") return;
      const ok = await refreshAccessToken();
      if (!ok) {
        setError("Session expired. Please sign in again.");
        return;
      }
      socket.auth = { token: localStorage.getItem("accessToken") || "" };
      socket.once("connect", fetchCandidates);
      socket.connect();
    };

    socket.on("connect", handleConnect);
    socket.on("connect_error", handleAuthError);

    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleAuthError);
      socket.disconnect();
    };
  }, [socket, fetchCandidates, refreshAccessToken]);

  const filteredCandidates = useMemo(() => {
    if (!search.trim()) return candidates;
    const query = search.trim().toLowerCase();
    return candidates.filter((candidate) => {
      const haystack = [
        candidate.name,
        candidate.technology,
        candidate.recruiter,
        candidate.expert
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [candidates, search]);

  if (!canView) {
    return null;
  }

  const openEditDialog = (candidate: CandidateRow) => {
    setEditCandidateId(candidate.id);
    setFormState({
      name: candidate.name || '',
      email: candidate.email || '',
      technology: candidate.technology || '',
      recruiter: (candidate.recruiterRaw || '').toLowerCase(),
      contact: candidate.contact || '',
      expert: (candidate.expertRaw || '').toLowerCase()
    });
    const normalizedRecruiter = (candidate.recruiterRaw || '').toLowerCase();
    if (normalizedRecruiter && !recruiterOptions.some((option) => option.value === normalizedRecruiter)) {
      setRecruiterOptions((prev) =>
        [...prev, { value: normalizedRecruiter, label: candidate.recruiter || candidate.recruiterRaw || normalizedRecruiter }]
          .sort((a, b) => a.label.localeCompare(b.label))
      );
    }
    const normalizedExpert = (candidate.expertRaw || '').toLowerCase();
    if (normalizedExpert) {
      setExpertOptions((prev) => {
        if (prev.some((option) => option.value === normalizedExpert)) {
          return prev;
        }
        return [...prev, { value: normalizedExpert, label: candidate.expert || candidate.expertRaw || normalizedExpert }]
          .sort((a, b) => a.label.localeCompare(b.label));
      });
    }
    setUpdateError('');
    setIsEditOpen(true);
  };

  const resetEditState = () => {
    setIsEditOpen(false);
    setEditCandidateId(null);
    setFormState({ name: '', email: '', technology: '', recruiter: '', contact: '', expert: '' });
    setUpdating(false);
    setUpdateError('');
  };

  const resetCreateState = () => {
    setIsCreateOpen(false);
    setCreateForm({ name: '', email: '', technology: '', recruiter: '', branch: '', contact: '' });
    setCreateError('');
    setCreating(false);
  };

  const handleCreateFieldChange = (field: keyof typeof createForm, value: string) => {
    let nextValue = value;
    if (['email', 'recruiter'].includes(field)) {
      nextValue = value.trim().toLowerCase();
    }
    if (field === 'branch') {
      nextValue = value.toUpperCase();
    }
    setCreateForm((prev) => ({ ...prev, [field]: nextValue }));
  };

  const handleCreateCandidate = () => {
    if (!socket) return;

    setCreating(true);
    setCreateError('');

    const trimmedName = createForm.name.trim();
    const trimmedEmail = createForm.email.trim().toLowerCase();
    const trimmedTechnology = createForm.technology.trim();
    const trimmedBranch = createForm.branch.trim().toUpperCase();
    const trimmedRecruiter = createForm.recruiter.trim().toLowerCase();
    const trimmedContact = createForm.contact.trim();

    if (!trimmedName) {
      setCreateError('Name is required');
      setCreating(false);
      return;
    }

    if (!trimmedEmail || !EMAIL_REGEX.test(trimmedEmail)) {
      setCreateError('Please provide a valid candidate email');
      setCreating(false);
      return;
    }

    if (!trimmedTechnology) {
      setCreateError('Technology is required');
      setCreating(false);
      return;
    }

    if (!trimmedBranch) {
      setCreateError('Branch is required');
      setCreating(false);
      return;
    }

    if (!trimmedRecruiter || !EMAIL_REGEX.test(trimmedRecruiter)) {
      setCreateError('Please select a recruiter email');
      setCreating(false);
      return;
    }

    const payload: Record<string, string> = {
      name: trimmedName,
      email: trimmedEmail,
      technology: trimmedTechnology,
      branch: trimmedBranch,
      recruiter: trimmedRecruiter
    };

    if (trimmedContact) {
      payload.contact = trimmedContact;
    }

    socket.emit('createCandidate', payload, (response: any) => {
      if (!response?.success) {
        const details = Array.isArray(response?.details) ? response.details.join(', ') : '';
        setCreateError(response?.error || details || 'Unable to create candidate');
        setCreating(false);
        return;
      }

      toast({
        title: 'Candidate submitted',
        description: 'Candidate sent to admin alerts for expert assignment.'
      });

      resetCreateState();
      fetchCandidates();
    });
  };

  const handleFormChange = (field: keyof typeof formState, value: string) => {
    let nextValue = value;
    if (field === 'recruiter' || field === 'expert' || field === 'email') {
      nextValue = value.trim().toLowerCase();
    }
    setFormState((prev) => ({ ...prev, [field]: nextValue }));
  };

  const handleUpdateCandidate = () => {
    if (!socket || !editCandidateId) return;

    setUpdating(true);
    setUpdateError('');

    const payload: Record<string, string> = {
      candidateId: editCandidateId
    };

    if (canEditBasicFields) {
      const trimmedName = formState.name.trim();
      const trimmedEmail = formState.email.trim().toLowerCase();
      const trimmedTechnology = formState.technology.trim();

      if (!trimmedName) {
        setUpdateError('Name is required');
        setUpdating(false);
        return;
      }

      if (!trimmedEmail || !EMAIL_REGEX.test(trimmedEmail)) {
        setUpdateError('Please provide a valid email address');
        setUpdating(false);
        return;
      }

      if (!trimmedTechnology) {
        setUpdateError('Technology is required');
        setUpdating(false);
        return;
      }

      payload.name = trimmedName;
      payload.email = trimmedEmail;
      payload.technology = trimmedTechnology;
    }

    if (canChangeRecruiterField && formState.recruiter.trim()) {
      payload.recruiter = formState.recruiter.trim().toLowerCase();
    }

    if (canChangeContactField && formState.contact.trim()) {
      payload.contact = formState.contact.trim();
    }

    if (canChangeExpertField) {
      const trimmedExpert = formState.expert.trim().toLowerCase();
      if (['lead', 'am'].includes(normalizedRole) && !trimmedExpert) {
        setUpdateError('Expert email is required');
        setUpdating(false);
        return;
      }

      if (trimmedExpert) {
        if (!EMAIL_REGEX.test(trimmedExpert)) {
          setUpdateError('Please provide a valid expert email');
          setUpdating(false);
          return;
        }
        payload.expert = trimmedExpert;
      }
    }

    if (Object.keys(payload).length === 1) {
      setUpdateError('No changes to save');
      setUpdating(false);
      return;
    }

    socket.emit('updateBranchCandidate', payload, (response: any) => {
      if (!response?.success) {
        setUpdateError(response?.error || 'Unable to update candidate');
        setUpdating(false);
        return;
      }

      setCandidates((prev) =>
        prev.map((candidate) =>
          candidate.id === response.candidate.id ? response.candidate : candidate
        )
      );

      if (response.candidate?.recruiterRaw) {
        setRecruiterOptions((prev) => {
          const normalizedRecruiter = response.candidate.recruiterRaw.trim().toLowerCase();
          if (!normalizedRecruiter) {
            return prev;
          }
          if (prev.some((option) => option.value === normalizedRecruiter)) {
            return prev;
          }
          return [...prev, {
            value: normalizedRecruiter,
            label: response.candidate.recruiter || formatEmailDisplay(normalizedRecruiter)
          }]
            .sort((a, b) => a.label.localeCompare(b.label));
        });
      }

      if (response.candidate?.expertRaw) {
        setExpertOptions((prev) => {
          const normalizedExpert = response.candidate.expertRaw.trim().toLowerCase();
          if (!normalizedExpert) {
            return prev;
          }
          if (prev.some((option) => option.value === normalizedExpert)) {
            return prev;
          }
          return [...prev, {
            value: normalizedExpert,
            label: response.candidate.expert || formatEmailDisplay(normalizedExpert)
          }]
            .sort((a, b) => a.label.localeCompare(b.label));
        });
      }

      toast({ title: 'Candidate updated', description: 'Candidate details have been saved.' });
      resetEditState();
    });
  };

  const renderScopeBadge = () => {
    if (!scope) return null;
    if (scope.type === 'branch') {
      const branchValue = DOMPurify.sanitize(String(scope.value || ''));
      return (
        <Badge variant="secondary" className="w-fit">
          {branchValue ? `${branchValue} Branch` : 'Branch'}
        </Badge>
      );
    }

    if (scope.type === 'hierarchy') {
      const recruiters = Array.isArray(scope.value) ? scope.value : [];
      const label = recruiters.length === 1
        ? `Recruiter: ${DOMPurify.sanitize(recruiters[0] || '')}`
        : `Recruiters: ${recruiters.length}`;
      return (
        <Badge variant="secondary" className="w-fit">
          {label}
        </Badge>
      );
    }

    if (scope.type === 'expert') {
      const experts = Array.isArray(scope.value) ? scope.value : [];
      const formattedExperts = experts.map((email) => {
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const optionLabel = combinedExpertOptions.find((option) => option.value === normalizedEmail)?.label;
        if (optionLabel) {
          return optionLabel;
        }
        return formatEmailDisplay(normalizedEmail);
      });

      const label = formattedExperts.length <= 1
        ? `Assigned: ${DOMPurify.sanitize(formattedExperts[0] || '')}`
        : `Assigned Users: ${formattedExperts.length}`;
      return (
        <Badge variant="secondary" className="w-fit">
          {label}
        </Badge>
      );
    }

    if (scope.type === 'manager') {
      return (
        <Badge variant="secondary" className="w-fit">
          Manager workspace
        </Badge>
      );
    }

    return null;
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Branch Candidates</CardTitle>
            <CardDescription>
              {isManager
                ? 'Create candidates and assign a recruiter. Admins will route them to experts.'
                : scope?.type === 'branch' && scope.value
                  ? `Showing recent candidates for ${scope.value}`
                  : scope?.type === 'hierarchy'
                    ? 'Showing candidates for your team hierarchy'
                    : scope?.type === 'expert'
                      ? 'Showing candidates assigned to you and your direct reports'
                      : 'Latest branch candidates'}
            </CardDescription>
          </div>
          {showCreateButton && (
            <Button
              size="sm"
              onClick={() => {
                setCreateError('');
                setCreateForm((prev) => ({
                  ...prev,
                  branch: prev.branch || (scope?.type === 'branch' && scope.value
                    ? String(scope.value).toUpperCase()
                    : prev.branch)
                }));
                setIsCreateOpen(true);
              }}
            >
              Add Candidate
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={isManager
                ? 'Managers can submit candidates using the button above'
                : 'Search by candidate, technology, recruiter or expert'}
              className="sm:max-w-sm"
              disabled={isManager}
            />
            {renderScopeBadge()}
          </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{DOMPurify.sanitize(error)}</p>
        ) : filteredCandidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isManager
              ? 'No candidates submitted yet. Use “Add Candidate” to create a new record.'
              : 'No candidates found for the selected branch.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Technology</TableHead>
                  <TableHead>Expert</TableHead>
                  <TableHead>Recruiter</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Contact</TableHead>
                  {canEdit && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCandidates.map((candidate) => (
                  <TableRow key={candidate.id}>
                    <TableCell>{DOMPurify.sanitize(candidate.name || "")}</TableCell>
                    <TableCell>{DOMPurify.sanitize(candidate.technology || "")}</TableCell>
                    <TableCell>{DOMPurify.sanitize(candidate.expert || "")}</TableCell>
                    <TableCell>{DOMPurify.sanitize(candidate.recruiter || "")}</TableCell>
                    <TableCell>{DOMPurify.sanitize(candidate.email || "")}</TableCell>
                    <TableCell>{DOMPurify.sanitize(candidate.contact || "")}</TableCell>
                    {canEdit && (
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => openEditDialog(candidate)}>
                          Edit
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {canEdit && (
        <Dialog open={isEditOpen} onOpenChange={(open) => (!open ? resetEditState() : setIsEditOpen(true))}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>Edit Candidate</DialogTitle>
              <DialogDescription>
                {canChangeExpertField && !canEditBasicFields
                  ? 'Select a new expert to reassign this candidate. Other fields remain read-only for leads.'
                  : 'Update candidate details. Fields you cannot change are shown as read-only.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="candidate-name">Name</Label>
                <Input
                  id="candidate-name"
                  value={formState.name}
                  onChange={(event) => handleFormChange('name', event.target.value)}
                  placeholder="Candidate name"
                  disabled={!canEditBasicFields}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="candidate-email">Email</Label>
                <Input
                  id="candidate-email"
                  type="email"
                  value={formState.email}
                  onChange={(event) => handleFormChange('email', event.target.value)}
                  placeholder="candidate@example.com"
                  disabled={!canEditBasicFields}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="candidate-technology">Technology</Label>
                <Input
                  id="candidate-technology"
                  value={formState.technology}
                  onChange={(event) => handleFormChange('technology', event.target.value)}
                  placeholder="Primary technology"
                  disabled={!canEditBasicFields}
                />
              </div>
              {canChangeExpertField ? (
                <div className="space-y-2">
                  <Label htmlFor="candidate-expert">Expert</Label>
                  <Select
                    value={formState.expert || 'none'}
                    onValueChange={(value) => handleFormChange('expert', value === 'none' ? '' : value)}
                    disabled={!combinedExpertOptions.length && !formState.expert}
                  >
                    <SelectTrigger id="candidate-expert">
                      <SelectValue placeholder="Select expert" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select expert</SelectItem>
                      {combinedExpertOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {DOMPurify.sanitize(option.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {normalizedRole === 'lead' && (
                    <p className="text-xs text-muted-foreground">Leads must choose an expert email to save changes.</p>
                  )}
                  {!combinedExpertOptions.length && (
                    <p className="text-xs text-muted-foreground">No expert options were provided for this scope.</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Expert</Label>
                  <Input value={currentExpertLabel || formState.expert || ''} disabled />
                </div>
              )}
              {canChangeRecruiterField ? (
                <div className="space-y-2">
                  <Label htmlFor="candidate-recruiter">Recruiter</Label>
                  <Select
                    value={formState.recruiter || 'none'}
                    onValueChange={(value) => handleFormChange('recruiter', value === 'none' ? '' : value)}
                  >
                    <SelectTrigger id="candidate-recruiter">
                      <SelectValue placeholder="Select recruiter" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No change</SelectItem>
                      {recruiterOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {DOMPurify.sanitize(option.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Recruiter</Label>
                  <Input value={formState.recruiter || ''} disabled />
                </div>
              )}
              {canChangeContactField ? (
                <div className="space-y-2">
                  <Label htmlFor="candidate-contact">Contact</Label>
                  <Input
                    id="candidate-contact"
                    value={formState.contact}
                    onChange={(event) => handleFormChange('contact', event.target.value)}
                    placeholder="Contact number"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Contact</Label>
                  <Input value={formState.contact || ''} disabled />
                </div>
              )}
              {updateError && <p className="text-sm text-destructive">{updateError}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetEditState} disabled={updating}>
                Cancel
              </Button>
              <Button onClick={handleUpdateCandidate} disabled={updating}>
                {updating ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      </Card>
      {showCreateButton && (
        <Dialog open={isCreateOpen} onOpenChange={(open) => (!open ? resetCreateState() : setIsCreateOpen(true))}>
          <DialogContent className="sm:max-w-[460px]">
            <DialogHeader>
              <DialogTitle>Add Candidate</DialogTitle>
              <DialogDescription>
                Submit a new candidate with a recruiter. Admins will assign an expert from the alerts queue.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="create-name">Name</Label>
                <Input
                  id="create-name"
                  value={createForm.name}
                  onChange={(event) => handleCreateFieldChange('name', event.target.value)}
                  placeholder="Candidate name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-email">Email</Label>
                <Input
                  id="create-email"
                  type="email"
                  value={createForm.email}
                  onChange={(event) => handleCreateFieldChange('email', event.target.value)}
                  placeholder="candidate@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-technology">Technology</Label>
                <Input
                  id="create-technology"
                  value={createForm.technology}
                  onChange={(event) => handleCreateFieldChange('technology', event.target.value)}
                  placeholder="Primary technology"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-branch">Branch</Label>
                <Input
                  id="create-branch"
                  value={createForm.branch}
                  onChange={(event) => handleCreateFieldChange('branch', event.target.value)}
                  placeholder="e.g., GGR"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-recruiter">Recruiter</Label>
                <Select
                  value={createForm.recruiter || 'none'}
                  onValueChange={(value) => handleCreateFieldChange('recruiter', value === 'none' ? '' : value)}
                  disabled={recruiterOptions.length === 0}
                >
                  <SelectTrigger id="create-recruiter">
                    <SelectValue placeholder={recruiterOptions.length ? 'Select recruiter' : 'No recruiters available'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select recruiter</SelectItem>
                    {recruiterOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {DOMPurify.sanitize(option.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {recruiterOptions.length === 0 && (
                  <p className="text-xs text-muted-foreground">No recruiter options available for your scope.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-contact">Contact (optional)</Label>
                <Input
                  id="create-contact"
                  value={createForm.contact}
                  onChange={(event) => handleCreateFieldChange('contact', event.target.value)}
                  placeholder="Contact number"
                />
              </div>
              {createError && <p className="text-sm text-destructive">{createError}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetCreateState} disabled={creating}>
                Cancel
              </Button>
              <Button onClick={handleCreateCandidate} disabled={creating || recruiterOptions.length === 0}>
                {creating ? 'Submitting…' : 'Submit Candidate'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
