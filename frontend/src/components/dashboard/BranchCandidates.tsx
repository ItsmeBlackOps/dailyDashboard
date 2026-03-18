import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import moment from "moment-timezone";
import { io, Socket } from "socket.io-client";
import { useLocation, useNavigate } from "react-router-dom";
import { driver, type DriveStep } from "driver.js";

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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth, API_URL, SOCKET_URL } from "@/hooks/useAuth";
import { EmailSignature } from "@/components/layout/emailSignature";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon } from "lucide-react";
import { useMsal } from "@azure/msal-react";
import { GRAPH_MAIL_SCOPES } from "@/constants";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToastAction } from "@/components/ui/toast";
import { StatusBadge } from "@/components/candidates/StatusBadge";
import { Loader2, BookOpen, MessageSquare } from "lucide-react";
import { usePostHog } from 'posthog-js/react'; // [Harsh] PostHog
import { useNotifications } from "@/context/NotificationContext";
import { ResumeDiscussionDrawer } from "@/components/resume/ResumeDiscussionDrawer";
import { handleSupportInterviewSubmitError } from "@/components/dashboard/supportInterviewSubmitError";

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
  status: string; // Added Status
  receivedDate?: string | null;
  updatedAt?: string | null;
  lastWriteAt?: string | null;
  workflowStatus?: string;
  resumeUnderstandingStatus?: string;
  resumeUnderstanding?: boolean;
  resumeLink?: string;
}

interface CandidateNotificationPayload {
  notificationId: string;
  candidateId: string;
  candidateName: string;
  message: string;
  branch?: string;
  category?: string;
  occurredAt?: string;
  triggeredBy?: string | null;
  triggeredByRole?: string | null;
  scope?: string;
  recruiter?: string;
  expert?: string;
}

interface RecruiterOption {
  value: string;
  label: string;
}

interface CandidateCreatePolicy {
  allowedBranches: string[];
  defaultBranch: string | null;
  branchReadOnly: boolean;
  canCreate: boolean;
  reason?: string;
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

interface AssessmentFormState {
  candidateName: string;
  technology: string;
  email: string;
  contactNumber: string;
  endClient: string;
  jobTitle: string;
  assessmentReceivedDateTime: string;
  assessmentDuration: string;
  additionalInfo: string;
  jobDescriptionText: string;
}

interface SupportCloneAttachment {
  name: string;
  url?: string;
  category?: 'resume' | 'jobDescription' | 'additional';
  type?: string;
  data?: string;
}

interface SupportCloneLoopSlot {
  interviewDateTime: string;
  durationMinutes: number;
}

interface SupportCloneDraft {
  version: number;
  sourceTaskId: string;
  candidateName: string;
  candidateEmail: string;
  contactNumber: string;
  endClient: string;
  jobTitle: string;
  interviewRound: string;
  interviewDateTime?: string;
  durationMinutes?: number;
  technology?: string;
  attachments?: SupportCloneAttachment[];
  loopSlots?: SupportCloneLoopSlot[];
  jobDescriptionText?: string;
  storedAt: string;
  storedBy?: string;
}

const SUPPORT_CLONE_STORAGE_KEY = 'supportCloneDraft';
const SUPPORT_MOCK_STORAGE_KEY = 'supportMockMaterials';
const MAX_STORED_MOCK_ENTRIES = 5;

interface MockFormState {
  candidateName: string;
  candidateEmail: string;
  contactNumber: string;
  technology: string;
  endClient: string;
  interviewRound: string;
  interviewDateTime: string;
  jobDescriptionText: string;
  attachments: {
    name: string;
    type: string;
    data: string; // base64
    category: 'resume' | 'jobDescription' | 'additional';
  }[];
}

interface LoopSlotForm {
  id: string;
  date: Date | null;
  timeInput: string;
  timeValue: string;
  timeWarning: string;
  duration: string;
  durationWarning: string;
  isDatePickerOpen: boolean;
}

type NormalizedScope =
  | { type: 'branch'; value: string }
  | { type: 'hierarchy' | 'expert'; value: string[] };

const JD_KEYWORD_PATTERNS = [
  /\bjob\s+description\b/i,
  /\bresponsibilit(?:y|ies)\b/i,
  /\brequirements?\b/i,
  /\bmust\s+have\b/i,
  /\bshould\s+have\b/i,
  /\bnice\s+to\s+have\b/i,
  /\bexperience\b/i,
  /\bskills?\b/i,
  /\broles?\s+and\s+responsibilit(?:y|ies)\b/i,
  /\bjd\b/i
] as const;

const MIN_JD_CHAR_COUNT = 180;

const looksLikeJobDescription = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const condensedLength = trimmed.replace(/\s+/g, '').length;
  const bulletMatches = (trimmed.match(/(?:^|\n)\s*[-•*]/g) ?? []).length;
  const numberedMatches = (trimmed.match(/(?:^|\n)\s*\d+\./g) ?? []).length;
  const sentenceMatches = (trimmed.match(/[.!?](?:\s|\n)/g) ?? []).length;

  let keywordHits = 0;
  for (const pattern of JD_KEYWORD_PATTERNS) {
    if (pattern.test(trimmed)) {
      keywordHits += 1;
    }
  }

  if (keywordHits === 0) {
    return false;
  }

  if (condensedLength >= MIN_JD_CHAR_COUNT && keywordHits >= 1) {
    return true;
  }

  if (keywordHits >= 2 && (bulletMatches + numberedMatches >= 2)) {
    return true;
  }

  if (keywordHits >= 2 && sentenceMatches >= 3) {
    return true;
  }

  return false;
};

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

const MOCK_ROUNDS = [
  "Training",
  "Evaluation"
] as const;

const EST_TIMEZONE = "America/New_York";
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB default limit mirrored with backend
const TOUR_ROLES = ["recruiter", "mlead", "mam", "mm"] as const;
const DEFAULT_ALLOWED_BRANCHES = ['GGR', 'LKN', 'AHM'] as const;
const DEFAULT_CREATE_POLICY: CandidateCreatePolicy = {
  allowedBranches: [...DEFAULT_ALLOWED_BRANCHES],
  defaultBranch: null,
  branchReadOnly: false,
  canCreate: true
};

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
    createPolicy?: Partial<CandidateCreatePolicy>;
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
  const [recentNotifications, setRecentNotifications] = useState<CandidateNotificationPayload[]>([]);
  const [editResumeFile, setEditResumeFile] = useState<File | null>(null);
  const [editResumeError, setEditResumeError] = useState<string>('');
  const normalizedRole = role.trim().toLowerCase();
  const canView = ["admin", "mm", "mam", "mlead", "lead", "user", "am", "manager", "recruiter"].includes(normalizedRole);
  const canEdit = ["mm", "mam", "mlead", "recruiter", "lead", "am", "admin", "manager"].includes(normalizedRole);
  const canEditBasicFields = ["mm", "mam", "mlead", "recruiter", "admin"].includes(normalizedRole);
  const canChangeRecruiterField = ['mm', 'mam', 'mlead', "admin"].includes(normalizedRole);
  const canChangeContactField = ['mm', 'mam', 'mlead', 'recruiter', "admin"].includes(normalizedRole);
  const canChangeExpertField = ['lead', 'am', "admin"].includes(normalizedRole);
  const isManager = normalizedRole === 'manager';
  const showCreateButton = isManager || normalizedRole === 'mm' || normalizedRole === 'mam';
  const tourEligible = TOUR_ROLES.some((roleKey) => roleKey === normalizedRole);
  const [visibleCount, setVisibleCount] = useState(20);
  const observerTarget = useRef<HTMLDivElement>(null);
  const normalizedScope = useMemo<NormalizedScope | null>(() => {
    if (!scope) {
      return null;
    }

    const type = scope.type;
    if (type === 'branch') {
      const value = typeof scope.value === 'string' ? scope.value.trim().toUpperCase() : '';
      return value ? { type, value } : null;
    }

    if (type === 'hierarchy' || type === 'expert') {
      const values = Array.isArray(scope.value) ? scope.value : [];
      const next = values
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean)
        .sort();
      return next.length > 0 ? { type, value: next } : null;
    }


    return null;
  }, [scope]);

  const scopeSignature = useMemo(() => {
    if (!normalizedScope) {
      return 'none';
    }
    if (normalizedScope.type === 'branch') {
      return `branch:${normalizedScope.value}`;
    }
    return `${normalizedScope.type}:${normalizedScope.value.join('|')}`;
  }, [normalizedScope]);

  const posthog = usePostHog();

  // Track Page View
  useEffect(() => {
    posthog.capture('branch_candidates_viewed', {
      user_role: role,
    });
  }, [role, posthog]);

  // Track Scope Change
  useEffect(() => {
    if (scope) {
      posthog.capture('branch_scope_changed', {
        user_role: role,
        scope_type: scope.type,
        scope_value: Array.isArray(scope.value) ? scope.value.join(',') : scope.value
      });
    }
  }, [scope, role, posthog]);

  const CREATE_RESUME_MAX_BYTES = 5 * 1024 * 1024;
  const canCloneFromTasks = useMemo(() => !['user', 'lead'].includes(normalizedRole), [normalizedRole]);
  const [loading, setLoading] = useState<boolean>(canView);
  const [error, setError] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const { refreshAccessToken, authFetch } = useAuth();
  const { toast } = useToast();
  const { notifications, markAsRead } = useNotifications();
  const { profile } = useUserProfile();
  const location = useLocation();
  const navigate = useNavigate();
  const { instance, accounts } = useMsal();
  const account = accounts[0];
  const [recruiterOptions, setRecruiterOptions] = useState<RecruiterOption[]>([]);
  const [expertOptions, setExpertOptions] = useState<RecruiterOption[]>([]);
  const [createPolicy, setCreatePolicy] = useState<CandidateCreatePolicy>(DEFAULT_CREATE_POLICY);
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
  const [selectedSheetCandidate, setSelectedSheetCandidate] = useState<CandidateRow | null>(null);
  const notificationSubscriptionRef = useRef<string | null>(null);
  const processedNotificationsRef = useRef<Set<string>>(new Set());
  const notificationRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScopeSignatureRef = useRef<string>('none');
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
  const [createResumeFile, setCreateResumeFile] = useState<File | null>(null);
  const [createResumeError, setCreateResumeError] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>('');
  const [bulkUpdating, setBulkUpdating] = useState(false);
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
  const [customMessage, setCustomMessage] = useState('');
  const [jobDescriptionText, setJobDescriptionText] = useState('');
  const supportWindowWarningKey = useRef<string>('');
  const customMessageWarningActiveRef = useRef(false);
  const pendingCustomMessageForJdRef = useRef<string>('');
  const customMessageWarningToastRef = useRef<ReturnType<typeof toast> | null>(null);
  const [durationWarning, setDurationWarning] = useState('');
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [assessmentCandidate, setAssessmentCandidate] = useState<CandidateRow | null>(null);
  const [assessmentForm, setAssessmentForm] = useState<AssessmentFormState>({
    candidateName: '',
    technology: '',
    email: '',
    contactNumber: '',
    endClient: '',
    jobTitle: '',
    assessmentReceivedDateTime: '',
    assessmentDuration: '',
    additionalInfo: '',
    jobDescriptionText: ''
  });
  const [assessmentDate, setAssessmentDate] = useState<Date | null>(null);
  const [assessmentTime, setAssessmentTime] = useState('');
  const [assessmentTimeInput, setAssessmentTimeInput] = useState('');
  const [assessmentTimeWarning, setAssessmentTimeWarning] = useState('');
  const [assessmentDatePickerOpen, setAssessmentDatePickerOpen] = useState(false);
  const [assessmentNoDuration, setAssessmentNoDuration] = useState(false);
  const [assessmentScreeningDone, setAssessmentScreeningDone] = useState(false);
  const [assessmentResumeFile, setAssessmentResumeFile] = useState<File | null>(null);
  const [assessmentInfoFile, setAssessmentInfoFile] = useState<File | null>(null);
  const [assessmentAdditionalFiles, setAssessmentAdditionalFiles] = useState<File[]>([]);
  const [assessmentError, setAssessmentError] = useState('');
  const [assessmentSubmitting, setAssessmentSubmitting] = useState(false);

  // Mock Support State
  const [mockOpen, setMockOpen] = useState(false);
  const [mockCandidate, setMockCandidate] = useState<CandidateRow | null>(null);
  const [mockForm, setMockForm] = useState<MockFormState>({
    candidateName: '',
    candidateEmail: '',
    contactNumber: '',
    technology: '',
    endClient: '',
    interviewRound: 'Mock 1',
    interviewDateTime: '',
    jobDescriptionText: '',
    attachments: []
  });
  const [mockDate, setMockDate] = useState<Date | null>(null);
  const [mockTime, setMockTime] = useState('');
  const [mockDatePickerOpen, setMockDatePickerOpen] = useState(false);
  const [mockSubmitting, setMockSubmitting] = useState(false);
  const [mockError, setMockError] = useState('');
  const [mockResumeFile, setMockResumeFile] = useState<File | null>(null);
  const [mockJdFile, setMockJdFile] = useState<File | null>(null);


  // Discussion Drawer State
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const [discussionCandidate, setDiscussionCandidate] = useState<CandidateRow | null>(null);

  const openDiscussionDrawer = useCallback((candidate: CandidateRow) => {
    // Mark all unread comment notifications for this candidate as read
    notifications
      .filter(n => n.candidateId === candidate.id && n.type === 'comment' && !n.read)
      .forEach(n => markAsRead(n.id));
    setDiscussionCandidate(candidate);
    setDiscussionOpen(true);
  }, [notifications, markAsRead]);

  const acquireGraphAccessToken = useCallback(async (): Promise<string> => {
    let activeAccount = instance.getActiveAccount() ?? account ?? null;
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
      return graphToken;
    } catch (tokenError) {
      console.error('Failed to acquire Graph token', tokenError);
      throw tokenError instanceof Error ? tokenError : new Error('Unable to acquire Graph access token');
    }
  }, [account, instance]);
  const [pendingCloneDraft, setPendingCloneDraft] = useState<SupportCloneDraft | null>(null);
  const cloneHydrationRef = useRef(false);
  const cloneSlotHydrationRef = useRef(false);
  const loopSlotCounter = useRef(0);
  const [loopSlots, setLoopSlots] = useState<LoopSlotForm[]>([]);
  const isLoopRound = useMemo(() => supportForm.interviewRound.toLowerCase().includes('loop'), [supportForm.interviewRound]);



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

  const normalizeCreatePolicy = useCallback((policy?: Partial<CandidateCreatePolicy>): CandidateCreatePolicy => {
    const allowedBranches = Array.from(
      new Set(
        (Array.isArray(policy?.allowedBranches) ? policy.allowedBranches : [...DEFAULT_ALLOWED_BRANCHES])
          .map((value) => String(value || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );

    const normalizedAllowedBranches = allowedBranches.length > 0 ? allowedBranches : [...DEFAULT_ALLOWED_BRANCHES];
    const rawDefaultBranch = typeof policy?.defaultBranch === 'string'
      ? policy.defaultBranch.trim().toUpperCase()
      : '';
    const defaultBranch = rawDefaultBranch && normalizedAllowedBranches.includes(rawDefaultBranch)
      ? rawDefaultBranch
      : null;

    const reason = typeof policy?.reason === 'string' && policy.reason.trim()
      ? policy.reason.trim()
      : undefined;

    return {
      allowedBranches: normalizedAllowedBranches,
      defaultBranch,
      branchReadOnly: Boolean(policy?.branchReadOnly),
      canCreate: policy?.canCreate !== false,
      ...(reason ? { reason } : {})
    };
  }, []);

  const createLoopSlot = useCallback((overrides?: Partial<LoopSlotForm>): LoopSlotForm => {
    const id = `slot-${loopSlotCounter.current++}`;
    return {
      id,
      date: null,
      timeInput: '',
      timeValue: '',
      timeWarning: '',
      duration: '',
      durationWarning: '',
      isDatePickerOpen: false,
      ...overrides
    };
  }, []);

  const restoreAttachmentsFromDraft = useCallback(async (attachments?: SupportCloneAttachment[]) => {
    setResumeFile(null);
    setJdFile(null);
    setAdditionalFiles([]);

    if (!attachments || attachments.length === 0) {
      return;
    }

    const additional: File[] = [];
    let restoredResume: File | null = null;
    let restoredJd: File | null = null;

    for (const attachment of attachments) {
      let file: File | null = null;
      try {
        if (attachment.data) {
          const binary = atob(attachment.data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: attachment.type || 'application/pdf' });
          file = new File([blob], attachment.name, { type: attachment.type || 'application/pdf' });
        } else if (attachment.url) {
          const response = await fetch(attachment.url);
          if (!response.ok) {
            throw new Error(`Failed to download ${attachment.name}`);
          }
          const blob = await response.blob();
          file = new File([blob], attachment.name, { type: attachment.type || blob.type || 'application/pdf' });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to restore attachment';
        toast({ title: 'Attachment skipped', description: message, variant: 'destructive' });
      }

      if (!file) continue;

      switch (attachment.category) {
        case 'resume':
          if (!restoredResume) {
            restoredResume = file;
          } else {
            additional.push(file);
          }
          break;
        case 'jobDescription':
          if (!restoredJd) {
            restoredJd = file;
          } else {
            additional.push(file);
          }
          break;
        default:
          additional.push(file);
          break;
      }
    }

    if (restoredResume) {
      setResumeFile(restoredResume);
    }
    if (restoredJd) {
      setJdFile(restoredJd);
    }
    if (additional.length > 0) {
      setAdditionalFiles(additional);
    }
  }, [toast]);

  const MAX_CLONE_ATTACHMENT_BYTES = 2 * 1024 * 1024;

  const readFileAsDataUrl = useCallback((file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Invalid reader result'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('Unable to read attachment'));
    reader.readAsDataURL(file);
  }), []);

  const encodeAttachmentForStorage = useCallback(async (file: File, category: SupportCloneAttachment['category']): Promise<SupportCloneAttachment> => {
    const attachment: SupportCloneAttachment = {
      name: file.name,
      type: file.type || 'application/pdf',
      category
    };

    if (file.size > MAX_CLONE_ATTACHMENT_BYTES) {
      return attachment;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (dataUrl) {
        const commaIndex = dataUrl.indexOf(',');
        attachment.data = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
      }
    } catch (error) {
      console.error('Failed to encode attachment for storage', error);
    }

    return attachment;
  }, [readFileAsDataUrl]);

  const persistSupportMockMaterials = useCallback((draft: SupportCloneDraft) => {
    const keyCandidates: string[] = [];
    if (draft.candidateEmail) {
      keyCandidates.push(draft.candidateEmail.trim().toLowerCase());
    }
    if (draft.sourceTaskId) {
      keyCandidates.push(draft.sourceTaskId);
    }

    if (keyCandidates.length === 0) {
      return;
    }

    try {
      const raw = localStorage.getItem(SUPPORT_MOCK_STORAGE_KEY);
      let parsed: Record<string, SupportCloneDraft[]> = {};
      if (raw && /^\s*[{[]/.test(raw)) {
        const candidate = JSON.parse(raw);
        if (candidate && typeof candidate === 'object') {
          parsed = candidate;
        }
      }

      const storedBy = (localStorage.getItem('email') || '').trim().toLowerCase();
      const entry: SupportCloneDraft = {
        ...draft,
        storedBy,
      };

      for (const key of keyCandidates) {
        if (!key) continue;
        const existing = Array.isArray(parsed[key]) ? parsed[key] : [];
        const deduped = [entry, ...existing.filter((item) => item?.storedAt !== entry.storedAt)];
        parsed[key] = deduped.slice(0, MAX_STORED_MOCK_ENTRIES);
      }

      try {
        localStorage.setItem(SUPPORT_MOCK_STORAGE_KEY, JSON.stringify(parsed));
      } catch (quotaError) {
        if (quotaError instanceof DOMException && quotaError.name === 'QuotaExceededError') {
          // Storage full — clear the key and retry once with fresh data
          localStorage.removeItem(SUPPORT_MOCK_STORAGE_KEY);
          localStorage.setItem(SUPPORT_MOCK_STORAGE_KEY, JSON.stringify(parsed));
        } else {
          throw quotaError;
        }
      }
    } catch (error) {
      console.error('Failed to persist mock materials', error);
    }
  }, []);

  const hydrateCloneDraft = useCallback(
    async (candidate: CandidateRow, draft: SupportCloneDraft) => {
      const normalizedCandidateName = titleCasePreserveSpacing(draft.candidateName || candidate.name || '').replace(/\s+/g, ' ').trim();
      const normalizedTechnology = draft.technology || titleCasePreserveSpacing(candidate.technology || '').replace(/\s+/g, ' ').trim();
      const email = (draft.candidateEmail || candidate.email || '').toLowerCase();
      const contactNumber = draft.contactNumber || candidate.contact || '';
      const interviewRoundValue = draft.interviewRound || supportForm.interviewRound;

      let interviewDate: Date | null = null;
      let interviewTimeValue = '';
      let interviewTimeInput = '';
      let interviewDateTimeField = '';

      if (draft.interviewDateTime) {
        const startMoment = moment.tz(draft.interviewDateTime, 'YYYY-MM-DDTHH:mm', EST_TIMEZONE);
        if (startMoment.isValid()) {
          interviewDate = startMoment.toDate();
          interviewTimeValue = startMoment.format('HH:mm');
          interviewTimeInput = startMoment.format('hh:mm A');
          interviewDateTimeField = startMoment.format('YYYY-MM-DDTHH:mm');
        }
      }

      const baseForm: SupportFormState = {
        candidateName: normalizedCandidateName,
        technology: normalizedTechnology,
        email,
        endClient: draft.endClient || '',
        jobTitle: draft.jobTitle || '',
        interviewRound: interviewRoundValue,
        interviewDateTime: interviewDateTimeField,
        duration: draft.durationMinutes ? String(draft.durationMinutes) : '',
        contactNumber: contactNumber.trim()
      };

      setSupportCandidate({ ...candidate, name: normalizedCandidateName });
      setSupportForm(baseForm);
      setSupportInterviewDate(interviewDate);
      setSupportInterviewTime(interviewTimeValue);
      setSupportTimeInput(interviewTimeInput);
      setSupportError('');
      setSupportTimeWarning('');
      setDurationWarning('');
      setCustomMessage('');
      setJobDescriptionText(draft.jobDescriptionText || '');

      if (draft.durationMinutes && draft.durationMinutes % 5 !== 0) {
        setDurationWarning('Duration must be in 5-minute increments.');
      }

      if (draft.loopSlots && draft.loopSlots.length > 0) {
        loopSlotCounter.current = 0;
        const hydratedSlots = draft.loopSlots.map((slot) => {
          const slotMoment = moment.tz(slot.interviewDateTime, 'YYYY-MM-DDTHH:mm', EST_TIMEZONE);
          const date = slotMoment.isValid() ? slotMoment.toDate() : null;
          const timeValue = slotMoment.isValid() ? slotMoment.format('HH:mm') : '';
          const timeInput = slotMoment.isValid() ? slotMoment.format('hh:mm A') : '';
          const slotDuration = String(slot.durationMinutes ?? '');
          const durationWarning = slot.durationMinutes % 5 === 0 ? '' : 'Duration must be in 5-minute increments.';
          return createLoopSlot({
            date,
            timeValue,
            timeInput,
            duration: slotDuration,
            durationWarning,
            timeWarning: '',
            isDatePickerOpen: false
          });
        });

        setLoopSlots(hydratedSlots);
      } else {
        setLoopSlots([]);
      }

      await restoreAttachmentsFromDraft(draft.attachments);
      setSupportOpen(true);
      setPendingCloneDraft(null);
    },
    [createLoopSlot, titleCasePreserveSpacing, restoreAttachmentsFromDraft, supportForm.interviewRound]
  );

  const updateLoopSlot = useCallback((id: string, updater: (slot: LoopSlotForm) => LoopSlotForm) => {
    setLoopSlots((prev) => prev.map((slot) => (slot.id === id ? updater(slot) : slot)));
  }, []);

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

  const buildEstMoment = useCallback((date: Date | null, time: string) => {
    if (!date || !time) {
      return null;
    }

    const [hoursRaw, minutesRaw] = time.split(':');
    const hours = Number.parseInt(hoursRaw ?? '', 10);
    const minutes = Number.parseInt(minutesRaw ?? '', 10);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return null;
    }

    const estMoment = moment.tz(
      {
        year: date.getFullYear(),
        month: date.getMonth(),
        date: date.getDate(),
        hour: hours,
        minute: minutes,
        second: 0,
        millisecond: 0
      },
      EST_TIMEZONE
    );

    return estMoment.isValid() ? estMoment : null;
  }, []);

  const warnIfOutOfHours = useCallback((date: Date | null, time: string) => {
    const estMoment = buildEstMoment(date, time);
    if (!estMoment) {
      supportWindowWarningKey.current = '';
      return;
    }

    const hour = estMoment.hour();
    const minute = estMoment.minute();
    const warningKey = estMoment.format('YYYY-MM-DDTHH:mm');
    const outsideWindow = hour < 9 || hour > 18 || (hour === 18 && minute > 0);

    if (outsideWindow && supportWindowWarningKey.current !== warningKey) {
      toast({
        title: 'Outside support hours',
        description: 'Interview falls outside the standard 9:00 AM – 6:00 PM EST window.',
        variant: 'destructive'
      });
      supportWindowWarningKey.current = warningKey;
      return;
    }

    if (!outsideWindow) {
      supportWindowWarningKey.current = '';
    }
  }, [buildEstMoment, toast]);

  const movePendingMessageToJd = useCallback(() => {
    const pending = pendingCustomMessageForJdRef.current.trim();
    if (!pending) {
      return;
    }

    setJobDescriptionText((prev) => {
      const hasExisting = prev.trim().length > 0;
      return hasExisting ? `${prev.trimEnd()}\n\n${pending}` : pending;
    });
    setCustomMessage('');
    setSupportError('');
    pendingCustomMessageForJdRef.current = '';
    customMessageWarningActiveRef.current = false;
    if (customMessageWarningToastRef.current) {
      customMessageWarningToastRef.current.dismiss();
      customMessageWarningToastRef.current = null;
    }
  }, [setCustomMessage, setJobDescriptionText, setSupportError]);

  const ensureCustomMessageWarning = useCallback((value: string) => {
    const trimmed = value.trim();
    const hasDedicatedJd = Boolean(jdFile || jobDescriptionText.trim().length > 0);
    const shouldWarn = Boolean(trimmed) && looksLikeJobDescription(trimmed) && !hasDedicatedJd;

    if (shouldWarn) {
      pendingCustomMessageForJdRef.current = trimmed;
      if (!customMessageWarningActiveRef.current) {
        customMessageWarningActiveRef.current = true;
        customMessageWarningToastRef.current = toast({
          title: 'Job description detected',
          description: 'Move job description content into the JD field so it is formatted correctly in the support email.',
          action: (
            <ToastAction altText="Move text to JD" onClick={movePendingMessageToJd}>
              Move to JD
            </ToastAction>
          )
        });
      }
    } else {
      pendingCustomMessageForJdRef.current = '';
      if (customMessageWarningActiveRef.current) {
        customMessageWarningActiveRef.current = false;
      }
      if (customMessageWarningToastRef.current) {
        customMessageWarningToastRef.current.dismiss();
        customMessageWarningToastRef.current = null;
      }
    }
  }, [jdFile, jobDescriptionText, movePendingMessageToJd, toast]);

  const handleCustomMessageChange = useCallback((value: string) => {
    setCustomMessage(value);
  }, []);

  useEffect(() => {
    ensureCustomMessageWarning(customMessage);
  }, [customMessage, ensureCustomMessageWarning]);

  const handleLoopSlotDatePickerToggle = useCallback((id: string, open: boolean) => {
    updateLoopSlot(id, (slot) => ({ ...slot, isDatePickerOpen: open }));
  }, [updateLoopSlot]);

  const handleLoopSlotDateChange = useCallback((id: string, date: Date | undefined) => {
    if (!date) return;
    updateLoopSlot(id, (slot) => {
      if (slot.timeValue) {
        warnIfOutOfHours(date, slot.timeValue);
      }
      return { ...slot, date, isDatePickerOpen: false };
    });
  }, [updateLoopSlot, warnIfOutOfHours]);

  const handleLoopSlotTimeChange = useCallback((id: string, value: string) => {
    updateLoopSlot(id, (slot) => {
      const normalized = validateTimeInput(value);
      if (!normalized) {
        return { ...slot, timeInput: value, timeValue: '', timeWarning: 'Enter a valid time in 5-minute increments (e.g., 03:15 PM).' };
      }
      if (slot.date) {
        warnIfOutOfHours(slot.date, normalized);
      }
      return { ...slot, timeInput: value, timeValue: normalized, timeWarning: '' };
    });
  }, [updateLoopSlot, validateTimeInput, warnIfOutOfHours]);

  const handleLoopSlotDurationChange = useCallback((id: string, value: string) => {
    updateLoopSlot(id, (slot) => {
      const digitsOnly = value.replace(/[^0-9]/g, '').slice(0, 3);
      const minutes = Number.parseInt(digitsOnly, 10);
      let warning = '';
      if (digitsOnly) {
        if (!Number.isFinite(minutes) || minutes <= 0) {
          warning = 'Duration must be a positive number of minutes.';
        } else if (minutes % 5 !== 0) {
          warning = 'Duration must be in 5-minute increments.';
        }
      }
      return { ...slot, duration: digitsOnly, durationWarning: warning };
    });
  }, [updateLoopSlot]);

  const handleAddLoopSlot = useCallback(() => {
    setLoopSlots((prev) => {
      const last = prev[prev.length - 1];
      const newSlot = createLoopSlot({
        date: last?.date ?? null,
        duration: last?.duration ?? '',
      });
      return [...prev, newSlot];
    });
  }, [createLoopSlot]);

  const handleRemoveLoopSlot = useCallback((id: string) => {
    setLoopSlots((prev) => (prev.length <= 1 ? prev : prev.filter((slot) => slot.id !== id)));
  }, []);

  useEffect(() => {
    if (isLoopRound && loopSlots.length === 0) {
      setLoopSlots([createLoopSlot()]);
    }
  }, [isLoopRound, loopSlots.length, createLoopSlot]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const cloneFlag = params.get('clone');

    if (cloneFlag !== '1') {
      cloneHydrationRef.current = false;
      return;
    }

    if (cloneHydrationRef.current) {
      return;
    }

    cloneHydrationRef.current = true;

    const stored = localStorage.getItem(SUPPORT_CLONE_STORAGE_KEY);
    if (!stored) {
      toast({
        title: 'Nothing to clone',
        description: 'No stored support request was found. Prepare a new request manually.',
        variant: 'destructive'
      });
      navigate(location.pathname, { replace: true });
      return;
    }

    try {
      if (!/^\s*[{[]/.test(stored)) {
        throw new Error('Invalid clone payload');
      }
      const parsed = JSON.parse(stored) as SupportCloneDraft;
      if (parsed && typeof parsed === 'object' && parsed.version === 1) {
        setPendingCloneDraft(parsed);
      } else {
        throw new Error('Unsupported draft format');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid clone payload';
      toast({ title: 'Unable to load clone data', description: message, variant: 'destructive' });
      localStorage.removeItem(SUPPORT_CLONE_STORAGE_KEY);
    } finally {
      navigate(location.pathname, { replace: true });
    }
  }, [location, navigate, toast]);

  useEffect(() => {
    if (!pendingCloneDraft) {
      return;
    }

    if (cloneSlotHydrationRef.current) {
      return;
    }

    if (candidates.length === 0) {
      return;
    }

    const candidateMatch = candidates.find((candidate) =>
      candidate.email?.toLowerCase() === pendingCloneDraft.candidateEmail.toLowerCase()
    );

    if (!candidateMatch) {
      toast({
        title: 'Candidate not found',
        description: 'The stored clone does not match a candidate in this branch. Locate the candidate manually to continue.',
        variant: 'destructive'
      });
      cloneSlotHydrationRef.current = true;
      return;
    }

    cloneSlotHydrationRef.current = true;
    void hydrateCloneDraft(candidateMatch, pendingCloneDraft);
  }, [pendingCloneDraft, candidates, hydrateCloneDraft, toast]);

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
    setJobDescriptionText('');
    supportWindowWarningKey.current = '';
    setDurationWarning('');
    setLoopSlots([]);
    loopSlotCounter.current = 0;
  }, []);

  const resetAssessmentState = useCallback(() => {
    setAssessmentOpen(false);
    setAssessmentCandidate(null);
    setAssessmentForm({
      candidateName: '',
      technology: '',
      email: '',
      contactNumber: '',
      endClient: '',
      jobTitle: '',
      assessmentReceivedDateTime: '',
      assessmentDuration: '',
      additionalInfo: '',
      jobDescriptionText: ''
    });
    setAssessmentDate(null);
    setAssessmentTime('');
    setAssessmentTimeInput('');
    setAssessmentTimeWarning('');
    setAssessmentDatePickerOpen(false);
    setAssessmentNoDuration(false);
    setAssessmentScreeningDone(false);
    setAssessmentResumeFile(null);
    setAssessmentInfoFile(null);
    setAssessmentAdditionalFiles([]);
    setAssessmentError('');
    setAssessmentSubmitting(false);
  }, []);

  const openSupportDialog = useCallback((candidate: CandidateRow) => {
    const formattedName = titleCasePreserveSpacing(candidate.name || '').replace(/\s+/g, ' ').trim();
    const formattedTechnology = candidate.technology
      ? titleCasePreserveSpacing(candidate.technology).replace(/\s+/g, ' ').trim()
      : '';
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
    setJobDescriptionText('');
    supportWindowWarningKey.current = '';
    setDurationWarning('');
    setLoopSlots([]);
    loopSlotCounter.current = 0;
    setSupportOpen(true);
  }, [titleCasePreserveSpacing]);

  const openAssessmentDialog = useCallback((candidate: CandidateRow) => {
    const formattedName = titleCasePreserveSpacing(candidate.name || '').replace(/\s+/g, ' ').trim();
    const formattedTechnology = candidate.technology
      ? titleCasePreserveSpacing(candidate.technology).replace(/\s+/g, ' ').trim()
      : '';
    setAssessmentCandidate(candidate);
    setAssessmentForm({
      candidateName: formattedName,
      technology: formattedTechnology,
      email: (candidate.email || '').toLowerCase(),
      contactNumber: (candidate.contact || '').trim(),
      endClient: '',
      jobTitle: '',
      assessmentReceivedDateTime: '',
      assessmentDuration: '',
      additionalInfo: '',
      jobDescriptionText: ''
    });
    setAssessmentDate(null);
    setAssessmentTime('');
    setAssessmentTimeInput('');
    setAssessmentTimeWarning('');
    setAssessmentDatePickerOpen(false);
    setAssessmentNoDuration(false);
    setAssessmentScreeningDone(false);
    setAssessmentResumeFile(null);
    setAssessmentInfoFile(null);
    setAssessmentAdditionalFiles([]);
    setAssessmentError('');
    setAssessmentSubmitting(false);
    setAssessmentOpen(true);
  }, [titleCasePreserveSpacing]);

  const handleSupportFieldChange = useCallback((field: keyof SupportFormState, value: string) => {
    if (field === 'contactNumber' || field === 'interviewDateTime') {
      return;
    }
    setSupportError('');

    if (field === 'interviewRound') {
      const isLoopValue = value.toLowerCase().includes('loop');
      if (isLoopValue) {
        setLoopSlots((prev) => (prev.length > 0 ? prev : [createLoopSlot()]));
      } else {
        setLoopSlots([]);
      }
    }

    setSupportForm((prev) => {
      if (field === 'interviewRound') {
        const isLoopValue = value.toLowerCase().includes('loop');
        return {
          ...prev,
          interviewRound: value,
          duration: isLoopValue ? '' : prev.duration,
        };
      }
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
    const estMoment = buildEstMoment(date, time);
    return estMoment ? estMoment.format('YYYY-MM-DDTHH:mm') : '';
  }, [buildEstMoment]);

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

  const handleAssessmentFieldChange = useCallback((field: keyof AssessmentFormState, value: string) => {
    if (field === 'candidateName' || field === 'technology' || field === 'email' || field === 'contactNumber' || field === 'assessmentReceivedDateTime') {
      return;
    }

    setAssessmentError('');
    setAssessmentForm((prev) => {
      if (field === 'endClient' || field === 'jobTitle') {
        return { ...prev, [field]: titleCasePreserveSpacing(value) };
      }
      if (field === 'assessmentDuration') {
        const digitsOnly = value.replace(/[^0-9]/g, '').slice(0, 3);
        return { ...prev, assessmentDuration: digitsOnly };
      }

      return { ...prev, [field]: value };
    });
  }, [titleCasePreserveSpacing]);

  const handleAssessmentDateSelect = useCallback((date: Date | undefined) => {
    if (!date) return;
    setAssessmentDate(date);
    setAssessmentError('');
    setAssessmentDatePickerOpen(false);
    setAssessmentForm((prev) => ({
      ...prev,
      assessmentReceivedDateTime: computeInterviewDateTimeValue(date, assessmentTime)
    }));
  }, [assessmentTime, computeInterviewDateTimeValue]);

  const handleAssessmentTimeChange = useCallback((value: string) => {
    setAssessmentTimeInput(value);
    const normalized = validateTimeInput(value);
    if (!normalized) {
      setAssessmentTimeWarning('Enter a valid time in 5-minute increments (e.g., 03:15 PM).');
      setAssessmentTime('');
      setAssessmentForm((prev) => ({
        ...prev,
        assessmentReceivedDateTime: ''
      }));
      return;
    }

    setAssessmentTimeWarning('');
    setAssessmentTime(normalized);
    setAssessmentForm((prev) => ({
      ...prev,
      assessmentReceivedDateTime: computeInterviewDateTimeValue(assessmentDate, normalized)
    }));
  }, [assessmentDate, computeInterviewDateTimeValue, validateTimeInput]);

  const handleAssessmentFileChange = useCallback((field: 'resume' | 'assessmentInfo' | 'additionalAttachments', files: FileList | null) => {
    if (!files || files.length === 0) {
      if (field === 'resume') setAssessmentResumeFile(null);
      if (field === 'assessmentInfo') setAssessmentInfoFile(null);
      if (field === 'additionalAttachments') setAssessmentAdditionalFiles([]);
      return;
    }

    const validateFile = (file: File) => {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        const sizeMb = (MAX_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(1);
        throw new Error(`Attachments must be under ${sizeMb} MB.`);
      }
      return file;
    };

    try {
      if (field === 'additionalAttachments') {
        const validated = Array.from(files).map((file) => validateFile(file));
        setAssessmentAdditionalFiles(validated);
      } else {
        const file = validateFile(files[0]);
        if (field === 'resume') {
          setAssessmentResumeFile(file);
        } else {
          setAssessmentInfoFile(file);
        }
      }
      setAssessmentError('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid attachment';
      setAssessmentError(message);
      if (field === 'additionalAttachments') {
        setAssessmentAdditionalFiles([]);
      } else if (field === 'resume') {
        setAssessmentResumeFile(null);
      } else {
        setAssessmentInfoFile(null);
      }
    }
  }, []);

  const handleAssessmentSubmit = useCallback(async () => {
    if (!assessmentCandidate) {
      setAssessmentError('No candidate selected.');
      return;
    }

    const normalizedEndClient = titleCasePreserveSpacing(assessmentForm.endClient).replace(/\s+/g, ' ').trim();
    if (!normalizedEndClient) {
      setAssessmentError('End client is required.');
      return;
    }

    const normalizedJobTitle = titleCasePreserveSpacing(assessmentForm.jobTitle).replace(/\s+/g, ' ').trim();
    if (!normalizedJobTitle) {
      setAssessmentError('Job title is required.');
      return;
    }

    if (!assessmentForm.assessmentReceivedDateTime.trim()) {
      setAssessmentError('Assessment received date and time is required.');
      return;
    }

    if (assessmentTimeWarning) {
      setAssessmentError(assessmentTimeWarning);
      return;
    }

    if (!assessmentResumeFile) {
      setAssessmentError('Attach the candidate resume before sending.');
      return;
    }

    if (!assessmentInfoFile) {
      setAssessmentError('Attach the assessment information before sending.');
      return;
    }

    let graphToken = '';
    try {
      graphToken = await acquireGraphAccessToken();
    } catch (tokenError) {
      setAssessmentError('Authorize Microsoft access and try again.');
      return;
    }

    try {
      setAssessmentSubmitting(true);
      setAssessmentError('');

      const formData = new FormData();
      formData.append('candidateId', assessmentCandidate.id);
      formData.append('endClient', normalizedEndClient);
      formData.append('jobTitle', normalizedJobTitle);
      formData.append('assessmentReceivedDateTime', assessmentForm.assessmentReceivedDateTime);
      if (assessmentForm.assessmentDuration.trim() && !assessmentNoDuration) {
        formData.append('assessmentDuration', assessmentForm.assessmentDuration.trim());
      }
      formData.append('noDurationMentioned', assessmentNoDuration ? 'true' : 'false');
      formData.append('screeningDone', assessmentScreeningDone ? 'true' : 'false');
      if (assessmentForm.technology.trim()) {
        formData.append('technology', assessmentForm.technology.trim());
      }
      if (assessmentForm.additionalInfo.trim()) {
        formData.append('additionalInfo', assessmentForm.additionalInfo.trim());
      }
      if (assessmentForm.jobDescriptionText.trim()) {
        formData.append('jobDescriptionText', assessmentForm.jobDescriptionText.trim());
      }

      formData.append('resume', assessmentResumeFile);
      formData.append('assessmentInfo', assessmentInfoFile);
      assessmentAdditionalFiles.forEach((file) => {
        formData.append('additionalAttachments', file);
      });

      const response = await authFetch(`${API_URL}/api/support/assessment`, {
        method: 'POST',
        headers: {
          'x-graph-access-token': graphToken
        },
        body: formData,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : 'Unable to send assessment support request';
        setAssessmentError(message);
        return;
      }

      toast({
        title: 'Assessment support request sent',
        description: typeof payload?.message === 'string'
          ? payload.message
          : 'Assessment support email sent successfully.',
      });

      resetAssessmentState();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send assessment support request';
      setAssessmentError(message);
    } finally {
      setAssessmentSubmitting(false);
    }
  }, [
    assessmentCandidate,
    assessmentForm,
    assessmentTimeWarning,
    assessmentResumeFile,
    assessmentInfoFile,
    assessmentAdditionalFiles,
    assessmentNoDuration,
    assessmentScreeningDone,
    authFetch,
    toast,
    titleCasePreserveSpacing,
    resetAssessmentState,
    acquireGraphAccessToken
  ]);

  // Helper to open sheet
  const openCandidateSheet = (candidate: CandidateRow) => {
    setSelectedSheetCandidate(candidate);
  };


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

    const trimmedCustomMessage = customMessage.trim();
    const jobDescriptionProvided = Boolean(jdFile || jobDescriptionText.trim().length > 0);
    if (trimmedCustomMessage && looksLikeJobDescription(trimmedCustomMessage) && !jobDescriptionProvided) {
      ensureCustomMessageWarning(trimmedCustomMessage);
      setSupportError('Move the job description into the JD field or attach the JD PDF before sending.');
      return;
    }

    if (!isLoopRound && supportTimeWarning) {
      setSupportError('Fix the interview time before submitting.');
      return;
    }

    const resolvedSlots: SupportCloneLoopSlot[] = [];
    let singleInterviewMoment: moment.Moment | null = null;

    if (isLoopRound) {
      if (loopSlots.length === 0) {
        setSupportError('Add at least one loop slot.');
        return;
      }

      const now = moment().tz(EST_TIMEZONE);

      for (const slot of loopSlots) {
        if (!slot.date) {
          setSupportError('Each loop slot requires a date.');
          return;
        }

        if (!slot.timeValue) {
          setSupportError('Each loop slot requires a start time.');
          return;
        }

        if (!slot.duration) {
          setSupportError('Each loop slot requires a duration.');
          return;
        }

        if (slot.timeWarning) {
          setSupportError(slot.timeWarning);
          return;
        }

        if (slot.durationWarning) {
          setSupportError(slot.durationWarning);
          return;
        }

        const isoLocal = computeInterviewDateTimeValue(slot.date, slot.timeValue);
        if (!isoLocal) {
          setSupportError('Invalid loop slot date or time.');
          return;
        }

        const slotMoment = moment.tz(isoLocal, 'YYYY-MM-DDTHH:mm', EST_TIMEZONE);
        if (!slotMoment.isValid()) {
          setSupportError('Invalid loop slot date or time.');
          return;
        }

        if (slotMoment.isBefore(now)) {
          setSupportError('Loop slots must be scheduled in the future.');
          return;
        }



        const minutes = Number.parseInt(slot.duration, 10);
        if (!Number.isFinite(minutes) || minutes <= 0) {
          setSupportError('Duration must be a positive number of minutes.');
          return;
        }

        if (minutes % 5 !== 0) {
          setSupportError('Duration must be in 5-minute increments.');
          return;
        }

        resolvedSlots.push({
          interviewDateTime: isoLocal,
          durationMinutes: minutes
        });
      }
    } else {
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



      singleInterviewMoment = interviewMoment;
      resolvedSlots.push({
        interviewDateTime: supportForm.interviewDateTime,
        durationMinutes
      });
    }

    if (!supportForm.contactNumber.trim()) {
      setSupportError('Contact number is required.');
      return;
    }

    if (!resumeFile) {
      setSupportError('Attach the candidate resume (PDF) before sending support.');
      return;
    }

    let graphToken = '';
    try {
      graphToken = await acquireGraphAccessToken();
    } catch (tokenError) {
      setSupportError('Authorize Microsoft access and try again.');
      return;
    }

    try {
      setSupportSubmitting(true);
      setSupportError('');

      const formData = new FormData();
      const normalizedEndClient = titleCasePreserveSpacing(supportForm.endClient).replace(/\s+/g, ' ').trim();
      const normalizedJobTitle = titleCasePreserveSpacing(supportForm.jobTitle).replace(/\s+/g, ' ').trim();

      const firstSlot = resolvedSlots[0];

      formData.append('candidateId', supportCandidate.id);
      formData.append('endClient', normalizedEndClient);
      formData.append('jobTitle', normalizedJobTitle);
      formData.append('interviewRound', supportForm.interviewRound);
      if (isLoopRound) {
        formData.append('loopSlots', JSON.stringify(resolvedSlots));
      }
      formData.append('interviewDateTime', firstSlot.interviewDateTime);
      formData.append('duration', String(firstSlot.durationMinutes));
      formData.append('contactNumber', supportForm.contactNumber.trim());
      if (trimmedCustomMessage) {
        formData.append('customMessage', trimmedCustomMessage);
      }

      const jdTextValue = jobDescriptionText.trim();
      if (jdTextValue) {
        formData.append('jobDescriptionText', jdTextValue);
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
        handleSupportInterviewSubmitError({
          responseStatus: response.status,
          backendMessage: typeof payload?.error === 'string' ? payload.error : null,
          setSupportError,
          toast,
          posthog,
          candidateName: supportForm.candidateName,
          interviewRound: supportForm.interviewRound,
          isLoopRound
        });
        return;
      }

      toast({
        title: 'Support request sent',
        description: typeof payload?.message === 'string'
          ? payload.message
          : 'Interview support request emailed successfully.',
      });

      // [Harsh] Track Support
      posthog?.capture('support_submitted', {
        candidate: supportForm.candidateName,
        tech: supportForm.technology,
        round: supportForm.interviewRound
      });

      const storedAttachments: SupportCloneAttachment[] = [];
      try {
        if (resumeFile) {
          storedAttachments.push(await encodeAttachmentForStorage(resumeFile, 'resume'));
        }
        if (jdFile) {
          storedAttachments.push(await encodeAttachmentForStorage(jdFile, 'jobDescription'));
        }
        for (const file of additionalFiles) {
          storedAttachments.push(await encodeAttachmentForStorage(file, 'additional'));
        }
      } catch (encodeError) {
        console.error('Failed to prepare attachments for cloning', encodeError);
      }

      const storedDraft: SupportCloneDraft = {
        version: 1,
        sourceTaskId: pendingCloneDraft?.sourceTaskId || supportCandidate.id,
        candidateName: supportForm.candidateName,
        candidateEmail: supportForm.email,
        contactNumber: supportForm.contactNumber.trim(),
        endClient: normalizedEndClient,
        jobTitle: normalizedJobTitle,
        interviewRound: supportForm.interviewRound,
        interviewDateTime: !isLoopRound ? firstSlot.interviewDateTime : undefined,
        durationMinutes: !isLoopRound ? firstSlot.durationMinutes : undefined,
        technology: supportForm.technology,
        attachments: storedAttachments.length ? storedAttachments : undefined,
        loopSlots: isLoopRound ? resolvedSlots : undefined,
        jobDescriptionText: jdTextValue || undefined,
        storedAt: new Date().toISOString(),
        storedBy: (localStorage.getItem('email') || '').trim().toLowerCase() || undefined
      };

      try {
        localStorage.setItem(SUPPORT_CLONE_STORAGE_KEY, JSON.stringify(storedDraft));
        persistSupportMockMaterials(storedDraft);
      } catch (storageError) {
        console.error('Failed to persist support clone draft', storageError);
      }

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
    titleCasePreserveSpacing,
    resetSupportState,
    supportInterviewDate,
    supportInterviewTime,
    customMessage,
    jobDescriptionText,
    supportTimeWarning,
    durationWarning,
    isLoopRound,
    loopSlots,
    computeInterviewDateTimeValue,
    encodeAttachmentForStorage,
    ensureCustomMessageWarning,
    pendingCloneDraft,
    persistSupportMockMaterials,
    acquireGraphAccessToken
  ]);


  const resetMockState = useCallback(() => {
    setMockOpen(false);
    setMockCandidate(null);
    setMockForm({
      candidateName: '',
      candidateEmail: '',
      contactNumber: '',
      technology: '',
      endClient: '',
      interviewRound: 'Mock 1',
      interviewDateTime: '',
      jobDescriptionText: '',
      attachments: []
    });
    setMockDate(null);
    setMockTime('');
    setMockError('');
    setMockSubmitting(false);
    setMockResumeFile(null);
    setMockJdFile(null);
  }, []);

  const openMockDialog = useCallback((candidate: CandidateRow) => {
    setMockCandidate(candidate);
    setMockForm(prev => ({
      ...prev,
      candidateName: candidate.name,
      candidateEmail: candidate.email,
      contactNumber: candidate.contact,
      technology: candidate.technology,
      endClient: '',
      interviewRound: 'Mock 1'
    }));
    setMockOpen(true);
    posthog.capture('mock_dialog_opened', {
      candidate_id: candidate.id,
      candidate_name: candidate.name,
      recruiter_email: candidate.recruiter
    });
  }, [posthog]);

  const handleMockSubmit = useCallback(async () => {
    if (!mockCandidate) {
      setMockError('No candidate selected.');
      return;
    }

    if (!mockForm.endClient.trim()) {
      setMockError('End client is required.');
      return;
    }

    if (!mockDate || !mockTime) {
      setMockError('Interview date and time is required.');
      return;
    }

    const isoLocal = computeInterviewDateTimeValue(mockDate, mockTime);
    if (!isoLocal) {
      setMockError('Invalid interview date or time.');
      return;
    }

    const interviewMoment = moment.tz(isoLocal, 'YYYY-MM-DDTHH:mm', EST_TIMEZONE);
    if (!interviewMoment.isValid()) {
      setMockError('Invalid interview date/time.');
      return;
    }

    const now = moment().tz(EST_TIMEZONE);
    if (interviewMoment.isBefore(now)) {
      setMockError('Interview date and time must be in the future.');
      return;
    }

    if (!mockForm.contactNumber.trim()) {
      setMockError('Contact number is required.');
      return;
    }

    let graphToken = '';
    try {
      graphToken = await acquireGraphAccessToken();
    } catch (tokenError) {
      setMockError('Authorize Microsoft access and try again.');
      return;
    }

    try {
      setMockSubmitting(true);
      setMockError('');

      const attachments: { name: string; type: string; data: string; category: 'resume' | 'jobDescription' | 'additional' }[] = [];

      if (mockResumeFile) {
        try {
          const dataUrl = await readFileAsDataUrl(mockResumeFile);
          if (dataUrl) {
            const commaIndex = dataUrl.indexOf(',');
            const b64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
            attachments.push({
              name: mockResumeFile.name,
              type: mockResumeFile.type || 'application/pdf',
              data: b64,
              category: 'resume'
            });
          }
        } catch (e) {
          console.error("Error reading resume file", e);
        }
      }

      if (mockJdFile) {
        try {
          const dataUrl = await readFileAsDataUrl(mockJdFile);
          if (dataUrl) {
            const commaIndex = dataUrl.indexOf(',');
            const b64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
            attachments.push({
              name: mockJdFile.name,
              type: mockJdFile.type || 'application/pdf',
              data: b64,
              category: 'jobDescription'
            });
          }
        } catch (e) {
          console.error("Error reading JD file", e);
        }
      }

      const payload = {
        candidateId: mockCandidate.id,
        candidateName: mockForm.candidateName,
        candidateEmail: mockForm.candidateEmail,
        contactNumber: mockForm.contactNumber,
        technology: mockForm.technology,
        endClient: titleCasePreserveSpacing(mockForm.endClient).replace(/\s+/g, ' ').trim(),
        interviewRound: mockForm.interviewRound,
        interviewDateTime: interviewMoment.format('YYYY-MM-DDTHH:mm'),
        jobDescriptionText: mockForm.jobDescriptionText,
        attachments
      };

      const response = await authFetch(`${API_URL}/api/support/mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-graph-access-token': graphToken
        },
        body: JSON.stringify(payload),
      });

      const resData = await response.json().catch(() => null);

      if (!response.ok) {
        const message = typeof resData?.error === 'string' ? resData.error : 'Unable to send mock request';
        setMockError(message);
        return;
      }

      toast({
        title: 'Mock request sent',
        description: typeof resData?.message === 'string' ? resData.message : 'Mock interview request sent successfully.'
      });

      resetMockState();

      posthog.capture('mock_request_submitted', {
        candidate_name: mockForm.candidateName,
        end_client: mockForm.endClient,
        round: mockForm.interviewRound,
        has_resume: !!mockResumeFile,
        has_jd: !!mockJdFile
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send mock request';
      setMockError(message);
    } finally {
      setMockSubmitting(false);
    }
  }, [
    mockCandidate,
    mockForm,
    mockDate,
    mockTime,
    mockResumeFile,
    mockJdFile,
    acquireGraphAccessToken,
    authFetch,
    toast,
    readFileAsDataUrl,
    titleCasePreserveSpacing,
    resetMockState,
    computeInterviewDateTimeValue
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
    return io(SOCKET_URL, {
      autoConnect: false,
      transports: ["websocket"],
      auth: { token }
    });
  }, [canView]);

  const handleStatusUpdate = useCallback((id: string, newStatus: string) => {
    return new Promise<void>((resolve, reject) => {
      if (!socket) {
        toast({ title: 'Connection Error', description: 'Socket not connected', variant: 'destructive' });
        reject(new Error('Socket not connected'));
        return;
      }

      socket.emit('updateCandidateStatus', { candidateId: id, status: newStatus }, (response: any) => {
        if (response?.success) {
          setCandidates((prev) => prev.map((c) => {
            if (c.id === id) {
              return { ...c, status: newStatus };
            }
            return c;
          }));

          // Only show toast if not bulk updating to avoid spam
          if (!bulkUpdating) {
            toast({
              title: 'Status Updated',
              description: `Candidate status changed to ${newStatus}`
            });
          }
          resolve();
        } else {
          const msg = response?.error || 'Failed to update status';
          toast({ title: 'Update Failed', description: msg, variant: 'destructive' });
          reject(new Error(msg));
        }
      });
    });
  }, [socket, toast, bulkUpdating]);

  const handleSelectRow = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

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


  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      const allIds = filteredCandidates.map((c) => c.id);
      setSelectedIds(new Set(allIds));
    } else {
      setSelectedIds(new Set());
    }
  }, [filteredCandidates]);



  const handleBulkStatusUpdate = useCallback(async (newStatus: string) => {
    if (!newStatus || selectedIds.size === 0) return;

    setBulkUpdating(true);
    const ids = Array.from(selectedIds);

    // Use refined Bulk Update (HAR-37)
    socket.emit('bulkUpdateCandidateStatus', { ids, status: newStatus }, (response: any) => {
      setBulkUpdating(false);
      setBulkStatus('');
      setSelectedIds(new Set());

      if (response.success) {
        toast({
          title: 'Bulk Update Complete',
          description: `Successfully updated ${response.updated} candidates.`,
        });
        // [Harsh] Track Bulk Object
        posthog?.capture('bulk_status_update', {
          count: ids.length,
          new_status: newStatus,
          ids: ids
        });
      } else {
        toast({
          title: 'Bulk Update Failed',
          description: response.error || `Failed to update candidates.`,
          variant: 'destructive'
        });
        posthog?.capture('bulk_status_update_failed', { error: response.error });
      }
    });
  }, [selectedIds, toast, posthog]);

  const handleResumeUnderstandingTrigger = (candidateId: string) => {
    if (!socket) return;

    socket.emit('updateResumeUnderstanding', { candidateId, status: 'pending' }, (response: any) => {
      if (response?.success) {
        toast({
          title: "Sent to Resume Understanding",
          description: "Candidate has been moved to the Resume Understanding queue.",
        });
        // Optimistically update local state if needed, though socket listener usually handles it
        setCandidates((prev) => prev.map((c) =>
          c.id === candidateId ? { ...c, resumeUnderstandingStatus: 'pending' } : c
        ));
      } else {
        toast({
          title: "Failed to update",
          description: response?.error || "Could not move candidate.",
          variant: "destructive"
        });
      }
    });
  };





  const driverRef = useRef<ReturnType<typeof driver> | null>(null);
  const introRef = useRef<HTMLDivElement | null>(null);
  const updatesRef = useRef<HTMLDivElement | null>(null);
  const includesRef = useRef<HTMLDivElement | null>(null);
  const resumeFieldRef = useRef<HTMLDivElement | null>(null);
  const hasAutoStarted = useRef(false);

  const startTour = useCallback(() => {
    if (!tourEligible || typeof document === 'undefined') {
      return false;
    }

    let driverInstance = driverRef.current;
    if (!driverInstance) {
      driverInstance = driver({
        allowClose: true,
        showProgress: true,
        overlayOpacity: 0.55,
        smoothScroll: true,
        stagePadding: 8,
        nextBtnText: 'Next',
        prevBtnText: 'Back',
        doneBtnText: 'Finish',
        popoverClass: 'max-w-xs md:max-w-sm'
      });
      driverRef.current = driverInstance;
    }

    const doc = document;
    const steps: DriveStep[] = [];

    const introElement = introRef.current;
    if (introElement) {
      steps.push({
        element: introElement,
        popover: {
          title: 'Hey Branch Buddy!',
          description: 'Hi! I am your friendly guide. In five tiny steps we will learn how to care for every candidate.',
          side: 'bottom'
        }
      });
    }

    const supportElement = doc.querySelector('[data-tour-id="branch-support-button"]')
      || doc.querySelector('[data-tour-id="branch-support-highlight"]')
      || updatesRef.current;
    if (supportElement) {
      steps.push({
        element: supportElement,
        popover: {
          title: 'Support Button = Ask for Help',
          description: 'Click Support like raising your hand. Fill the form and our system emails the interview details automatically—no extra sending needed.',
          side: 'right'
        }
      });
    }

    const autoEmailElement = doc.querySelector('[data-tour-id="branch-auto-email"]');
    if (autoEmailElement) {
      steps.push({
        element: autoEmailElement,
        popover: {
          title: 'Emails Fire Automatically',
          description: 'After you press Send, the system emails every detail to the recipient—so triple-check the info before submitting.',
          side: 'right'
        }
      });
    }

    const cloneNavElement = doc.querySelector('[data-tour-id="tasks-link"]');
    const cloneInfoElement = doc.querySelector('[data-tour-id="branch-clone-highlight"]');
    if (canCloneFromTasks && (cloneNavElement || cloneInfoElement)) {
      steps.push({
        element: cloneNavElement ?? cloneInfoElement,
        popover: {
          title: 'Clone Button = Copy-Paste Magic',
          description: 'Open Tasks and press Clone on an older support ticket. We copy every field—candidate, times, attachments—so you only tweak the new bits.',
          side: 'right'
        }
      });
    } else if (!canCloneFromTasks && cloneInfoElement) {
      steps.push({
        element: cloneInfoElement,
        popover: {
          title: 'Clones Handled By Recruiters',
          description: 'Only recruitment team members can duplicate tasks. Ping them when you need an older request copied into Branch Candidates.',
          side: 'right'
        }
      });
    }

    const includesElement = doc.querySelector('[data-tour-id="branch-table-area"]')
      || includesRef.current
      || doc.querySelector('[data-tour-id="branch-includes"]');
    if (includesElement) {
      steps.push({
        element: includesElement,
        popover: {
          title: 'What Branch Candidates Shows',
          description: 'Each row shows the person (Name), their skill (Technology), their helper (Expert), their owner (Recruiter), how to reach them (Email & Contact), and the action buttons.',
          side: 'top'
        }
      });
    }

    const resumeElement = resumeFieldRef.current;
    if (resumeElement) {
      steps.push({
        element: resumeElement,
        popover: {
          title: 'Resume Is A Must',
          description: 'Always attach the newest resume PDF before sending. No resume means no support email goes out.',
          side: 'top'
        }
      });
    }

    const userManagementElement = doc.querySelector('[data-tour-id="user-management-link"]') || introRef.current;
    if (userManagementElement) {
      steps.push({
        element: userManagementElement,
        popover: {
          title: 'User Management Playbook',
          description: 'Managers invite new teammates and reset passwords. MAM keeps recruiter lists tidy. MLead updates team leads or managers. Recruiters peek at their assignments without editing.',
          side: 'right'
        }
      });
    }

    const profileElement = doc.querySelector('[data-tour-id="profile-menu-trigger"]') || introRef.current;
    if (profileElement) {
      steps.push({
        element: profileElement,
        popover: {
          title: 'Optional: Polish Your Profile',
          description: 'Click your name, choose Edit Profile, and add display name, job role, phone, and website so support emails show a friendly signature.',
          side: 'left'
        }
      });
    }

    if (!steps.length) {
      return false;
    }

    driverInstance.setSteps(steps);
    driverInstance.drive(0);

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('branchCandidatesTourSeen', 'true');
      } catch {
        // Ignore storage failures
      }
    }

    return true;
  }, [tourEligible, canCloneFromTasks]);

  useEffect(() => {
    if (!tourEligible || hasAutoStarted.current || typeof window === 'undefined') {
      return;
    }

    let seen = false;
    try {
      seen = window.localStorage.getItem('branchCandidatesTourSeen') === 'true';
    } catch {
      seen = false;
    }

    if (seen) {
      hasAutoStarted.current = true;
      return;
    }

    hasAutoStarted.current = true;
    const timer = window.setTimeout(() => {
      const started = startTour();
      if (!started) {
        hasAutoStarted.current = false;
      }
    }, 600);

    return () => window.clearTimeout(timer);
  }, [tourEligible, startTour]);

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
          setCreatePolicy(DEFAULT_CREATE_POLICY);
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
          resumeLink: candidate.resumeLink || '',
          resumeUnderstanding: Boolean(candidate.resumeUnderstanding),
          resumeUnderstandingStatus: candidate.resumeUnderstandingStatus,
          workflowStatus: candidate.workflowStatus
        })));
        setRecruiterOptions(normalizeOptionList(resp.options?.recruiterChoices));
        setExpertOptions(normalizeOptionList(resp.options?.expertChoices));
        setCreatePolicy(normalizeCreatePolicy(resp.options?.createPolicy));

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
  }, [socket, normalizeOptionList, normalizeCreatePolicy]);

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

  useEffect(() => {
    if (!socket) {
      return;
    }

    if (!normalizedScope) {
      if (notificationSubscriptionRef.current) {
        socket.emit('candidateNotifications:unsubscribe', {
          subscriptionId: notificationSubscriptionRef.current
        });
        notificationSubscriptionRef.current = null;
      }
      lastScopeSignatureRef.current = 'none';
      return;
    }

    if (
      scopeSignature === lastScopeSignatureRef.current &&
      notificationSubscriptionRef.current
    ) {
      return;
    }

    if (notificationSubscriptionRef.current) {
      socket.emit('candidateNotifications:unsubscribe', {
        subscriptionId: notificationSubscriptionRef.current
      });
      notificationSubscriptionRef.current = null;
    }

    let cancelled = false;

    socket.emit('candidateNotifications:subscribe', { scope: normalizedScope }, (response: any) => {
      if (cancelled) {
        return;
      }

      if (response?.success && response.subscriptionId) {
        notificationSubscriptionRef.current = response.subscriptionId;
        lastScopeSignatureRef.current = scopeSignature;
      } else if (response?.error) {
        toast({
          title: 'Realtime updates unavailable',
          description: response.error,
          variant: 'destructive'
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [socket, normalizedScope, scopeSignature, toast]);

  useEffect(() => {
    if (!socket) {
      return;
    }
    return () => {
      if (notificationSubscriptionRef.current) {
        socket.emit('candidateNotifications:unsubscribe', {
          subscriptionId: notificationSubscriptionRef.current
        });
        notificationSubscriptionRef.current = null;
        lastScopeSignatureRef.current = 'none';
      }
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleNotification = (payload: CandidateNotificationPayload) => {
      if (!payload) {
        return;
      }

      const fallbackIdParts = [
        payload.candidateId,
        payload.category,
        payload.occurredAt
      ].filter(Boolean);
      const fallbackId = fallbackIdParts.join(':');
      const identifier = payload.notificationId || fallbackId;

      if (!identifier || processedNotificationsRef.current.has(identifier)) {
        return;
      }

      processedNotificationsRef.current.add(identifier);

      const occurredAt = payload.occurredAt || new Date().toISOString();
      const enriched: CandidateNotificationPayload = {
        ...payload,
        notificationId: identifier,
        occurredAt
      };

      setRecentNotifications((prev) => {
        const filtered = prev.filter((item) => item.notificationId !== enriched.notificationId);
        const next = [enriched, ...filtered];
        const limited = next.slice(0, 5);

        if (processedNotificationsRef.current.size > 100) {
          processedNotificationsRef.current = new Set(limited.map((item) => item.notificationId));
        }

        return limited;
      });

      const descriptionParts: string[] = [];
      if (enriched.candidateName) {
        descriptionParts.push(enriched.candidateName);
      }
      if (enriched.branch) {
        descriptionParts.push(enriched.branch);
      }
      if (enriched.triggeredBy) {
        descriptionParts.push(`by ${enriched.triggeredBy}`);
      }

      toast({
        title: enriched.message || 'Candidate update',
        description: descriptionParts.length ? descriptionParts.join(' • ') : undefined,
        duration: 4000
      });

      if (!notificationRefreshTimerRef.current) {
        notificationRefreshTimerRef.current = setTimeout(() => {
          notificationRefreshTimerRef.current = null;
          fetchCandidates();
        }, 700);
      }
    };

    socket.on('notifications:new', handleNotification);

    return () => {
      socket.off('notifications:new', handleNotification);
      if (notificationRefreshTimerRef.current) {
        clearTimeout(notificationRefreshTimerRef.current);
        notificationRefreshTimerRef.current = null;
      }
    };
  }, [socket, fetchCandidates, toast]);

  // Real-time status updates
  useEffect(() => {
    if (!socket) return;

    const handleStatusUpdate = (payload: any) => {
      const { candidate, newStatus } = payload;
      if (!candidate?.id || !newStatus) return;

      setCandidates((prev) => prev.map((c) =>
        c.id === candidate.id ? { ...c, status: newStatus } : c
      ));
    };

    const handleBulkStatusUpdate = (payload: any) => {
      const { ids, status } = payload;
      if (!Array.isArray(ids) || !status) return;

      const idSet = new Set(ids);
      setCandidates((prev) => prev.map((c) =>
        idSet.has(c.id) ? { ...c, status: status } : c
      ));
    };

    socket.on('candidateStatusUpdated', handleStatusUpdate);
    socket.on('bulkCandidateStatusUpdated', handleBulkStatusUpdate);

    return () => {
      socket.off('candidateStatusUpdated', handleStatusUpdate);
      socket.off('bulkCandidateStatusUpdated', handleBulkStatusUpdate);
    };
  }, [socket]);



  if (!canView) {
    return null;
  }

  const openEditDialog = (candidate: CandidateRow) => {
    setEditCandidateId(candidate.id);
    setFormState({
      name: titleCasePreserveSpacing(candidate.name || '').replace(/\s+/g, ' ').trim(),
      email: String(candidate.email || '').trim().toLowerCase(),
      technology: titleCasePreserveSpacing(candidate.technology || '').replace(/\s+/g, ' ').trim(),
      recruiter: String(candidate.recruiterRaw || '').trim().toLowerCase(),
      contact: candidate.contact || '',
      expert: String(candidate.expertRaw || '').trim().toLowerCase()
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
    setEditResumeFile(null);
    setEditResumeError('');
    setUpdating(false);
    setUpdateError('');
  };

  const resetCreateState = () => {
    setIsCreateOpen(false);
    setCreateForm({ name: '', email: '', technology: '', recruiter: '', branch: '', contact: '' });
    setCreateError('');
    setCreating(false);
    setCreateResumeFile(null);
    setCreateResumeError('');
  };

  const handleCreateFieldChange = (field: keyof typeof createForm, value: string) => {
    if (field === 'branch' && normalizedRole === 'mam' && createPolicy.branchReadOnly) {
      return;
    }
    let nextValue = value;
    if (field === 'name' || field === 'technology') {
      nextValue = titleCasePreserveSpacing(value);
    }
    if (['email', 'recruiter'].includes(field)) {
      nextValue = value.trim().toLowerCase();
    }
    if (field === 'branch') {
      nextValue = value.toUpperCase();
    }
    setCreateForm((prev) => ({ ...prev, [field]: nextValue }));
  };

  const handleCreateFieldBlur = (field: keyof typeof createForm) => {
    setCreateForm((prev) => {
      if (field === 'name' || field === 'technology') {
        return { ...prev, [field]: titleCasePreserveSpacing(prev[field]).replace(/\s+/g, ' ').trim() };
      }
      if (field === 'email' || field === 'recruiter') {
        return { ...prev, [field]: prev[field].trim().toLowerCase() };
      }
      if (field === 'contact') {
        return { ...prev, contact: prev.contact.trim() };
      }
      if (field === 'branch') {
        if (normalizedRole === 'mam' && createPolicy.branchReadOnly) {
          return prev;
        }
        return { ...prev, branch: prev.branch.trim().toUpperCase() };
      }
      return prev;
    });
  };

  const handleCreateResumeChange = (files: FileList | null) => {
    const file = files?.[0] ?? null;

    if (!file) {
      setCreateResumeFile(null);
      setCreateResumeError('Resume PDF is required');
      return;
    }

    if (file.type !== 'application/pdf') {
      setCreateResumeFile(null);
      setCreateResumeError('Resume must be a PDF file');
      return;
    }

    if (file.size > CREATE_RESUME_MAX_BYTES) {
      setCreateResumeFile(null);
      setCreateResumeError('Resume must be 5MB or smaller');
      return;
    }

    setCreateResumeFile(file);
    setCreateResumeError('');
  };

  const handleCreateCandidate = async () => {
    if (!socket) return;

    setCreating(true);
    setCreateError('');
    setCreateResumeError('');

    const trimmedName = titleCasePreserveSpacing(createForm.name).replace(/\s+/g, ' ').trim();
    const trimmedEmail = createForm.email.trim().toLowerCase();
    const trimmedTechnology = titleCasePreserveSpacing(createForm.technology).replace(/\s+/g, ' ').trim();
    const trimmedBranch = createForm.branch.trim().toUpperCase();
    const trimmedRecruiter = createForm.recruiter.trim().toLowerCase();
    const trimmedContact = createForm.contact.trim();
    const effectiveAllowedBranches = (createPolicy.allowedBranches || [...DEFAULT_ALLOWED_BRANCHES])
      .map((branch) => String(branch || '').trim().toUpperCase())
      .filter(Boolean);
    const allowedBranchSet = new Set(effectiveAllowedBranches.length > 0 ? effectiveAllowedBranches : [...DEFAULT_ALLOWED_BRANCHES]);
    const effectiveBranch = normalizedRole === 'mam' && createPolicy.branchReadOnly
      ? (createPolicy.defaultBranch || trimmedBranch).toUpperCase()
      : trimmedBranch;
    const recruiterAllowedSet = new Set(
      recruiterOptions
        .map((option) => String(option.value || '').trim().toLowerCase())
        .filter(Boolean)
    );

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

    if (normalizedRole === 'mam' && !createPolicy.canCreate) {
      setCreateError(createPolicy.reason || 'MAM branch mapping is missing. Contact admin.');
      setCreating(false);
      return;
    }

    if (!effectiveBranch) {
      setCreateError('Branch is required');
      setCreating(false);
      return;
    }

    if (!allowedBranchSet.has(effectiveBranch)) {
      setCreateError(`Branch must be one of ${Array.from(allowedBranchSet).join(', ')}`);
      setCreating(false);
      return;
    }

    if (!trimmedRecruiter || !EMAIL_REGEX.test(trimmedRecruiter)) {
      setCreateError('Please select a recruiter email');
      setCreating(false);
      return;
    }

    if (!recruiterAllowedSet.has(trimmedRecruiter)) {
      setCreateError('Please select an active recruiter from your hierarchy list');
      setCreating(false);
      return;
    }

    if (!createResumeFile) {
      setCreateResumeError('Resume PDF is required');
      setCreating(false);
      return;
    }

    let resumeLink = '';

    try {
      const formData = new FormData();
      formData.append('resume', createResumeFile);
      const response = await authFetch(`${API_URL}/api/candidates/resume`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!response.ok || !result?.success || !result?.resumeLink) {
        const message = result?.error || 'Unable to upload resume';
        throw new Error(message);
      }

      resumeLink = String(result.resumeLink);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to upload resume';
      setCreateError(message);
      setCreating(false);
      return;
    }

    const payload: Record<string, string> = {
      name: trimmedName,
      email: trimmedEmail,
      technology: trimmedTechnology,
      branch: effectiveBranch,
      recruiter: trimmedRecruiter,
      resumeLink
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
    if (field === 'name' || field === 'technology') {
      nextValue = titleCasePreserveSpacing(value);
    }
    if (field === 'recruiter' || field === 'expert' || field === 'email') {
      nextValue = value.trim().toLowerCase();
    }
    setFormState((prev) => ({ ...prev, [field]: nextValue }));
  };

  const handleFormBlur = (field: keyof typeof formState) => {
    setFormState((prev) => {
      if (field === 'name' || field === 'technology') {
        return { ...prev, [field]: titleCasePreserveSpacing(prev[field]).replace(/\s+/g, ' ').trim() };
      }
      if (field === 'email' || field === 'recruiter' || field === 'expert') {
        return { ...prev, [field]: prev[field].trim().toLowerCase() };
      }
      if (field === 'contact') {
        return { ...prev, contact: prev.contact.trim() };
      }
      return prev;
    });
  };

  const handleEditResumeChange = (files: FileList | null) => {
    const file = files?.[0] ?? null;

    if (!file) {
      setEditResumeFile(null);
      setEditResumeError('');
      return;
    }

    if (file.type !== 'application/pdf') {
      setEditResumeFile(null);
      setEditResumeError('Resume must be a PDF file');
      return;
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      setEditResumeFile(null);
      setEditResumeError('Resume must be 5MB or smaller');
      return;
    }

    setEditResumeFile(file);
    setEditResumeError('');
  };

  const handleUpdateCandidate = async () => {
    if (!socket || !editCandidateId) return;

    setUpdating(true);
    setUpdateError('');

    const payload: Record<string, string> = {
      candidateId: editCandidateId
    };

    if (canEditBasicFields) {
      const trimmedName = titleCasePreserveSpacing(formState.name).replace(/\s+/g, ' ').trim();
      const trimmedEmail = formState.email.trim().toLowerCase();
      const trimmedTechnology = titleCasePreserveSpacing(formState.technology).replace(/\s+/g, ' ').trim();

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

    // Handle Resume Update
    if (editResumeFile) {
      try {
        const formData = new FormData();
        formData.append('resume', editResumeFile);
        const response = await authFetch(`${API_URL}/api/candidates/resume`, {
          method: 'POST',
          body: formData
        });

        const result = await response.json();

        if (!response.ok || !result?.success || !result?.resumeLink) {
          const message = result?.error || 'Unable to upload resume';
          setUpdateError(message);
          setUpdating(false);
          return;
        }

        payload.resumeLink = String(result.resumeLink);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to upload resume';
        setUpdateError(message);
        setUpdating(false);
        return;
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

  const isAllSelected = filteredCandidates.length > 0 && selectedIds.size === filteredCandidates.length;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < filteredCandidates.length;

  // Scroll Observer for Lazy Loading
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (loading) {
      return;
    }

    const target = observerTarget.current;
    if (!target) {
      return;
    }

    observerRef.current?.disconnect();

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => {
            const next = prev + 20;
            return next >= filteredCandidates.length ? filteredCandidates.length : next;
          });
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(target);
    observerRef.current = observer;

    return () => observer.disconnect();
  }, [filteredCandidates.length, loading]);

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(20);
  }, [search, scope, candidates]);

  const visibleCandidates = useMemo(() => {
    return filteredCandidates?.slice(0, visibleCount) || [];
  }, [filteredCandidates, visibleCount]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div ref={introRef} data-tour-id="branch-tour-intro">
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
          <div className="flex items-center gap-2 self-stretch sm:self-auto">
            {tourEligible && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  startTour();
                }}
                data-tour-id="branch-tour-trigger"
              >
                Guided Tour
              </Button>
            )}
            {showCreateButton && (
              <Button
                size="sm"
                onClick={() => {
                  setCreateError('');
                  if (normalizedRole === 'mam' && !createPolicy.canCreate) {
                    toast({
                      title: 'Candidate creation unavailable',
                      description: createPolicy.reason || 'MAM branch mapping is missing. Contact admin.',
                      variant: 'destructive'
                    });
                    return;
                  }
                  setCreateForm((prev) => ({
                    ...prev,
                    branch: normalizedRole === 'mam'
                      ? (createPolicy.defaultBranch || prev.branch || '')
                      : (prev.branch || (scope?.type === 'branch' && scope.value
                        ? String(scope.value).toUpperCase()
                        : prev.branch))
                  }));
                  setIsCreateOpen(true);
                }}
              >
                Add Candidate
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent ref={includesRef} data-tour-id="branch-includes" className="space-y-4">
          <div
            ref={updatesRef}
            data-tour-id="branch-latest-updates"
            className="rounded-xl border border-primary/40 bg-primary/5 p-4 shadow-[0_0_20px_rgba(59,130,246,0.25)] animate-[pulse_4s_ease-in-out_infinite]"
          >
            <p className="font-semibold text-sm text-primary">Latest Updates</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li data-tour-id="branch-support-highlight">
                • <span className="text-primary font-medium">Support button</span>: press it when you want our ops team to set up an interview email for this candidate.
              </li>
              <li data-tour-id="branch-auto-email">
                • <span className="text-primary font-medium">Emails send themselves</span>: once you hit Send, the system emails the interview details automatically—no manual follow-up.
              </li>
              {canCloneFromTasks ? (
                <li data-tour-id="branch-clone-highlight">
                  • <span className="text-primary font-medium">Clone magic</span>: on the Tasks page, tap Clone on an old request and we copy the details into the support form for you.
                </li>
              ) : (
                <li data-tour-id="branch-clone-highlight">
                  • <span className="text-primary font-medium">Clone magic</span>: only recruitment team members can duplicate tasks. Ask them when you need the same support details again.
                </li>
              )}
              <li>
                • <span className="text-primary font-medium">Loop Scheduler</span>: add multiple slots for loop rounds—each slot sends its own support email.
              </li>
              <li>
                • Attachments stay with the cloned draft so repeat requests only need edits, not re-uploads.
              </li>
            </ul>
          </div>

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

          {selectedIds.size > 0 && canEdit && (
            <div className="flex items-center gap-4 rounded-md border border-primary/20 bg-primary/5 p-3">
              <span className="text-sm font-medium">{selectedIds.size} candidates selected</span>
              <Select
                value={bulkStatus}
                onValueChange={(val) => {
                  setBulkStatus(val);
                  if (val) handleBulkStatusUpdate(val);
                }}
                disabled={bulkUpdating}
              >
                <SelectTrigger className="w-[180px] h-8 bg-background">
                  <SelectValue placeholder="Update Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Hold">Hold</SelectItem>
                  <SelectItem value="Low Priority">Low Priority</SelectItem>
                  <SelectItem value="Backout">Backout</SelectItem>
                  <SelectItem value="Placement Offer">Placement Offer</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleSelectAll(false)}
                disabled={bulkUpdating}
                className="ml-auto"
              >
                Clear Selection
              </Button>
              {bulkUpdating && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            </div>
          )}

          {recentNotifications.length > 0 && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-primary">Live notifications</p>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setRecentNotifications([]);
                    processedNotificationsRef.current = new Set();
                  }}
                >
                  Clear
                </Button>
              </div>
              <ul className="mt-3 space-y-3">
                {recentNotifications.map((notification) => (
                  <li key={notification.notificationId} className="text-sm leading-snug">
                    <p className="font-semibold text-primary">
                      {DOMPurify.sanitize(notification.candidateName || 'Candidate')}
                    </p>
                    <p className="text-muted-foreground">
                      {DOMPurify.sanitize(notification.message || '')}
                    </p>
                    <p className="text-xs text-muted-foreground">


                      {notification.occurredAt ? moment(notification.occurredAt).fromNow() : 'just now'}
                    </p>
                  </li>
                ))}
              </ul >
            </div >
          )
          }

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
            <div className="overflow-x-auto" data-tour-id="branch-table-area">
              <Table>
                <TableHeader>
                  <TableRow>
                    {canEdit && (
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={filteredCandidates.length > 0 && selectedIds.size === filteredCandidates.length}
                          onCheckedChange={(checked) => handleSelectAll(!!checked)}
                        />
                      </TableHead>
                    )}
                    <TableHead>Candidate</TableHead>
                    <TableHead>Technology</TableHead>
                    <TableHead>Expert</TableHead>
                    <TableHead>Recruiter</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCandidates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={canEdit ? 7 : 6} className="text-center h-24">
                        No candidates found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleCandidates.map((candidate) => (
                      <TableRow
                        key={candidate.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => openCandidateSheet(candidate)}
                      >
                        {canEdit && (
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedIds.has(candidate.id)}
                              onCheckedChange={(checked) => handleSelectRow(candidate.id, !!checked)}
                            />
                          </TableCell>
                        )}
                        <TableCell className="font-medium">
                          <div>{DOMPurify.sanitize(candidate.name || '')}</div>
                        </TableCell>
                        <TableCell>{DOMPurify.sanitize(candidate.technology || '')}</TableCell>
                        <TableCell>{DOMPurify.sanitize(candidate.expert || '-')}</TableCell>
                        <TableCell>{DOMPurify.sanitize(candidate.recruiter || '-')}</TableCell>
                        <TableCell>
                          <div onClick={(e) => e.stopPropagation()}>
                            <StatusBadge
                              status={candidate.status}
                              candidateId={candidate.id}
                              canEdit={['recruiter', 'mlead', 'mam', 'mm', 'lead', 'am', 'admin', 'manager'].includes(normalizedRole)}
                              onUpdate={handleStatusUpdate}
                              className="w-fit"
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="relative"
                                  onClick={(e) => { e.stopPropagation(); openDiscussionDrawer(candidate); }}
                                >
                                  <MessageSquare className="h-4 w-4" />
                                  {notifications.some(n => n.candidateId === candidate.id && n.type === 'comment' && !n.read) && (
                                    <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500" />
                                  )}
                                  <span className="sr-only">Discussion</span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Discussion</TooltipContent>
                            </Tooltip>

                            {canSendSupport && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={(e) => { e.stopPropagation(); openMockDialog(candidate); }}
                                  >
                                    <BookOpen className="h-4 w-4" />
                                    <span className="sr-only">Mock Interview</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Request Mock Interview</TooltipContent>
                              </Tooltip>
                            )}

                            {canEdit && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditCandidateId(candidate.id);
                                      setFormState({
                                        name: candidate.name,
                                        email: candidate.email,
                                        technology: candidate.technology,
                                        recruiter: candidate.recruiterRaw || '',
                                        contact: candidate.contact,
                                        expert: candidate.expertRaw || ''
                                      });
                                      setIsEditOpen(true);
                                    }}
                                  >
                                    <span className="sr-only">Edit</span>
                                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.8536 1.14645C11.6583 0.951184 11.3417 0.951184 11.1465 1.14645L3.71455 8.57836C3.62459 8.66832 3.55263 8.77461 3.50251 8.89291L2.09545 12.213C1.98939 12.4633 2.05284 12.7508 2.25752 12.9372C2.4622 13.1235 2.77259 13.1613 3.01633 13.0298L6.28913 11.2678C6.39803 11.2092 6.49479 11.1278 6.57469 11.0292L13.8536 3.85355C14.0488 3.65829 14.0488 3.34171 13.8536 3.14645L11.8536 1.14645ZM4.42166 9.28547L11.5 2.20711L12.7929 3.5L5.71455 10.5784L4.21924 11.3831L4.42166 9.28547Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path></svg>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Edit Candidate</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              {visibleCount < filteredCandidates.length && (
                <div ref={observerTarget} className="h-10 flex items-center justify-center p-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          )}
        </CardContent>
        {canEdit && (
          <Dialog open={isEditOpen} onOpenChange={(open) => (!open ? resetEditState() : setIsEditOpen(true))}>
            <DialogContent className="w-full max-h-[90vh] sm:max-h-[85vh] overflow-y-auto scroll-area sm:max-w-[560px]">
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
                    onBlur={() => handleFormBlur('name')}
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
                    onBlur={() => handleFormBlur('email')}
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
                    onBlur={() => handleFormBlur('technology')}
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
                      onBlur={() => handleFormBlur('contact')}
                      placeholder="Contact number"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Contact</Label>
                    <Input value={formState.contact || ''} disabled />
                  </div>
                )}
                {canEditBasicFields && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-resume">Update Resume (PDF)</Label>
                    <Input
                      id="edit-resume"
                      type="file"
                      accept="application/pdf"
                      onChange={(event) => handleEditResumeChange(event.target.files)}
                    />
                    {editResumeFile && (
                      <p className="text-xs text-muted-foreground">{editResumeFile.name}</p>
                    )}
                    {editResumeError && <p className="text-xs text-destructive">{editResumeError}</p>}
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
      {selectedSheetCandidate && (
        <Sheet open={!!selectedSheetCandidate} onOpenChange={(open) => !open && setSelectedSheetCandidate(null)}>
          <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>{selectedSheetCandidate.name}</SheetTitle>
              <SheetDescription>
                {selectedSheetCandidate.technology} — {selectedSheetCandidate.branch}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-6">
              {/* Status Section */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Status</span>
                <StatusBadge
                  status={selectedSheetCandidate.status}
                  candidateId={selectedSheetCandidate.id}
                  canEdit={['recruiter', 'mlead', 'mam', 'mm', 'admin'].includes(normalizedRole)}
                  onUpdate={handleStatusUpdate}
                />
              </div>
              <Separator />

              {/* Contact Info */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Contact Details</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground block text-xs">Email</span>
                    <div className="truncate" title={selectedSheetCandidate.email}>{selectedSheetCandidate.email}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs">Phone</span>
                    <div>{selectedSheetCandidate.contact || '-'}</div>
                  </div>
                </div>
              </div>
              <Separator />

              {/* Team Info */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Team Allocation</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground block text-xs">Expert</span>
                    <div className="truncate">{selectedSheetCandidate.expert || '-'}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs">Recruiter</span>
                    <div className="truncate">{selectedSheetCandidate.recruiter || '-'}</div>
                  </div>
                </div>
              </div>
              <Separator />

              {/* Resume Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Resume</h4>
                  {['mm', 'mam', 'mlead', 'recruiter', 'admin'].includes(normalizedRole) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => handleResumeUnderstandingTrigger(selectedSheetCandidate.id)}
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      Send to Resume Understanding
                    </Button>
                  )}
                </div>
                {selectedSheetCandidate.resumeLink ? (
                  <a
                    href={selectedSheetCandidate.resumeLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-3 border rounded-md hover:bg-muted transition-colors text-sm text-primary"
                  >
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 3.5C3 2.67157 3.67157 2 4.5 2H10.5C11.3284 2 12 2.67157 12 3.5V11.5C12 12.3284 11.3284 13 10.5 13H4.5C3.67157 13 3 12.3284 3 11.5V3.5ZM4.5 3C4.22386 3 4 3.22386 4 3.5V11.5C4 11.7761 4.22386 12 4.5 12H10.5C10.7761 12 11 11.7761 11 11.5V3.5C11 3.22386 10.7761 3 10.5 3H4.5ZM6 5.5C6 5.22386 6.22386 5 6.5 5H8.5C8.77614 5 9 5.22386 9 5.5C9 5.77614 8.77614 6 8.5 6H6.5C6.22386 6 6 5.77614 6 5.5ZM6 7.5C6 7.22386 6.22386 7 6.5 7H8.5C8.77614 7 9 7.22386 9 7.5C9 7.77614 8.77614 8 8.5 8H6.5C6.22386 8 6 7.77614 6 7.5ZM6 9.5C6 9.22386 6.22386 9 6.5 9H8.5C8.77614 9 9 9.22386 9 9.5C9 9.77614 8.77614 10 8.5 10H6.5C6.22386 10 6 9.77614 6 9.5Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path></svg>
                    View / Download Resume
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No resume uploaded.</p>
                )}
              </div>
              <Separator />

              {/* Actions */}
              {(canEdit || canSendSupport) && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Actions</h4>
                  <div className="flex flex-wrap gap-2">
                    {canSendSupport && (
                      <Button
                        onClick={() => {
                          // openSupportDialog uses state, so we update state then open
                          openSupportDialog(selectedSheetCandidate);
                        }}
                        className="flex-1"
                      >
                        Request Support
                      </Button>
                    )}
                    {canSendSupport && (
                      <Button
                        variant="secondary"
                        onClick={() => openMockDialog(selectedSheetCandidate)}
                        className="flex-1"
                      >
                        Request Mock
                      </Button>
                    )}
                    {canSendSupport && (
                      <Button
                        variant="outline"
                        onClick={() => openAssessmentDialog(selectedSheetCandidate)}
                        className="flex-1"
                      >
                        Send Assessment
                      </Button>
                    )}
                    {['recruiter', 'mlead', 'mam', 'mm', 'admin'].includes(normalizedRole) && (
                      <Button
                        variant="secondary"
                        className="w-full sm:w-auto"
                        onClick={() => {
                          if (selectedSheetCandidate?.id) {
                            handleResumeUnderstandingTrigger(selectedSheetCandidate.id);
                            navigate(`/resume-understanding?discussion=${encodeURIComponent(selectedSheetCandidate.email)}`);
                          }
                        }}
                      >
                        Resume Understanding
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
      {showCreateButton && (
        <Dialog open={isCreateOpen} onOpenChange={(open) => (!open ? resetCreateState() : setIsCreateOpen(true))}>
          <DialogContent className="w-full max-h-[90vh] sm:max-h-[85vh] overflow-y-auto scroll-area sm:max-w-[560px]">
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
                  onBlur={() => handleCreateFieldBlur('name')}
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
                  onBlur={() => handleCreateFieldBlur('email')}
                  placeholder="candidate@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-technology">Technology</Label>
                <Input
                  id="create-technology"
                  value={createForm.technology}
                  onChange={(event) => handleCreateFieldChange('technology', event.target.value)}
                  onBlur={() => handleCreateFieldBlur('technology')}
                  placeholder="Primary technology"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-branch">Branch</Label>
                <Input
                  id="create-branch"
                  value={createForm.branch}
                  onChange={(event) => handleCreateFieldChange('branch', event.target.value)}
                  onBlur={() => handleCreateFieldBlur('branch')}
                  placeholder="e.g., GGR"
                  readOnly={normalizedRole === 'mam' && createPolicy.branchReadOnly}
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
                  onBlur={() => handleCreateFieldBlur('contact')}
                  placeholder="Contact number"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-resume">Resume (PDF)</Label>
                <Input
                  id="create-resume"
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => handleCreateResumeChange(event.target.files)}
                />
                {createResumeFile && (
                  <p className="text-xs text-muted-foreground">{createResumeFile.name}</p>
                )}
                {createResumeError && <p className="text-xs text-destructive">{createResumeError}</p>}
              </div>
              {createError && <p className="text-sm text-destructive">{createError}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetCreateState} disabled={creating}>
                Cancel
              </Button>
              <Button onClick={handleCreateCandidate} disabled={creating || recruiterOptions.length === 0 || !createResumeFile || (normalizedRole === 'mam' && !createPolicy.canCreate)}>
                {creating ? 'Submitting…' : 'Submit Candidate'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {canSendSupport && (
        <Dialog open={assessmentOpen} onOpenChange={(open) => (!open ? resetAssessmentState() : setAssessmentOpen(true))}>
          <DialogContent className="w-full max-h-[90vh] sm:max-h-[85vh] overflow-y-auto scroll-area sm:max-w-[660px] xl:max-w-[740px]">
            <DialogHeader>
              <DialogTitle>Request Assessment Support</DialogTitle>
              <DialogDescription>
                Share the assessment receipt details, highlight critical timelines, and attach the required files for the ops team.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="assessment-candidate-name">Candidate Name</Label>
                  <Input id="assessment-candidate-name" value={assessmentForm.candidateName} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assessment-technology">Technology</Label>
                  <Input id="assessment-technology" value={assessmentForm.technology} disabled />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="assessment-email">Email ID</Label>
                  <Input id="assessment-email" value={assessmentForm.email} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assessment-contact">Contact Number</Label>
                  <Input id="assessment-contact" value={assessmentForm.contactNumber} readOnly className="bg-muted" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="assessment-additional-info">Additional Info</Label>
                <textarea
                  id="assessment-additional-info"
                  value={assessmentForm.additionalInfo}
                  onChange={(event) => handleAssessmentFieldChange('additionalInfo', event.target.value)}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  rows={3}
                  placeholder="Share any priorities, blockers, or context to show above the summary table."
                  disabled={assessmentSubmitting}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="assessment-client">End Client</Label>
                  <Input
                    id="assessment-client"
                    value={assessmentForm.endClient}
                    onChange={(event) => handleAssessmentFieldChange('endClient', event.target.value)}
                    placeholder="Client name"
                    disabled={assessmentSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assessment-job-title">Job Title</Label>
                  <Input
                    id="assessment-job-title"
                    value={assessmentForm.jobTitle}
                    onChange={(event) => handleAssessmentFieldChange('jobTitle', event.target.value)}
                    placeholder="Role title"
                    disabled={assessmentSubmitting}
                  />
                </div>
              </div>
              <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
                <Label htmlFor="assessment-date" className="font-semibold text-amber-900">
                  Assessment Received Date &amp; Time (EST)
                </Label>
                <p className="text-xs text-amber-900 opacity-80">This timestamp is highlighted in the support email subject and summary.</p>
                <div className="mt-3 grid gap-2 sm:flex sm:items-center sm:gap-4">
                  <Popover open={assessmentDatePickerOpen} onOpenChange={setAssessmentDatePickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        id="assessment-date"
                        variant="outline"
                        className={cn(
                          "justify-start text-left font-normal",
                          !assessmentDate && "text-muted-foreground"
                        )}
                        disabled={assessmentSubmitting}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {assessmentDate ? moment(assessmentDate).format('MMM DD, YYYY') : 'Pick a date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={assessmentDate ?? undefined}
                        onSelect={handleAssessmentDateSelect}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <Input
                    id="assessment-time"
                    value={assessmentTimeInput}
                    onChange={(event) => handleAssessmentTimeChange(event.target.value)}
                    placeholder="HH:MM AM"
                    disabled={assessmentSubmitting}
                    className="sm:max-w-[160px]"
                  />
                </div>
                {assessmentTimeWarning && (
                  <p className="mt-2 text-xs font-medium text-red-600">{assessmentTimeWarning}</p>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="assessment-duration">Assessment Duration (minutes)</Label>
                  <Input
                    id="assessment-duration"
                    value={assessmentForm.assessmentDuration}
                    onChange={(event) => handleAssessmentFieldChange('assessmentDuration', event.target.value)}
                    placeholder="e.g., 60"
                    disabled={assessmentSubmitting || assessmentNoDuration}
                    inputMode="numeric"
                  />
                </div>
                <div className="flex items-center gap-2 pt-2 sm:pt-0">
                  <Checkbox
                    id="assessment-no-duration"
                    checked={assessmentNoDuration}
                    onCheckedChange={(value) => {
                      const isChecked = value === true;
                      setAssessmentNoDuration(isChecked);
                      if (isChecked) {
                        setAssessmentForm((prev) => ({ ...prev, assessmentDuration: '' }));
                      }
                    }}
                    disabled={assessmentSubmitting}
                  />
                  <Label htmlFor="assessment-no-duration" className="text-sm">
                    No duration mentioned
                  </Label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="assessment-screening"
                  checked={assessmentScreeningDone}
                  onCheckedChange={(value) => setAssessmentScreeningDone(value === true)}
                  disabled={assessmentSubmitting}
                />
                <Label htmlFor="assessment-screening" className="text-sm">
                  Screening completed
                </Label>
              </div>
              {assessmentScreeningDone && (
                <p className="text-sm font-semibold text-red-600">
                  Screening is done so prioritize this task.
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="assessment-resume">Attach Resume — required</Label>
                  <Input
                    id="assessment-resume"
                    type="file"
                    onChange={(event) => handleAssessmentFileChange('resume', event.target.files)}
                    disabled={assessmentSubmitting}
                  />
                  {assessmentResumeFile ? (
                    <p className="text-xs text-muted-foreground">{assessmentResumeFile.name}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Upload the latest candidate resume.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assessment-info">Attach Assessment Info — required</Label>
                  <Input
                    id="assessment-info"
                    type="file"
                    onChange={(event) => handleAssessmentFileChange('assessmentInfo', event.target.files)}
                    disabled={assessmentSubmitting}
                  />
                  {assessmentInfoFile ? (
                    <p className="text-xs text-muted-foreground">{assessmentInfoFile.name}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Include feedback or assessment results.</p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="assessment-additional">Additional Attachments</Label>
                <Input
                  id="assessment-additional"
                  type="file"
                  multiple
                  onChange={(event) => handleAssessmentFileChange('additionalAttachments', event.target.files)}
                  disabled={assessmentSubmitting}
                />
                {assessmentAdditionalFiles.length > 0 && (
                  <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                    {assessmentAdditionalFiles.map((file) => (
                      <li key={file.name}>{file.name}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="assessment-job-description">Job Description (text)</Label>
                <textarea
                  id="assessment-job-description"
                  value={assessmentForm.jobDescriptionText}
                  onChange={(event) => handleAssessmentFieldChange('jobDescriptionText', event.target.value)}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  rows={5}
                  placeholder="Paste the relevant JD context, or leave blank if the documents cover it."
                  disabled={assessmentSubmitting}
                />
              </div>
              {assessmentError && <p className="text-sm text-destructive">{assessmentError}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetAssessmentState} disabled={assessmentSubmitting}>
                Cancel
              </Button>
              <Button onClick={handleAssessmentSubmit} disabled={assessmentSubmitting}>
                {assessmentSubmitting ? 'Sending…' : 'Send Assessment Support'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {canSendSupport && (
        <Dialog open={supportOpen} onOpenChange={(open) => (!open ? resetSupportState() : setSupportOpen(true))}>
          <DialogContent className="w-full max-h-[90vh] sm:max-h-[85vh] overflow-y-auto scroll-area sm:max-w-[680px] xl:max-w-[760px]">
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
                  {!isLoopRound ? (
                    <>
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
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Manage duration for each loop slot below.</p>
                  )}
                </div>
              </div>
              {isLoopRound ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold">Loop slots</Label>
                    <Button type="button" size="sm" variant="secondary" onClick={handleAddLoopSlot} disabled={supportSubmitting}>
                      Add slot
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {loopSlots.map((slot, index) => (
                      <div
                        key={slot.id}
                        className="rounded-md border border-border/50 bg-muted/30 p-4 shadow-sm"
                      >
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.98fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] lg:items-start">
                          <div className="space-y-2">
                            <Label>{`Date ${index + 1} (EST)`}</Label>
                            <Popover open={slot.isDatePickerOpen} onOpenChange={(open) => handleLoopSlotDatePickerToggle(slot.id, open)}>
                              <PopoverTrigger asChild>
                                <div className="relative">
                                  <Input
                                    readOnly
                                    value={slot.date ? moment(slot.date).tz(EST_TIMEZONE).format('MMM D, YYYY') : ''}
                                    placeholder="Select date"
                                    disabled={supportSubmitting}
                                    className={cn(!slot.date && "text-muted-foreground", 'pr-10 cursor-pointer')}
                                  />
                                  <CalendarIcon className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                                </div>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                  mode="single"
                                  selected={slot.date ?? undefined}
                                  onSelect={(date) => handleLoopSlotDateChange(slot.id, date ?? undefined)}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="space-y-2">
                            <Label>Start Time (EST)</Label>
                            <Input
                              value={slot.timeInput}
                              onChange={(event) => handleLoopSlotTimeChange(slot.id, event.target.value)}
                              placeholder="e.g., 03:15 PM"
                              disabled={supportSubmitting}
                            />
                            {slot.timeWarning && (
                              <p className="text-xs text-destructive">{slot.timeWarning}</p>
                            )}
                          </div>
                          <div className="space-y-2 lg:pt-[1.75rem]">
                            <Label className="lg:sr-only">Choose preset</Label>
                            <Select
                              value={slot.timeValue}
                              onValueChange={(value) => handleLoopSlotTimeChange(slot.id, moment(value, 'HH:mm').format('hh:mm A'))}
                              disabled={supportSubmitting}
                            >
                              <SelectTrigger className="w-full">
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
                          </div>
                          <div className="space-y-2">
                            <Label>Duration (minutes)</Label>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <Input
                                value={slot.duration}
                                onChange={(event) => handleLoopSlotDurationChange(slot.id, event.target.value)}
                                placeholder="e.g., 60"
                                type="number"
                                min={5}
                                step={5}
                                inputMode="numeric"
                                disabled={supportSubmitting}
                                className="sm:max-w-[8rem]"
                              />
                              {loopSlots.length > 1 && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleRemoveLoopSlot(slot.id)}
                                  disabled={supportSubmitting}
                                  className="sm:self-start"
                                >
                                  Remove
                                </Button>
                              )}
                            </div>
                            {slot.durationWarning && (
                              <p className="text-xs text-destructive">{slot.durationWarning}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
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
                </>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div
                  className="space-y-2"
                  ref={resumeFieldRef}
                  data-tour-id="branch-resume-field"
                >
                  <Label htmlFor="support-resume">Attach Resume (PDF) — required</Label>
                  <Input
                    id="support-resume"
                    type="file"
                    accept="application/pdf"
                    onChange={(event) => handleSupportFileChange('resume', event.target.files)}
                    disabled={supportSubmitting}
                  />
                  {resumeFile ? (
                    <p className="text-xs text-muted-foreground">{resumeFile.name}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Upload the latest resume before you press Send.</p>
                  )}
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
              <div className="space-y-2">
                <Label htmlFor="support-custom-message">Reason for support (optional)</Label>
                <textarea
                  id="support-custom-message"
                  value={customMessage}
                  onChange={(event) => handleCustomMessageChange(event.target.value)}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  rows={4}
                  placeholder="Share any context or notes for the support team"
                  disabled={supportSubmitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="support-jd-text">Job description (text)</Label>
                <textarea
                  id="support-jd-text"
                  value={jobDescriptionText}
                  onChange={(event) => setJobDescriptionText(event.target.value)}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  rows={6}
                  placeholder="Paste or type the job description details"
                  disabled={supportSubmitting}
                />
              </div>

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
      {canSendSupport && (
        <Dialog open={mockOpen} onOpenChange={(open) => (!open ? resetMockState() : setMockOpen(true))}>
          <DialogContent className="w-full max-h-[90vh] sm:max-h-[85vh] overflow-y-auto scroll-area sm:max-w-[680px]">
            <DialogHeader>
              <DialogTitle>Request Mock Interview</DialogTitle>
              <DialogDescription>
                Schedule a mock interview for the candidate.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Candidate Name</Label>
                  <Input value={mockForm.candidateName} disabled />
                </div>
                <div className="space-y-2">
                  <Label>Technology</Label>
                  <Input value={mockForm.technology} disabled />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={mockForm.candidateEmail} disabled />
                </div>
                <div className="space-y-2">
                  <Label>Contact Number</Label>
                  <Input value={mockForm.contactNumber} disabled />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>End Client</Label>
                  <Input
                    value={mockForm.endClient}
                    onChange={(e) => setMockForm(prev => ({ ...prev, endClient: e.target.value }))}
                    placeholder="Client Name"
                    disabled={mockSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Mock Round</Label>
                  <Select
                    value={mockForm.interviewRound}
                    onValueChange={(value) => setMockForm(prev => ({ ...prev, interviewRound: value }))}
                    disabled={mockSubmitting}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select round" />
                    </SelectTrigger>
                    <SelectContent>
                      {MOCK_ROUNDS.map((round) => (
                        <SelectItem key={round} value={round}>
                          {round}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Proposed Date (EST)</Label>
                  <Popover open={mockDatePickerOpen} onOpenChange={setMockDatePickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant={"outline"}
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !mockDate && "text-muted-foreground"
                        )}
                        disabled={mockSubmitting}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {mockDate ? moment(mockDate).format("MMM D, YYYY") : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={mockDate ?? undefined}
                        onSelect={(date) => {
                          setMockDate(date ?? null);
                          setMockDatePickerOpen(false);
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Proposed Time (EST)</Label>
                  <Select
                    value={mockTime}
                    onValueChange={setMockTime}
                    disabled={mockSubmitting}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a time" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {DISPLAY_TIME_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Attach Resume (Optional if already on profile)</Label>
                <Input
                  type="file"
                  onChange={(e) => setMockResumeFile(e.target.files?.[0] || null)}
                  disabled={mockSubmitting}
                />
                {mockResumeFile && <p className="text-xs text-muted-foreground">{mockResumeFile.name}</p>}
              </div>

              <div className="space-y-2">
                <Label>Attach Job Description (PDF) - Optional</Label>
                <Input
                  type="file"
                  onChange={(e) => setMockJdFile(e.target.files?.[0] || null)}
                  disabled={mockSubmitting}
                />
                {mockJdFile && <p className="text-xs text-muted-foreground">{mockJdFile.name}</p>}
              </div>

              <div className="space-y-2">
                <Label>Job Description (Text)</Label>
                <textarea
                  value={mockForm.jobDescriptionText}
                  onChange={(e) => setMockForm(prev => ({ ...prev, jobDescriptionText: e.target.value }))}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  rows={5}
                  placeholder="Paste JD text here..."
                  disabled={mockSubmitting}
                />
              </div>

              {mockError && <p className="text-sm text-destructive">{mockError}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetMockState} disabled={mockSubmitting}>
                Cancel
              </Button>
              <Button onClick={handleMockSubmit} disabled={mockSubmitting}>
                {mockSubmitting ? 'Sending...' : 'Request Mock'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Discussion Drawer */}
      {discussionCandidate && (
        <ResumeDiscussionDrawer
          isOpen={discussionOpen}
          onClose={() => { setDiscussionOpen(false); setDiscussionCandidate(null); }}
          candidateId={discussionCandidate.id}
          candidateName={discussionCandidate.name}
        />
      )}
    </>
  );
}
