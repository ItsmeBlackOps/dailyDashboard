import { useCallback, useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { io, Socket } from "socket.io-client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth, API_URL } from "@/hooks/useAuth";

interface AdminAwaitingExpertProps {
  role: string;
}

interface CandidateRecord {
  id: string;
  name: string;
  technology: string;
  recruiter: string;
  recruiterRaw?: string;
  branch: string;
  email: string;
  contact: string;
  expert: string;
  expertRaw?: string;
  workflowStatus?: string;
  resumeUnderstandingStatus?: string;
  resumeUnderstanding?: boolean;
  createdBy?: string | null;
}

interface PendingResponse {
  success: boolean;
  candidates?: CandidateRecord[];
  options?: {
    expertChoices?: ExpertOption[];
  };
  error?: string;
}

interface AssignResponse {
  success: boolean;
  candidate?: CandidateRecord;
  error?: string;
  details?: string[];
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ExpertOption {
  value: string;
  label: string;
}

function formatEmailDisplay(value: string): string {
  if (!value) return '';
  const local = value.includes('@') ? value.split('@')[0] : value;
  return local
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ');
}

export function AdminAwaitingExpert({ role }: AdminAwaitingExpertProps) {
  const normalizedRole = role.trim().toLowerCase();
  const isAdmin = normalizedRole === "admin";
  const { toast } = useToast();
  const { refreshAccessToken } = useAuth();

  const socket: Socket | null = useMemo(() => {
    if (!isAdmin) {
      return null;
    }
    const token = localStorage.getItem("accessToken") || "";
    return io(API_URL, {
      autoConnect: false,
      transports: ["websocket"],
      auth: { token }
    });
  }, [isAdmin]);

  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [expertInputs, setExpertInputs] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<boolean>(isAdmin);
  const [error, setError] = useState<string>("");
  const [expertOptions, setExpertOptions] = useState<ExpertOption[]>([]);

  const normalizeOptionList = useCallback((options?: ExpertOption[]) => {
    if (!Array.isArray(options)) {
      return [] as ExpertOption[];
    }

    const seen = new Set<string>();
    const normalized: ExpertOption[] = [];

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

  const expertRosterSet = useMemo(() => {
    return new Set(expertOptions.map((option) => option.value));
  }, [expertOptions]);

  const buildOptionsForCandidate = useCallback(
    (candidate: CandidateRecord) => {
      const normalized = (candidate.expertRaw || '').trim().toLowerCase();
      if (!normalized || expertRosterSet.has(normalized)) {
        return expertOptions;
      }

      const augmented = [...expertOptions, { value: normalized, label: formatEmailDisplay(normalized) }];
      return augmented.sort((a, b) => a.label.localeCompare(b.label));
    },
    [expertOptions, expertRosterSet]
  );

  const refreshExpertInputs = useCallback((rows: CandidateRecord[]) => {
    const next: Record<string, string> = {};
    rows.forEach((candidate) => {
      next[candidate.id] = (candidate.expertRaw || '').trim().toLowerCase();
    });
    setExpertInputs(next);
  }, []);

  const ensureExpertOption = useCallback((value?: string) => {
    const normalized = (value || '').trim().toLowerCase();
    if (!normalized) {
      return;
    }
    setExpertOptions((prev) => {
      if (prev.some((option) => option.value === normalized)) {
        return prev;
      }
      return [...prev, { value: normalized, label: formatEmailDisplay(normalized) }].sort((a, b) => a.label.localeCompare(b.label));
    });
  }, []);

  const applyCandidateUpdate = useCallback((candidate: CandidateRecord | undefined) => {
    if (!candidate?.id) {
      return;
    }

    ensureExpertOption(candidate.expertRaw);

    setCandidates((prev) => {
      const index = prev.findIndex((row) => row.id === candidate.id);

      if (candidate.resumeUnderstanding) {
        if (index === -1) {
          return prev;
        }
        const next = [...prev];
        next.splice(index, 1);
        return next;
      }

      if (index === -1) {
        return [...prev, candidate];
      }

      const next = [...prev];
      next[index] = candidate;
      return next;
    });

    setExpertInputs((prev) => {
      if (candidate.resumeUnderstanding) {
        if (!prev[candidate.id]) {
          return prev;
        }
        const next = { ...prev };
        delete next[candidate.id];
        return next;
      }

      const next = { ...prev };
      next[candidate.id] = (candidate.expertRaw || '').trim().toLowerCase();
      return next;
    });

    setRowErrors((prev) => {
      if (!prev[candidate.id]) {
        return prev;
      }
      const next = { ...prev };
      delete next[candidate.id];
      return next;
    });
  }, [ensureExpertOption]);

  const fetchPending = useCallback(() => {
    if (!socket) return;
    setLoading(true);
    setError("");

    socket.emit('getPendingExpertAssignments', (response: PendingResponse) => {
      if (!response?.success) {
        setError(response?.error || 'Unable to load pending candidates.');
        setCandidates([]);
        setLoading(false);
        return;
      }

      const rows = Array.isArray(response.candidates) ? response.candidates : [];
      setCandidates(rows);
      refreshExpertInputs(rows);
      setExpertOptions(normalizeOptionList(response.options?.expertChoices));
      rows.forEach((candidate) => ensureExpertOption(candidate.expertRaw));
      setLoading(false);
    });
  }, [socket, refreshExpertInputs, normalizeOptionList, ensureExpertOption]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleConnect = () => fetchPending();

    const handleAuthError = async (err: Error) => {
      if (err.message !== 'Unauthorized') return;
      const ok = await refreshAccessToken();
      if (!ok) {
        setError('Session expired. Please sign in again.');
        return;
      }
      socket.auth = { token: localStorage.getItem('accessToken') || '' };
      socket.once('connect', fetchPending);
      socket.connect();
    };

    const handleAssignmentUpdate = (payload: { candidate?: CandidateRecord }) => {
      const candidate = payload?.candidate;
      if (!candidate?.id) {
        return;
      }
      applyCandidateUpdate(candidate);
    };

    const handleResumeUnderstandingUpdate = (payload: { candidate?: CandidateRecord }) => {
      const candidate = payload?.candidate;
      if (!candidate?.id) {
        return;
      }
      applyCandidateUpdate(candidate);
    };

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleAuthError);
    socket.on('candidateExpertAssigned', handleAssignmentUpdate);
    socket.on('resumeUnderstandingUpdated', handleResumeUnderstandingUpdate);

    socket.connect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleAuthError);
      socket.off('candidateExpertAssigned', handleAssignmentUpdate);
      socket.off('resumeUnderstandingUpdated', handleResumeUnderstandingUpdate);
      socket.disconnect();
    };
  }, [socket, fetchPending, refreshAccessToken, applyCandidateUpdate]);

  const handleExpertChange = (candidateId: string, value: string) => {
    const normalized = value.trim().toLowerCase();
    setExpertInputs((prev) => ({ ...prev, [candidateId]: normalized }));
    setRowErrors((prev) => ({ ...prev, [candidateId]: '' }));
  };

  const handleAssign = (candidateId: string) => {
    if (!socket) return;

    const candidate = candidates.find((item) => item.id === candidateId);
    const rawValue = expertInputs[candidateId] || '';
    const trimmedValue = rawValue.trim().toLowerCase();

    if (!trimmedValue || !EMAIL_REGEX.test(trimmedValue)) {
      setRowErrors((prev) => ({ ...prev, [candidateId]: 'Enter a valid expert email' }));
      return;
    }

    const allowedValues = new Set(expertOptions.map((option) => option.value));
    const candidateExpert = (candidate?.expertRaw || '').trim().toLowerCase();
    if (candidateExpert) {
      allowedValues.add(candidateExpert);
    }

    if (!allowedValues.has(trimmedValue)) {
      setRowErrors((prev) => ({ ...prev, [candidateId]: 'Select an expert from the provided list' }));
      return;
    }

    setAssigning((prev) => ({ ...prev, [candidateId]: true }));
    setRowErrors((prev) => ({ ...prev, [candidateId]: '' }));

    socket.emit('assignCandidateExpert', { candidateId, expert: trimmedValue }, (response: AssignResponse) => {
      setAssigning((prev) => ({ ...prev, [candidateId]: false }));

      if (!response?.success) {
        const details = Array.isArray(response?.details) ? response.details.join(', ') : '';
        setRowErrors((prev) => ({
          ...prev,
          [candidateId]: response?.error || details || 'Unable to assign expert'
        }));
        return;
      }

      applyCandidateUpdate(response.candidate as CandidateRecord);

      toast({
        title: 'Expert assigned',
        description: 'Candidate moved to the resume understanding queue.'
      });
    });
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin Alerts</CardTitle>
        <CardDescription>
          Assign experts to newly submitted candidates. Managers provide the recruiter; you complete the pairing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {loading ? 'Loading pending candidates…' : `${candidates.length} candidate${candidates.length === 1 ? '' : 's'} awaiting expert`}
          </span>
          <Button variant="outline" size="sm" onClick={fetchPending} disabled={loading}>
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{DOMPurify.sanitize(error)}</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No candidates are awaiting expert assignment.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Technology</TableHead>
                  <TableHead>Recruiter</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead className="min-w-[220px]">Expert Email</TableHead>
                  <TableHead>Resume Understanding</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((candidate) => {
                  const assigningRow = assigning[candidate.id];
                  const rowError = rowErrors[candidate.id];
                  const expertValue = expertInputs[candidate.id] || '';
                  const rowOptions = buildOptionsForCandidate(candidate);

                  return (
                    <TableRow key={candidate.id}>
                      <TableCell>{DOMPurify.sanitize(candidate.name || '')}</TableCell>
                      <TableCell>{DOMPurify.sanitize(candidate.technology || '')}</TableCell>
                      <TableCell>{DOMPurify.sanitize(candidate.recruiter || '')}</TableCell>
                      <TableCell>{DOMPurify.sanitize(candidate.branch || '')}</TableCell>
                      <TableCell>{DOMPurify.sanitize(candidate.createdBy || '')}</TableCell>
                      <TableCell>
                        <div className="space-y-2">
                          <Select
                            value={expertValue || 'none'}
                            onValueChange={(value) => handleExpertChange(candidate.id, value === 'none' ? '' : value)}
                            disabled={rowOptions.length === 0}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select expert" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Select expert</SelectItem>
                              {rowOptions.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {DOMPurify.sanitize(option.label)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {rowOptions.length === 0 && (
                            <p className="text-xs text-muted-foreground">No roster data found. Refresh to retry.</p>
                          )}
                          {rowError && (
                            <p className="text-xs text-destructive">{rowError}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={candidate.resumeUnderstanding ? 'secondary' : 'outline'}>
                          {candidate.resumeUnderstanding ? 'Completed' : 'Pending'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          onClick={() => handleAssign(candidate.id)}
                          disabled={assigningRow || candidate.resumeUnderstanding}
                        >
                          {assigningRow ? 'Assigning…' : 'Assign Expert'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
