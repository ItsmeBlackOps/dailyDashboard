import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import moment from "moment-timezone";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useAuth, API_URL } from "@/hooks/useAuth";
import { EmailSignature } from "@/components/layout/emailSignature";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon } from "lucide-react";
import { useMsal } from "@azure/msal-react";
import { GRAPH_MAIL_SCOPES } from "@/constants";

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

interface SupportFormState {
  candidateName: string;
  technology: string;
  email: string;
  endClient: string;
  jobTitle: string;
  interviewRound: string;
  interviewDateTime: string;
  duration: string;
  contactNumber: string;
}

const SUPPORT_ROUNDS = [
  "1st Round",
  "2nd Round",
  "3rd Round",
  "4th Round",
  "5th Round",
  "Technical Round",
  "Coding Round",
  "Loop Round",
  "Final Round"
] as const;

const EST_TIMEZONE = "America/New_York";
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB default limit mirrored with backend

const DISPLAY_TIME_OPTIONS = Array.from({ length: 288 }, (_, index) => {
  const minutes = index * 5;
  const hours = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const value = `${String(hours).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const label = moment(value, 'HH:mm').format('hh:mm A');
  return { value, label };
});

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
    hasSearch?: boolean;
  };
  options?: {
    recruiterChoices?: RecruiterOption[];
    expertChoices?: RecruiterOption[];
  };
  error?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatEmailDisplay(value: string): string {
  if (!value) return '';
  const local = value.includes('@') ? value.split('@')[0] : value;
  return local
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ');
}

export function BranchCandidates({ role }: BranchCandidatesProps) {
  const [scope, setScope] = useState<{ type: 'branch' | 'hierarchy' | 'expert'; value: string | string[] } | null>(null);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const normalizedRole = role.trim().toLowerCase();
  const canView = ["admin", "mm", "mam", "mlead", "lead", "user", "am", "manager", "recruiter"].includes(normalizedRole);
  const canEdit = ["mm", "mam", "mlead", "recruiter", "lead", "am", "admin"].includes(normalizedRole);
  const canEditBasicFields = ["mm", "mam", "mlead", "recruiter", "admin"].includes(normalizedRole);
  const canChangeRecruiterField = ['mm', 'mam', 'mlead', "admin"].includes(normalizedRole);
  const canChangeContactField = ['mm', 'mam', 'mlead', 'recruiter', "admin"].includes(normalizedRole);
  const canChangeExpertField = ['lead', 'am', "admin"].includes(normalizedRole);
  const isManager = normalizedRole === 'manager';
  const showCreateButton = isManager || normalizedRole === 'mm';
  const [loading, setLoading] = useState<boolean>(canView);
  const [error, setError] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const { refreshAccessToken, authFetch } = useAuth();
  const { toast } = useToast();
  const { profile } = useUserProfile();
  const { instance, accounts } = useMsal();
  const account = accounts[0];
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
  const canSendSupport = ['recruiter', 'mlead', 'mam', 'mm'].includes(normalizedRole);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportCandidate, setSupportCandidate] = useState<CandidateRow | null>(null);
  const [supportForm, setSupportForm] = useState<SupportFormState>({
    candidateName: '',
    technology: '',
    email: '',
    endClient: '',
    jobTitle: '',
    interviewRound: SUPPORT_ROUNDS[0],
    interviewDateTime: '',
    duration: '',
    contactNumber: '',
  });
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [additionalFiles, setAdditionalFiles] = useState<File[]>([]);
  const [supportError, setSupportError] = useState('');
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportInterviewDate, setSupportInterviewDate] = useState<Date | null>(null);
  const [supportInterviewTime, setSupportInterviewTime] = useState<string>('');
  const [supportDatePickerOpen, setSupportDatePickerOpen] = useState(false);
  const [supportTimeInput, setSupportTimeInput] = useState<string>('');
  const [supportTimeWarning, setSupportTimeWarning] = useState<string>('');
  const [customMessageEnabled, setCustomMessageEnabled] = useState(false);
  const [customMessage, setCustomMessage] = useState('');
  const supportWindowWarningKey = useRef<string>('');
  const [durationWarning, setDurationWarning] = useState('');

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

  const titleCasePreserveSpacing = useCallback((value: string) => {
    let result = '';
    let capitalizeNext = true;

    for (const char of value) {
      if (/\s/.test(char)) {
        result += char;
        capitalizeNext = true;
        continue;
      }

      if (!/\p{L}/u.test(char)) {
        result += char;
        capitalizeNext = true;
        continue;
      }

      result += capitalizeNext ? char.toLocaleUpperCase() : char.toLocaleLowerCase();
      capitalizeNext = false;
    }

    return result;
  }, []);

  const normalizeTitleValue = useCallback((value: string) => {
    const cased = titleCasePreserveSpacing(value);
    return cased.replace(/\s+/g, ' ').trim();
  }, [titleCasePreserveSpacing]);

  const resetSupportState = useCallback(() => {
    setSupportOpen(false);
    setSupportCandidate(null);
    setSupportForm({
      candidateName: '',
      technology: '',
      email: '',
      endClient: '',
      jobTitle: '',
      interviewRound: SUPPORT_ROUNDS[0],
      interviewDateTime: '',
      duration: '',
      contactNumber: '',
    });
    setResumeFile(null);
    setJdFile(null);
    setAdditionalFiles([]);
    setSupportError('');
    setSupportSubmitting(false);
    setSupportInterviewDate(null);
    setSupportInterviewTime('');
    setSupportDatePickerOpen(false);
    setSupportTimeInput('');
    setSupportTimeWarning('');
    setCustomMessage('');
    setCustomMessageEnabled(false);
    supportWindowWarningKey.current = '';
    setDurationWarning('');
  }, []);

  const openSupportDialog = useCallback((candidate: CandidateRow) => {
    const formattedName = normalizeTitleValue(candidate.name || '');
    const formattedTechnology = candidate.technology ? normalizeTitleValue(candidate.technology) : '';
    setSupportCandidate(candidate);
    setSupportForm({
      candidateName: formattedName,
      technology: formattedTechnology,
      email: (candidate.email || '').toLowerCase(),
      endClient: '',
      jobTitle: '',
      interviewRound: SUPPORT_ROUNDS[0],
      interviewDateTime: '',
      duration: '',
      contactNumber: (candidate.contact || '').trim(),
    });
    setResumeFile(null);
    setJdFile(null);
    setAdditionalFiles([]);
    setSupportError('');
    setSupportSubmitting(false);
    setSupportInterviewDate(null);
    setSupportInterviewTime('');
    setSupportDatePickerOpen(false);
    setSupportTimeInput('');
    setSupportTimeWarning('');
    setCustomMessage('');
    setCustomMessageEnabled(false);
    supportWindowWarningKey.current = '';
    setDurationWarning('');
    setSupportOpen(true);
  }, [normalizeTitleValue]);

  const handleSupportFieldChange = useCallback((field: keyof SupportFormState, value: string) => {
    if (field === 'contactNumber' || field === 'interviewDateTime') {
      return;
    }
    setSupportError('');
    setSupportForm((prev) => {
      if (field === 'duration') {
        const digitsOnly = value.replace(/[^0-9]/g, '').slice(0, 3);
        const minutes = Number.parseInt(digitsOnly, 10);

        if (!digitsOnly) {
          setDurationWarning('');
        } else if (!Number.isFinite(minutes) || minutes <= 0) {
          setDurationWarning('Duration must be a positive number of minutes.');
        } else if (minutes % 5 !== 0) {
          setDurationWarning('Duration must be in 5-minute increments.');
        } else {
          setDurationWarning('');
        }

        return { ...prev, duration: digitsOnly };
      }

      let nextValue = value;
      if (field === 'endClient' || field === 'jobTitle') {
        nextValue = titleCasePreserveSpacing(value);
      }
      if (field === 'email') {
        nextValue = value.trim().toLowerCase();
      }
      return { ...prev, [field]: nextValue };
    });
  }, [titleCasePreserveSpacing]);

  const computeInterviewDateTimeValue = useCallback((date: Date | null, time: string): string => {
    if (!date || !time) {
      return '';
    }
    const [hours, minutes] = time.split(':').map((segment) => Number.parseInt(segment, 10));
    const zoned = moment(date).tz(EST_TIMEZONE).set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
    return zoned.format('YYYY-MM-DDTHH:mm');
  }, []);

  const warnIfOutOfHours = useCallback((date: Date | null, time: string) => {
    if (!date || !time) {
      supportWindowWarningKey.current = '';
      return;
    }

    const [hours, minutes] = time.split(':').map((segment) => Number.parseInt(segment, 10));
    const zoned = moment(date).tz(EST_TIMEZONE).set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
    if (!zoned.isValid()) {
      supportWindowWarningKey.current = '';
      return;
    }

    const hour = zoned.hour();
    const minute = zoned.minute();
    const warningKey = zoned.toISOString();
    const outsideWindow = hour < 9 || hour > 18 || (hour === 18 && minute > 0);

    if (outsideWindow && supportWindowWarningKey.current !== warningKey) {
      toast({
        title: 'Outside support hours',
        description: 'Interview falls outside the standard 9:00 AM – 6:00 PM EST window.',
        variant: 'destructive'
      });
      supportWindowWarningKey.current = warningKey;
    }

    if (!outsideWindow) {
      supportWindowWarningKey.current = '';
    }
  }, [toast]);

  const handleSupportDateSelect = useCallback((date: Date | undefined) => {
    if (!date) return;
    setSupportInterviewDate(date);
    setSupportError('');
    setSupportDatePickerOpen(false);
    setSupportForm((prev) => ({
      ...prev,
      interviewDateTime: computeInterviewDateTimeValue(date, supportInterviewTime)
    }));
    warnIfOutOfHours(date, supportInterviewTime);
  }, [computeInterviewDateTimeValue, supportInterviewTime, warnIfOutOfHours]);

  const validateTimeInput = useCallback((value: string): string => {
    const trimmed = value.trim().toUpperCase();
    const match = /^([0-1]?\d|2[0-3]):([0-5]\d)(\s*(AM|PM))?$/u.exec(trimmed);
    if (!match) return '';

    let hours = Number.parseInt(match[1], 10);
    const minuteRaw = Number.parseInt(match[2], 10);
    const meridiem = match[4];

    if (meridiem) {
      hours %= 12;
      if (meridiem === 'PM') {
        hours += 12;
      }
    }

    const alignedMinutes = Math.round(minuteRaw / 5) * 5;
    const normalizedMinute = alignedMinutes === 60 ? 55 : alignedMinutes;
    const normalizedHour = alignedMinutes === 60 ? (hours + 1) % 24 : hours;

    return `${String(normalizedHour).padStart(2, '0')}:${String(normalizedMinute).padStart(2, '0')}`;
  }, []);

  const handleSupportTimeChange = useCallback((value: string) => {
    setSupportTimeInput(value);
    const normalized = validateTimeInput(value);
    if (!normalized) {
      setSupportTimeWarning('Enter a valid time in 5-minute increments (e.g., 03:15 PM).');
      setSupportInterviewTime('');
      setSupportForm((prev) => ({ ...prev, interviewDateTime: '' }));
      return;
    }

    setSupportTimeWarning('');
    setSupportInterviewTime(normalized);
    setSupportForm((prev) => ({
      ...prev,
      interviewDateTime: computeInterviewDateTimeValue(supportInterviewDate, normalized)
    }));
    warnIfOutOfHours(supportInterviewDate, normalized);
  }, [computeInterviewDateTimeValue, supportInterviewDate, validateTimeInput, warnIfOutOfHours]);

  const handleSupportFileChange = useCallback((field: 'resume' | 'jobDescription' | 'additionalAttachments', files: FileList | null) => {
    if (!files || files.length === 0) {
      if (field === 'resume') setResumeFile(null);
      if (field === 'jobDescription') setJdFile(null);
      if (field === 'additionalAttachments') setAdditionalFiles([]);
      return;
    }

    const validateFile = (file: File) => {
      if (file.type !== 'application/pdf') {
        throw new Error('Only PDF files are allowed.');
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        const sizeMb = (MAX_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(1);
        throw new Error(`Attachments must be under ${sizeMb} MB.`);
      }
      return file;
    };

    try {
      if (field === 'additionalAttachments') {
        const validated = Array.from(files).map((file) => validateFile(file));
        setAdditionalFiles(validated);
      } else {
        const file = validateFile(files[0]);
        if (field === 'resume') {
          setResumeFile(file);
        } else {
          setJdFile(file);
        }
      }
      setSupportError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid attachment';
      setSupportError(message);
      if (field === 'additionalAttachments') {
        setAdditionalFiles([]);
      } else if (field === 'resume') {
        setResumeFile(null);
      } else {
        setJdFile(null);
      }
    }
  }, []);

  const handleSupportSubmit = useCallback(async () => {
    if (!supportCandidate) {
      setSupportError('No candidate selected.');
      return;
    }

    if (!supportForm.endClient.trim()) {
      setSupportError('End client is required.');
      return;
    }

    if (!supportForm.jobTitle.trim()) {
      setSupportError('Job title is required.');
      return;
    }

    if (supportTimeWarning) {
      setSupportError('Fix the interview time before submitting.');
      return;
    }

    if (!supportInterviewDate || !supportInterviewTime || !supportForm.interviewDateTime.trim()) {
      setSupportError('Interview date and time is required.');
      return;
    }

    if (durationWarning) {
      setSupportError(durationWarning);
      return;
    }

    const durationMinutes = Number.parseInt(supportForm.duration.trim(), 10);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setSupportError('Duration must be a positive number of minutes.');
      return;
    }

    if (durationMinutes % 5 !== 0) {
      setSupportError('Duration must be in 5-minute increments.');
      return;
    }

    if (!supportForm.contactNumber.trim()) {
      setSupportError('Contact number is required.');
      return;
    }

    const interviewMoment = moment.tz(supportForm.interviewDateTime, 'YYYY-MM-DDTHH:mm', EST_TIMEZONE);
    if (!interviewMoment.isValid()) {
      setSupportError('Provide a valid interview date and time in EST.');
      return;
    }

    const now = moment().tz(EST_TIMEZONE);
    if (interviewMoment.isBefore(now)) {
      setSupportError('Interview date and time must be in the future.');
      return;
    }

    let activeAccount = account;
    let graphToken = '';
    try {
      if (!activeAccount) {
        const loginResult = await instance.loginPopup({ scopes: GRAPH_MAIL_SCOPES });
        activeAccount = loginResult.account ?? loginResult.accounts?.[0] ?? null;
        graphToken = loginResult.accessToken || '';
        if (activeAccount) {
          instance.setActiveAccount(activeAccount);
        }
      }

      if (activeAccount && !graphToken) {
        try {
          const tokenResponse = await instance.acquireTokenSilent({
            account: activeAccount,
            scopes: GRAPH_MAIL_SCOPES
          });
          graphToken = tokenResponse.accessToken;
        } catch (tokenError) {
          console.warn('Silent Graph token acquisition failed, attempting popup', tokenError);
          const popupResponse = await instance.acquireTokenPopup({
            scopes: GRAPH_MAIL_SCOPES
          });
          graphToken = popupResponse.accessToken;
        }
      }

      if (!graphToken) {
        throw new Error('Unable to acquire Graph access token');
      }
    } catch (tokenError) {
      console.error('Failed to acquire Graph token', tokenError);
      setSupportError('Authorize Microsoft access and try again.');
      return;
    }

    try {
      setSupportSubmitting(true);
      setSupportError('');

      const formData = new FormData();
      const normalizedEndClient = normalizeTitleValue(supportForm.endClient);
      const normalizedJobTitle = normalizeTitleValue(supportForm.jobTitle);

      formData.append('candidateId', supportCandidate.id);
      formData.append('endClient', normalizedEndClient);
      formData.append('jobTitle', normalizedJobTitle);
      formData.append('interviewRound', supportForm.interviewRound);
      formData.append('interviewDateTime', interviewMoment.toISOString());
      formData.append('duration', String(durationMinutes));
      formData.append('contactNumber', supportForm.contactNumber.trim());
      if (customMessageEnabled && customMessage.trim()) {
        formData.append('customMessage', customMessage.trim());
      }

      if (resumeFile) {
        formData.append('resume', resumeFile);
      }
      if (jdFile) {
        formData.append('jobDescription', jdFile);
      }
      additionalFiles.forEach((file) => {
        formData.append('additionalAttachments', file);
      });

      const response = await authFetch(`${API_URL}/api/support/interview`, {
        method: 'POST',
        headers: {
          'x-graph-access-token': graphToken
        },
        body: formData,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : 'Unable to send support request';
        setSupportError(message);
        return;
      }

      toast({
        title: 'Support request sent',
        description: typeof payload?.message === 'string'
          ? payload.message
          : 'Interview support request emailed successfully.',
      });

      resetSupportState();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send support request';
      setSupportError(message);
    } finally {
      setSupportSubmitting(false);
    }
  }, [
    supportCandidate,
    supportForm,
    resumeFile,
    jdFile,
    additionalFiles,
    authFetch,
    toast,
    normalizeTitleValue,
    resetSupportState,
    instance,
    supportInterviewDate,
    supportInterviewTime,
    customMessageEnabled,
    customMessage,
    supportTimeWarning,
    durationWarning
  ]);

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
      {},
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
                    {(canEdit || canSendSupport) && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCandidates.map((candidate) => {
                    const sanitizedName = DOMPurify.sanitize(candidate.name || '');
                    const sanitizedTechnology = DOMPurify.sanitize(candidate.technology || '');
                    const sanitizedExpert = DOMPurify.sanitize(candidate.expert || '');
                    const sanitizedRecruiter = DOMPurify.sanitize(candidate.recruiter || '');
                    const sanitizedEmail = DOMPurify.sanitize(candidate.email || '');
                    const sanitizedContact = DOMPurify.sanitize(candidate.contact || '');

                    return (
                      <TableRow key={candidate.id}>
                        <TableCell className="align-top">
                          <div className="flex flex-col gap-2">
                            <span>{sanitizedName}</span>
                            {canSendSupport && (
                              <Button
                                size="xs"
                                variant="secondary"
                                className="md:hidden w-fit"
                                onClick={() => openSupportDialog(candidate)}
                              >
                                Support
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{sanitizedTechnology}</TableCell>
                        <TableCell>{sanitizedExpert}</TableCell>
                        <TableCell>{sanitizedRecruiter}</TableCell>
                        <TableCell>{sanitizedEmail}</TableCell>
                        <TableCell>{sanitizedContact}</TableCell>
                        {(canEdit || canSendSupport) && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              {canSendSupport && (
                                <Button size="sm" variant="secondary" onClick={() => openSupportDialog(candidate)}>
                                  Support
                                </Button>
                              )}
                              {canEdit && (
                                <Button size="sm" variant="outline" onClick={() => openEditDialog(candidate)}>
                                  Edit
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
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
      {canSendSupport && (
        <Dialog open={supportOpen} onOpenChange={(open) => (!open ? resetSupportState() : setSupportOpen(true))}>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Request Interview Support</DialogTitle>
              <DialogDescription>
                Provide interview details to notify tech leadership with the required context and attachments.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="support-candidate-name">Candidate Name</Label>
                  <Input
                    id="support-candidate-name"
                    value={supportForm.candidateName}
                    disabled
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="support-technology">Technology</Label>
                  <Input
                    id="support-technology"
                    value={supportForm.technology}
                    disabled
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="support-email">Email ID</Label>
                  <Input
                    id="support-email"
                    type="email"
                    value={supportForm.email}
                    disabled
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="support-contact">Contact Number</Label>
                  <Input
                    id="support-contact"
                    value={supportForm.contactNumber}
                    placeholder="e.g., +1 555 123 4567"
                    readOnly
                    className="bg-muted"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="support-client">End Client</Label>
                  <Input
                    id="support-client"
                    value={supportForm.endClient}
                    onChange={(event) => handleSupportFieldChange('endClient', event.target.value)}
                    placeholder="Client name"
                    disabled={supportSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="support-job-title">Job Title</Label>
                  <Input
                    id="support-job-title"
                    value={supportForm.jobTitle}
                    onChange={(event) => handleSupportFieldChange('jobTitle', event.target.value)}
                    placeholder="Role title"
                    disabled={supportSubmitting}
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="support-round">Interview Round</Label>
                  <Select
                    value={supportForm.interviewRound}
                    onValueChange={(value) => handleSupportFieldChange('interviewRound', value)}
                    disabled={supportSubmitting}
                  >
                    <SelectTrigger id="support-round">
                      <SelectValue placeholder="Select round" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORT_ROUNDS.map((round) => (
                        <SelectItem key={round} value={round}>
                          {round}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="support-duration">Duration (minutes)</Label>
                  <Input
                    id="support-duration"
                    value={supportForm.duration}
                    onChange={(event) => handleSupportFieldChange('duration', event.target.value)}
                    placeholder="e.g., 60"
                    type="number"
                    min={1}
                    max={480}
                    inputMode="numeric"
                    disabled={supportSubmitting}
                  />
                  {durationWarning && (
                    <p className="text-xs text-destructive">{durationWarning}</p>
                  )}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Date (EST)</Label>
                  <Popover open={supportDatePickerOpen} onOpenChange={setSupportDatePickerOpen}>
                    <PopoverTrigger asChild>
                      <div className="relative">
                        <Input
                          readOnly
                          value={supportInterviewDate ? moment(supportInterviewDate).tz(EST_TIMEZONE).format('MMM D, YYYY') : ''}
                          placeholder="Select date"
                          disabled={supportSubmitting}
                          className={cn(!supportInterviewDate && "text-muted-foreground", 'pr-10 cursor-pointer')}
                        />
                        <CalendarIcon className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={supportInterviewDate ?? undefined}
                        onSelect={handleSupportDateSelect}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Time (EST)</Label>
                  <div className="space-y-1">
                    <Input
                      value={supportTimeInput}
                      onChange={(event) => handleSupportTimeChange(event.target.value)}
                      placeholder="e.g., 03:15 PM"
                      disabled={supportSubmitting}
                    />
                    <Select
                      value={supportInterviewTime}
                      onValueChange={(value) => handleSupportTimeChange(moment(value, 'HH:mm').format('hh:mm A'))}
                      disabled={supportSubmitting}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pick from list" />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {DISPLAY_TIME_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {supportTimeWarning && (
                      <p className="text-xs text-destructive">{supportTimeWarning}</p>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Use Eastern Time (EST) for the interview slot.</p>
              {supportWindowWarningKey.current && (
                <p className="text-xs text-muted-foreground">The selected time is outside the 9:00 AM – 6:00 PM support window.</p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="support-resume">Attach Resume (PDF)</Label>
                  <Input
                    id="support-resume"
                    type="file"
                    accept="application/pdf"
                    onChange={(event) => handleSupportFileChange('resume', event.target.files)}
                    disabled={supportSubmitting}
                  />
                  {resumeFile && <p className="text-xs text-muted-foreground">{resumeFile.name}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="support-jd">Attach JD (PDF)</Label>
                  <Input
                    id="support-jd"
                    type="file"
                    accept="application/pdf"
                    onChange={(event) => handleSupportFileChange('jobDescription', event.target.files)}
                    disabled={supportSubmitting}
                  />
                  {jdFile && <p className="text-xs text-muted-foreground">{jdFile.name}</p>}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="support-additional">Additional Attachments (PDF)</Label>
                <Input
                  id="support-additional"
                  type="file"
                  accept="application/pdf"
                  multiple
                  onChange={(event) => handleSupportFileChange('additionalAttachments', event.target.files)}
                  disabled={supportSubmitting}
                />
                {additionalFiles.length > 0 && (
                  <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                    {additionalFiles.map((file) => (
                      <li key={file.name}>{file.name}</li>
                    ))}
                  </ul>
                )}
              </div>
              <Collapsible open={customMessageEnabled} onOpenChange={setCustomMessageEnabled}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" type="button">
                    {customMessageEnabled ? 'Hide additional message' : 'Add additional message'}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 space-y-2">
                  <Label htmlFor="support-custom-message">Message to include before the details table</Label>
                  <textarea
                    id="support-custom-message"
                    value={customMessage}
                    onChange={(event) => setCustomMessage(event.target.value)}
                    className="w-full rounded border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    rows={4}
                    placeholder="Optional message"
                    disabled={supportSubmitting}
                  />
                </CollapsibleContent>
              </Collapsible>
              
              {supportError && <p className="text-sm text-destructive">{supportError}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetSupportState} disabled={supportSubmitting}>
                Cancel
              </Button>
              <Button onClick={handleSupportSubmit} disabled={supportSubmitting}>
                {supportSubmitting ? 'Sending…' : 'Send Request'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
