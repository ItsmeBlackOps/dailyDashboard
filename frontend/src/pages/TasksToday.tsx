// src/components/TasksToday.tsx
import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import DOMPurify from "dompurify";
import moment, { Moment } from "moment-timezone";
import { io, Socket } from "socket.io-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useToast } from "@/hooks/use-toast";
import { useAuth, API_URL } from "@/hooks/useAuth";
import { playTune, sendNotification } from "@/utils/notify";
import { Toaster } from "@/components/ui/toaster";
import { useTab } from "@/hooks/useTabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { DashboardFilters, type DashboardFilterState } from "@/components/dashboard/DashboardFilters";
import { buildDashboardPayload } from "@/components/dashboard/dashboardUtils";
import { computeDayRange, DEFAULT_TIMEZONE } from "@/utils/dateRanges";
import { useMsal } from "@azure/msal-react";
import type { AccountInfo, AuthenticationResult } from "@azure/msal-browser";
import { loginRequest } from "@/authConfig";
import { API_BASE, API_SCOPE, AZURE_CLIENT_ID } from "@/constants";
import { acquireBackendToken } from "@/tokens";
import { checkMeetingConsent, openConsentAndPoll } from "@/meetings/meetingsConsent";
import { useOnlineMeetingConsent } from "@/hooks/useOnlineMeetingConsent";
import { OnlineMeetingConsentBanner } from "@/components/OnlineMeetingConsentBanner";
import { Copy, Filter } from "lucide-react";
import { deriveDisplayNameFromEmail, formatNameInput } from "@/utils/userNames";
import { useNavigate } from "react-router-dom";
import { GRAPH_MAIL_SCOPES } from "@/constants";

type CloneAttachmentCategory = "resume" | "jobDescription" | "additional";

interface TaskAttachment {
  name: string;
  url?: string;
  category?: string;
  type?: string;
  data?: string;
}

interface Task {
  _id: string;
  subject?: string;
  candidateExpertDisplay?: string | null;
  suggestions?: string[];
  joinUrl?: string | null;
  joinWebUrl?: string | null;

  attachments?: TaskAttachment[];
  jobDescriptionText?: string;

  // Preferred keys (if available)
  startTime?: string; // "MM/DD/YYYY HH:mm" or ISO
  endTime?: string;
  receivedDateTime?: string;

  // Legacy keys (fallbacks)
  "Candidate Name"?: string;
  "Date of Interview"?: string;
  "Start Time Of Interview"?: string;
  "End Time Of Interview"?: string;
  "End Client"?: string;
  "Interview Round"?: string;
  "Contact No"?: string;
  "Technology"?: string;
  "Job Title"?: string;

  status?: string;
  "Email ID"?: string;
  assignedExpert?: string;
  recruiterName?: string;
  transcription?: boolean;
}

interface ManageableUser {
  email: string;
  role: string;
  teamLead?: string | null;
  manager?: string | null;
  active?: boolean;
}

interface TeamLeadEntry {
  label: string;
  role: string;
  recruiters: string[];
  mleadNames: string[];
}

interface SupportCloneDraftPayload {
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
  jobDescriptionText?: string;
  attachments?: Array<{
    name: string;
    url?: string;
    category?: CloneAttachmentCategory;
    type?: string;
    data?: string;
  }>;
  storedAt: string;
  storedBy?: string;
}

interface SupportMockAttachment {
  name: string;
  type?: string;
  category?: string;
  data?: string;
}

interface SupportMockStoredEntry {
  candidateName: string;
  candidateEmail: string;
  contactNumber?: string;
  technology?: string;
  endClient?: string;
  interviewRound?: string;
  interviewDateTime?: string;
  attachments?: SupportMockAttachment[];
  jobDescriptionText?: string;
  sourceTaskId?: string;
  storedAt: string;
  storedBy?: string;
}

interface MockPreviewState {
  candidateName: string;
  candidateEmail: string;
  technology: string;
  contactNumber: string;
  endClient: string;
  interviewRound: string;
  interviewDateTimeIso: string;
  interviewDisplay: string;
  storedAttachments: SupportMockAttachment[];
  jobDescriptionText: string;
  sourceTaskId?: string;
  storedBy?: string;
}

interface ThanksMailEntry {
  content: string;
  html?: string;
  generatedAt: string;
}

const TASK_STATUS_MAP = "tasksTodayStatusMap";
const TZ = "America/New_York";
const WINDOWS_TZ = "Eastern Standard Time"; // Teams/Outlook expect Windows TZ names
const PARSE_FMT = "MM/DD/YYYY HH:mm"; // 24h parsing for preferred keys
const LEGACY_FMT = "MM/DD/YYYY hh:mm A"; // legacy input format
const DATE_FMT = "MM/DD/YYYY";
const TIME_FMT = "hh:mm A";
const SUPPORT_CLONE_STORAGE_KEY = "supportCloneDraft";
const SUPPORT_MOCK_STORAGE_KEY = "supportMockMaterials";
const MAX_INLINE_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const MAX_STORED_MOCK_ENTRIES = 5;
const THANKS_MAIL_CACHE_KEY = "thanksMailDrafts";
const MAX_STORED_THANKS_ENTRIES = 20;
const THANKS_MAIL_LIMIT = 3;
const THANKS_MAIL_WINDOW_HOURS = 6;

// Reminder persistence keys
const REM_SCHEDULE_KEY = "interviewRemindersScheduled"; // JSON: { [key]: triggerAtISO }
const REM_FIRED_KEY = "interviewRemindersFired"; // JSON: string[]

// Reminder settings
const MINUTES_BEFORE = 35;
const MAX_DELAY = 2147483647; // ~24.85 days (2^31 - 1)

export default function TasksToday() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filterStatus, setFilterStatus] = useState("all");
  const [candidateFilter, setCandidateFilter] = useState("");
  const [recruiterFilter, setRecruiterFilter] = useState("");
  const [expertFilter, setExpertFilter] = useState("");
  const [error, setError] = useState("");
  const [showSubject, setShowSubject] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem("tasksTodayShowSubject");
      return raw ? JSON.parse(raw) === true : false;
    } catch {
      return false;
    }
  });

  const firstLoad = useRef(true);
  const seenTasksRef = useRef<Set<string>>(new Set());

  // timersRef keeps active timeout ids per reminder key
  const timersRef = useRef<Map<string, number>>(new Map());
  const { refreshAccessToken, authFetch } = useAuth();
  const { selectedTab, setSelectedTab } = useTab();
  const roleRaw = localStorage.getItem("role") || "";
  const normalizedRole = roleRaw.trim().toLowerCase();
  const user = roleRaw;
  const allowReceivedDate = useMemo(() => {
    return ["admin", "mm", "mam", "mlead", "recruiter"].includes(normalizedRole);
  }, [normalizedRole]);
  const canCloneSupport = useMemo(() => {
    return !['user', 'lead', 'mam'].includes(normalizedRole);
  }, [normalizedRole]);
  const canRequestMock = useMemo(() => {
    return ['recruiter', 'mlead', 'mam', 'mm'].includes(normalizedRole);
  }, [normalizedRole]);
  const canGenerateThanksMail = useMemo(() => {
    return ['recruiter', 'mlead', 'mam', 'mm'].includes(normalizedRole);
  }, [normalizedRole]);
  const { toast } = useToast();
  const meetingsEnabled = AZURE_CLIENT_ID.length > 0;
  const canManageMeetings = useMemo(() => {
    if (!meetingsEnabled) return false;
    const allowedRoles = ['admin', 'user', 'lead', 'am'];
    return allowedRoles.includes(normalizedRole);
  }, [meetingsEnabled, normalizedRole]);

  const hideGrantConsentBanner = useMemo(() => {
    const restrictedRoles = ['recruiter', 'mlead', 'mam', 'mm'];
    return restrictedRoles.includes(normalizedRole);
  }, [normalizedRole]);
  const { instance, accounts } = useMsal();
  const account = accounts[0];
  const {
    needsConsent,
    checking: consentChecking,
    error: consentError,
    refresh: refreshConsent,
    grant: grantConsent,
  } = useOnlineMeetingConsent(instance, account);
  const [meetingBusy, setMeetingBusy] = useState<Record<string, boolean>>({});
  const [teamLeadData, setTeamLeadData] = useState<Record<string, TeamLeadEntry>>({});
  const [teamLeadLoading, setTeamLeadLoading] = useState(false);
  const [teamLeadError, setTeamLeadError] = useState("");
  const [selectedTeamLead, setSelectedTeamLead] = useState<string>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const navigate = useNavigate();
  const currentUserEmail = useMemo(() => {
    const raw = localStorage.getItem("email") || "";
    const trimmed = raw.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
  }, []);
  const [mockDialogTask, setMockDialogTask] = useState<Task | null>(null);
  const [mockPreview, setMockPreview] = useState<MockPreviewState | null>(null);
  const [mockResumeUpload, setMockResumeUpload] = useState<File | null>(null);
  const [mockJdUpload, setMockJdUpload] = useState<File | null>(null);
  const [mockJobDescription, setMockJobDescription] = useState('');
  const [mockError, setMockError] = useState('');
  const [mockSending, setMockSending] = useState(false);
  const [thanksDialogTask, setThanksDialogTask] = useState<Task | null>(null);
  const [thanksMailContent, setThanksMailContent] = useState('');
  const [thanksMailHtml, setThanksMailHtml] = useState('');
  const [thanksMailGeneratedAt, setThanksMailGeneratedAt] = useState<string | null>(null);
  const [thanksMailError, setThanksMailError] = useState('');
  const [thanksMailLoading, setThanksMailLoading] = useState(false);
  const [thanksMailRateInfo, setThanksMailRateInfo] = useState<{ remaining: number; resetAt: string } | null>(null);
  const storedResumeAvailable = useMemo(() => {
    if (!mockPreview) return false;
    return mockPreview.storedAttachments.some((attachment) => {
      const category = (attachment?.category || '').toString().toLowerCase();
      return Boolean(attachment?.data && attachment.data.trim()) && category === 'resume';
    });
  }, [mockPreview]);
  const storedJdAvailable = useMemo(() => {
    if (!mockPreview) return false;
    return mockPreview.storedAttachments.some((attachment) => {
      const category = (attachment?.category || '').toString().toLowerCase();
      return Boolean(attachment?.data && attachment.data.trim()) && category === 'jobdescription';
    });
  }, [mockPreview]);
  const sanitizedThanksMailHtml = useMemo(() => {
    if (!thanksMailHtml) {
      return '';
    }
    return DOMPurify.sanitize(thanksMailHtml, { USE_PROFILES: { html: true } });
  }, [thanksMailHtml]);
  const mockSubject = useMemo(() => {
    if (!mockPreview) return '';
    const subjectTechnology = mockPreview.technology || 'General';
    return `Mock Interview - ${mockPreview.candidateName || 'Candidate'} - ${subjectTechnology} - Training - ${mockPreview.interviewDisplay}`;
  }, [mockPreview]);

  const loadThanksMailFromStorage = useCallback((taskId: string): ThanksMailEntry | null => {
    if (!currentUserEmail) {
      return null;
    }
    try {
      const raw = localStorage.getItem(THANKS_MAIL_CACHE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      const userCache = parsed[currentUserEmail];
      if (!userCache || typeof userCache !== 'object') {
        return null;
      }
      const entry = userCache[taskId];
      if (!entry || typeof entry.content !== 'string') {
        return null;
      }
      const html = typeof entry.html === 'string' ? entry.html : '';
      return {
        content: entry.content,
        html: html ? DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }) : '',
        generatedAt: entry.generatedAt
      };
    } catch (error) {
      console.error('Failed to read stored thanks mail draft', error);
      return null;
    }
  }, [currentUserEmail]);

  const persistThanksMailToStorage = useCallback((taskId: string, entry: ThanksMailEntry) => {
    if (!currentUserEmail) {
      return;
    }
    try {
      const raw = localStorage.getItem(THANKS_MAIL_CACHE_KEY);
      let parsed: Record<string, Record<string, ThanksMailEntry>> = {};
      if (raw) {
        const candidate = JSON.parse(raw);
        if (candidate && typeof candidate === 'object') {
          parsed = candidate;
        }
      }

      const userCache = parsed[currentUserEmail] && typeof parsed[currentUserEmail] === 'object'
        ? parsed[currentUserEmail]
        : {};

      userCache[taskId] = {
        content: entry.content,
        html: typeof entry.html === 'string' ? entry.html : '',
        generatedAt: entry.generatedAt
      };

      const ordered = Object.entries(userCache)
        .filter(([, value]) => value
          && typeof value.content === 'string'
          && typeof value.generatedAt === 'string'
          && (typeof value.html === 'undefined' || typeof value.html === 'string'))
        .sort(([, a], [, b]) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
        .slice(0, MAX_STORED_THANKS_ENTRIES);

      parsed[currentUserEmail] = Object.fromEntries(ordered);

      localStorage.setItem(THANKS_MAIL_CACHE_KEY, JSON.stringify(parsed));
    } catch (error) {
      console.error('Failed to persist thanks mail draft', error);
    }
  }, [currentUserEmail]);

  const setMeetingBusyState = useCallback((taskId: string, busy: boolean) => {
    setMeetingBusy((prev) => {
      const next = { ...prev };
      if (busy) {
        next[taskId] = true;
      } else {
        delete next[taskId];
      }
      return next;
    });
  }, []);

  const extractJoinLink = useCallback((task: Task) => {
    const candidate = task.joinUrl || task.joinWebUrl || '';
    if (!candidate) return '';
    try {
      const url = new URL(candidate);
      return url.toString();
    } catch {
      return '';
    }
  }, []);

  const buildTeamLeadMapping = useCallback((users: ManageableUser[]) => {
    type PersonNode = {
      key: string;
      label: string;
      role: string;
      reports: Set<string>;
    };

    const nodes = new Map<string, PersonNode>();

    const ensureNode = (rawLabel: string): PersonNode | null => {
      const formatted = formatNameInput(rawLabel);
      if (!formatted) return null;
      const key = formatted.toLowerCase();
      let existing = nodes.get(key);
      if (!existing) {
        existing = { key, label: formatted, role: 'unknown', reports: new Set<string>() };
        nodes.set(key, existing);
      }
      return existing;
    };

    const ensureNodeFromEmail = (email: string): PersonNode | null => {
      const label = deriveDisplayNameFromEmail(email);
      if (!label) return null;
      return ensureNode(label);
    };

    for (const userRecord of users) {
      if (!userRecord || typeof userRecord !== 'object') continue;
      const personNode = ensureNodeFromEmail(userRecord.email);
      if (!personNode) continue;

      const roleLower = (userRecord.role || '').toLowerCase();
      if (roleLower) {
        personNode.role = roleLower;
      }

      const leadLabel = formatNameInput(userRecord.teamLead ?? '');
      if (leadLabel) {
        const leadNode = ensureNode(leadLabel);
        if (leadNode) {
          leadNode.reports.add(personNode.key);
        }
      }
    }

    const selfDisplay = formatNameInput(localStorage.getItem('displayName') || '');
    if (selfDisplay) {
      const selfNode = ensureNode(selfDisplay);
      if (selfNode && (!selfNode.role || selfNode.role === 'unknown')) {
        selfNode.role = normalizedRole || selfNode.role;
      }
    }

    const gatherRecruiters = (startKey: string) => {
      const recruiters = new Set<string>();
      const mleadNames = new Set<string>();
      const visited = new Set<string>();
      const stack = [startKey];

      while (stack.length > 0) {
        const currentKey = stack.pop();
        if (!currentKey || visited.has(currentKey)) continue;
        visited.add(currentKey);
        const node = nodes.get(currentKey);
        if (!node) continue;

        for (const reportKey of node.reports) {
          const reportNode = nodes.get(reportKey);
          if (!reportNode) continue;

          const role = reportNode.role;
          if (role === 'recruiter' || role === 'mlead') {
            recruiters.add(reportNode.label);
          }

          if (role === 'mlead') {
            mleadNames.add(reportNode.label);
          }

          if (reportNode.reports.size > 0 && !visited.has(reportKey)) {
            stack.push(reportKey);
          }
        }
      }

      return { recruiters, mleadNames };
    };

    const mapping: Record<string, TeamLeadEntry> = {};

    nodes.forEach((node, key) => {
      const { recruiters, mleadNames } = gatherRecruiters(key);
      mapping[key] = {
        label: node.label,
        role: node.role,
        recruiters: Array.from(recruiters).sort((a, b) => a.localeCompare(b)),
        mleadNames: Array.from(mleadNames).sort((a, b) => a.localeCompare(b)),
      };
    });

    return mapping;
  }, [normalizedRole]);

  const handleOpenMeeting = useCallback(
    (url: string) => {
      if (!url) return;
      try {
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch (error) {
        console.error('Failed to open meeting link', error);
        toast({
          title: 'Unable to open link',
          description: 'Copy the URL instead and paste it into your browser.',
          variant: 'destructive',
        });
      }
    },
    [toast]
  );

  const handleCopyMeeting = useCallback(
    async (url: string) => {
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        toast({
          title: 'Link copied',
          description: 'Join link copied to your clipboard.',
        });
      } catch (error) {
        console.error('Copy to clipboard failed', error);
        toast({
          title: 'Copy failed',
          description: 'Select and copy the link manually.',
          variant: 'destructive',
        });
      }
    },
    [toast]
  );

  const ensureMicrosoftAccount = useCallback(async (): Promise<AccountInfo | null> => {
    if (!canManageMeetings) return null;
    let activeAccount = account || instance.getActiveAccount() || null;
    if (!activeAccount) {
      try {
        const loginResponse = await instance.loginPopup(loginRequest);
        if (loginResponse.account) {
          instance.setActiveAccount(loginResponse.account);
          activeAccount = loginResponse.account;
        }
      } catch (error) {
        console.error('Microsoft sign-in failed', error);
        toast({
          title: 'Microsoft sign-in failed',
          description: 'We could not sign you in. Please try again later.',
          variant: 'destructive',
        });
        return null;
      }
    }
    return activeAccount;
  }, [account, instance, canManageMeetings, toast]);

  // Range/date field filters (default: today)
  const [filters, setFilters] = useState<DashboardFilterState>(() => {
    const dayRange = computeDayRange(new Date(), DEFAULT_TIMEZONE);
    const initialField =
      allowReceivedDate && selectedTab === 'receivedDateTime'
        ? 'receivedDateTime'
        : 'Date of Interview';
    return {
      range: 'day',
      dateField: initialField,
      dayDate: dayRange.dayIso,
      start: dayRange.startIso,
      end: dayRange.endIso,
      upcoming: false,
    };
  });

  const selectedTabRef = useRef<string>(filters.dateField);
  const previousDateFieldRef = useRef<string>(filters.dateField);

  useEffect(() => {
    if (!allowReceivedDate && filters.dateField === 'receivedDateTime') {
      setFilters((prev) => ({ ...prev, dateField: 'Date of Interview' }));
    }
  }, [allowReceivedDate, filters.dateField]);

  // Mirror current filters.dateField into selectedTab storage and ref
  useEffect(() => {
    selectedTabRef.current = filters.dateField;
    if (selectedTab !== filters.dateField) {
      setSelectedTab(filters.dateField);
    }
  }, [filters.dateField, selectedTab, setSelectedTab]);

  useEffect(() => {
    if (previousDateFieldRef.current !== filters.dateField) {
      if (import.meta?.env?.DEV) {
        console.debug(
          `[TasksToday] dateField changed from ${previousDateFieldRef.current} to ${filters.dateField}`
        );
      }
      previousDateFieldRef.current = filters.dateField;
    }
  }, [filters.dateField]);

  // persist subject visibility
  useEffect(() => {
    try {
      localStorage.setItem("tasksTodayShowSubject", JSON.stringify(showSubject));
    } catch {}
  }, [showSubject]);

  useEffect(() => {
    if (!['mm', 'mam'].includes(normalizedRole)) {
      setTeamLeadData({});
      setSelectedTeamLead('all');
      setTeamLeadError('');
      return;
    }

    let active = true;

    const loadTeamLeads = async () => {
      setTeamLeadLoading(true);
      try {
        const response = await authFetch(`${API_URL}/api/users/manageable`);
        if (!response.ok) {
          throw new Error('Failed to load team leads');
        }

        const payload = await response.json();
        if (!active) return;

        const manageableUsers = Array.isArray(payload?.users) ? (payload.users as ManageableUser[]) : [];
        const mapping = buildTeamLeadMapping(manageableUsers);

        setTeamLeadData(mapping);
        setTeamLeadError('');
        setSelectedTeamLead((prev) => (prev !== 'all' && !mapping[prev] ? 'all' : prev));
      } catch (error) {
        console.error('Failed to load team lead mapping', error);
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Failed to load team leads';
        setTeamLeadError(message);
        setTeamLeadData({});
        setSelectedTeamLead('all');
        toast({
          title: 'Unable to load team leads',
          description: DOMPurify.sanitize(message),
          variant: 'destructive',
        });
      } finally {
        if (active) {
          setTeamLeadLoading(false);
        }
      }
    };

    void loadTeamLeads();

    return () => {
      active = false;
    };
  }, [normalizedRole, authFetch, buildTeamLeadMapping, toast]);

  // === Storage helpers ===
  const readScheduled = (): Record<string, string> => {
    try {
      const raw = localStorage.getItem(REM_SCHEDULE_KEY) || "{}";
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      localStorage.setItem(REM_SCHEDULE_KEY, "{}");
      return {};
    }
  };

  const writeScheduled = (m: Record<string, string>) => {
    localStorage.setItem(REM_SCHEDULE_KEY, JSON.stringify(m));
  };

  const readFired = (): Set<string> => {
    try {
      const raw = localStorage.getItem(REM_FIRED_KEY) || "[]";
      const arr = JSON.parse(raw);
      return new Set<string>(Array.isArray(arr) ? arr : []);
    } catch {
      localStorage.setItem(REM_FIRED_KEY, "[]");
      return new Set<string>();
    }
  };

  const writeFired = (fired: Set<string>) => {
    localStorage.setItem(REM_FIRED_KEY, JSON.stringify([...fired]));
  };

  // === Socket ===
  const socket: Socket = useMemo(() => {
    const token = localStorage.getItem("accessToken") || "";
    return io(API_URL, {
      autoConnect: false,
      transports: ["websocket"],
      auth: { token },
    });
  }, []);

  // === Styling helpers ===
  const getStatusBadge = (status = "") =>
    ({
      completed: "bg-emerald-500 text-white",
      cancelled: "bg-red-500 text-white",
      acknowledged: "bg-amber-500 text-white",
      pending: "bg-blue-500 text-white",
    }[status.toLowerCase()] || "bg-gray-500 text-white");

const getRowClasses = (status = "") => {
  const base = status.toLowerCase();

  const gradients: Record<string, string> = {
    // Green (Completed)
    completed:
      "bg-gradient-to-r from-[#43cea2]/85 to-[#185a9d]/35 border-l-4 border-[#43cea2]/70",

    // Red (Cancelled)
    cancelled:
      "bg-gradient-to-r from-[#ff6a6a]/85 to-[#c31432]/35 border-l-4 border-[#ff6a6a]/70",

    // Yellow (Acknowledged)
    acknowledged:
      "bg-gradient-to-r from-[#f7971e]/90 to-[#ffd200]/40 border-l-4 border-[#f7971e]/70",

    // Blue (Pending)
    pending:
      "bg-gradient-to-r from-[#36d1dc]/85 to-[#5b86e5]/35 border-l-4 border-[#36d1dc]/70",
  };

  // Grey (default/fallback)
  return (
    gradients[base] ||
    "bg-gradient-to-r from-[#bdc3c7]/70 to-[#2c3e50]/30 border-l-4 border-[#bdc3c7]/70"
  );
};


  // === Parsing helpers (strict) ===
  const parsePreferredStrict = (val?: string): Moment | null => {
    if (!val) return null;
    const m = moment(val, PARSE_FMT, true); // strict
    if (m.isValid()) return m.tz(TZ);
    const iso = moment(val, moment.ISO_8601, true);
    return iso.isValid() ? iso.tz(TZ) : null;
  };

  const parseLegacyStrict = (date?: string, time?: string): Moment | null => {
    if (!date || !time) return null;
    const base = moment(`${date} ${time}`, LEGACY_FMT, true); // strict
    return base.isValid() ? base.tz(TZ) : null;
  };

  const parseStart = (t: Task): Moment | null =>
    parsePreferredStrict(t.startTime) ||
    parseLegacyStrict(t["Date of Interview"], t["Start Time Of Interview"]);

  const parseEnd = (t: Task): Moment | null =>
    parsePreferredStrict(t.endTime) ||
    parseLegacyStrict(t["Date of Interview"], t["End Time Of Interview"]);

  const parseReceived = (t: Task): Moment | null =>
    parsePreferredStrict(t.receivedDateTime);

  // Which timestamp powers filters/sorting (depends on tab)
  const todayStart = useMemo(() => moment.tz(TZ).startOf('day'), []);
  const todayIso = useMemo(() => todayStart.toISOString(), [todayStart]);

  const primaryStart = useCallback((t: Task): Moment | null => {
    const tab = selectedTabRef.current;
    if (tab === "receivedDateTime") return parseReceived(t);
    return parseStart(t);
  }, []);

  const isTodayForCurrentTab = useCallback((task: Task) => {
    const start = primaryStart(task);
    if (!start) return false;
    return start.isSame(todayStart, 'day');
  }, [primaryStart, todayStart]);

  const isInCurrentFilters = useCallback((task: Task) => {
    const start = primaryStart(task);
    if (!start) return false;

    if (filters.upcoming) {
      // After today (local TZ)
      return start.isAfter(todayStart.clone().endOf('day'));
    }

    const startIso = filters.start ? moment(filters.start) : null;
    const endIso = filters.end ? moment(filters.end) : null;
    if (startIso && endIso) {
      return start.isSameOrAfter(startIso) && start.isBefore(endIso);
    }
    // Fallback to today when no explicit range
    return start.isSame(todayStart, 'day');
  }, [filters.upcoming, filters.start, filters.end, primaryStart, todayStart]);

  const sortByPrimaryStart = useCallback((list: Task[]) => {
    return [...list].sort((a, b) => {
      const aS = primaryStart(a)?.toDate() ?? new Date(0);
      const bS = primaryStart(b)?.toDate() ?? new Date(0);
      if (aS.getTime() !== bS.getTime()) return aS.getTime() - bS.getTime();
      const aE = parseEnd(a)?.toDate() ?? new Date(0);
      const bE = parseEnd(b)?.toDate() ?? new Date(0);
      return aE.getTime() - bE.getTime();
    });
  }, [primaryStart]);

  const prepareCloneAttachments = useCallback(
    (source: Task): SupportCloneDraftPayload['attachments'] => {
      if (!Array.isArray(source.attachments) || source.attachments.length === 0) {
        return undefined;
      }

      const sanitized: NonNullable<SupportCloneDraftPayload['attachments']> = [];

      for (const rawAttachment of source.attachments) {
        if (!rawAttachment || typeof rawAttachment !== 'object') continue;
        const rawName = typeof rawAttachment.name === 'string' ? rawAttachment.name : '';
        const safeName = DOMPurify.sanitize(rawName, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim();
        if (!safeName) continue;

        const rawUrl = typeof rawAttachment.url === 'string' ? rawAttachment.url : '';
        const safeUrl = rawUrl
          ? DOMPurify.sanitize(rawUrl, {
              ALLOWED_TAGS: [],
              ALLOWED_ATTR: [],
              ALLOWED_URI_REGEXP: /^(https?|blob|data):/i,
            }).trim()
          : '';

        const rawType = typeof rawAttachment.type === 'string' ? rawAttachment.type : '';
        const safeType = rawType
          ? DOMPurify.sanitize(rawType, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim()
          : '';

        const rawData = typeof rawAttachment.data === 'string' ? rawAttachment.data : '';
        const safeData = rawData ? rawData.trim() : '';

        const categoryInput = typeof rawAttachment.category === 'string' ? rawAttachment.category : '';
        const normalizedCategory = categoryInput.replace(/[\s_-]+/g, '').toLowerCase();

        let category: CloneAttachmentCategory;
        if (normalizedCategory === 'resume') {
          category = 'resume';
        } else if (normalizedCategory === 'jobdescription' || normalizedCategory === 'jd') {
          category = 'jobDescription';
        } else {
          const lowerName = safeName.toLowerCase();
          if (lowerName.includes('resume')) {
            category = 'resume';
          } else if (
            lowerName.includes('jobdescription') ||
            lowerName.includes('job description') ||
            /\bjd\b/.test(lowerName)
          ) {
            category = 'jobDescription';
          } else {
            category = 'additional';
          }
        }

        const record: NonNullable<SupportCloneDraftPayload['attachments']>[number] = {
          name: safeName,
          category,
        };

        if (safeUrl) {
          record.url = safeUrl;
        }
        if (safeType) {
          record.type = safeType;
        }
        if (safeData) {
          record.data = safeData;
        }

        sanitized.push(record);
      }

      return sanitized.length > 0 ? sanitized : undefined;
    },
    []
  );

  const readMockFileAsDataUrl = useCallback(
    (file: File) =>
      new Promise<string>((resolve, reject) => {
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
      }),
    []
  );

  const encodeMockAttachment = useCallback(
    async (file: File, category: string): Promise<SupportMockAttachment> => {
      const attachment: SupportMockAttachment = {
        name: file.name,
        type: file.type || 'application/pdf',
        category
      };

      if (file.size > MAX_INLINE_ATTACHMENT_BYTES) {
        return attachment;
      }

      try {
        const dataUrl = await readMockFileAsDataUrl(file);
        if (dataUrl) {
          const commaIndex = dataUrl.indexOf(',');
          attachment.data = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
        }
      } catch (error) {
        console.error('Failed to encode mock attachment', error);
      }

      return attachment;
    },
    [readMockFileAsDataUrl]
  );

  const persistMockMaterials = useCallback((entry: SupportMockStoredEntry) => {
    if (!entry) return;

    const keyCandidates: string[] = [];
    if (entry.candidateEmail) {
      keyCandidates.push(entry.candidateEmail.trim().toLowerCase());
    }
    if (entry.sourceTaskId) {
      keyCandidates.push(entry.sourceTaskId);
    }

    if (keyCandidates.length === 0) {
      return;
    }

    try {
      const raw = localStorage.getItem(SUPPORT_MOCK_STORAGE_KEY);
      let parsed: Record<string, SupportMockStoredEntry[]> = {};
      if (raw && /^\s*[{[]/.test(raw)) {
        const candidate = JSON.parse(raw);
        if (candidate && typeof candidate === 'object') {
          parsed = candidate;
        }
      }

      const storedBy = (localStorage.getItem('email') || '').trim().toLowerCase();
      const normalizedEntry: SupportMockStoredEntry = {
        ...entry,
        storedBy: entry.storedBy || (storedBy || undefined)
      };

      for (const key of keyCandidates) {
        if (!key) continue;
        const existing = Array.isArray(parsed[key]) ? parsed[key] : [];
        const deduped = [normalizedEntry, ...existing.filter((item) => item?.storedAt !== normalizedEntry.storedAt)];
        parsed[key] = deduped.slice(0, MAX_STORED_MOCK_ENTRIES);
      }

      localStorage.setItem(SUPPORT_MOCK_STORAGE_KEY, JSON.stringify(parsed));
    } catch (error) {
      console.error('Failed to persist mock materials', error);
    }
  }, []);

  const loadStoredMockEntry = useCallback((task: Task): SupportMockStoredEntry | null => {
    const keyCandidates: string[] = [];
    const candidateEmail = (task['Email ID'] || '').trim().toLowerCase();
    if (candidateEmail) {
      keyCandidates.push(candidateEmail);
    }
    if (task._id) {
      keyCandidates.push(task._id);
    }

    try {
      const raw = localStorage.getItem(SUPPORT_MOCK_STORAGE_KEY);
      if (raw && /^\s*[{[]/.test(raw)) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const key of keyCandidates) {
            const entries = parsed?.[key];
            if (Array.isArray(entries) && entries.length > 0) {
              const sorted = [...entries].sort((a, b) => {
                const aTime = new Date(a?.storedAt ?? 0).getTime();
                const bTime = new Date(b?.storedAt ?? 0).getTime();
                return bTime - aTime;
              });
              const match = sorted[0];
              if (match) {
                return match;
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to load stored mock materials', error);
    }

    try {
      const legacyRaw = localStorage.getItem(SUPPORT_CLONE_STORAGE_KEY);
      if (legacyRaw && /^\s*{/.test(legacyRaw)) {
        const legacy = JSON.parse(legacyRaw);
        if (legacy && typeof legacy === 'object' && keyCandidates.includes((legacy.candidateEmail || '').toLowerCase())) {
          return {
            candidateName: legacy.candidateName || '',
            candidateEmail: legacy.candidateEmail || '',
            contactNumber: legacy.contactNumber,
            technology: legacy.technology,
            endClient: legacy.endClient,
            interviewRound: legacy.interviewRound,
            interviewDateTime: legacy.interviewDateTime,
            attachments: legacy.attachments,
            jobDescriptionText: legacy.jobDescriptionText,
            sourceTaskId: legacy.sourceTaskId,
            storedAt: legacy.storedAt || new Date().toISOString(),
            storedBy: legacy.storedBy
          };
        }
      }
    } catch (legacyError) {
      console.error('Failed to parse legacy clone draft for mock materials', legacyError);
    }

    return null;
  }, []);

  const handleCloneSupport = useCallback(
    (task: Task) => {
      if (!canCloneSupport) {
        toast({
          title: 'Clone unavailable',
          description: 'Ask an MM or recruiter to duplicate this request for you.',
          variant: 'destructive'
        });
        return;
      }
      try {
        const start = parseStart(task);
        const end = parseEnd(task);
        const interviewDateTimeISO = start ? start.toISOString() : '';
        let durationMinutes: number | undefined;
        if (start && end && end.isAfter(start)) {
          durationMinutes = Math.round(moment.duration(end.diff(start)).asMinutes());
        }

        const contactNumber = task['Contact No'] || '';
        const technology =
          task['Technology'] ||
          (task.suggestions && task.suggestions.length > 0
            ? task.suggestions.join(', ')
            : undefined);
        const jobTitle = task['Job Title'] || task.subject || '';
        const attachments = prepareCloneAttachments(task);
        const jobDescriptionTextRaw =
          typeof task.jobDescriptionText === 'string' ? task.jobDescriptionText : '';
        const jobDescriptionText = jobDescriptionTextRaw
          ? DOMPurify.sanitize(jobDescriptionTextRaw, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim()
          : undefined;

        const payload: SupportCloneDraftPayload = {
          version: 1,
          sourceTaskId: task._id,
          candidateName: task['Candidate Name'] || '',
          candidateEmail: task['Email ID'] || '',
          contactNumber,
          endClient: task['End Client'] || '',
          jobTitle,
          interviewRound: task['Interview Round'] || '',
          interviewDateTime: interviewDateTimeISO,
          durationMinutes,
          technology,
          jobDescriptionText,
          attachments,
          storedAt: new Date().toISOString(),
          storedBy: (localStorage.getItem('email') || '').trim().toLowerCase() || undefined
        };

        localStorage.setItem(SUPPORT_CLONE_STORAGE_KEY, JSON.stringify(payload));
        persistMockMaterials({
          candidateName: payload.candidateName,
          candidateEmail: payload.candidateEmail,
          contactNumber: payload.contactNumber,
          technology: payload.technology,
          endClient: payload.endClient,
          interviewRound: payload.interviewRound,
          interviewDateTime: payload.interviewDateTime,
          attachments: payload.attachments?.filter((attachment) => {
            const category = (attachment?.category || '').toString().toLowerCase();
            return category === 'resume' || category === 'jobdescription';
          }),
          jobDescriptionText: payload.jobDescriptionText,
          sourceTaskId: payload.sourceTaskId,
          storedAt: payload.storedAt,
          storedBy: payload.storedBy
        });
        navigate('/branch-candidates?clone=1');
        toast({
          title: 'Support request ready to clone',
          description: 'Review the details on Branch Candidates before sending.',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to prepare clone payload';
        toast({ title: 'Clone failed', description: message, variant: 'destructive' });
      }
    },
    [canCloneSupport, navigate, parseStart, parseEnd, toast, prepareCloneAttachments, persistMockMaterials]
  );

  const closeMockDialog = useCallback(() => {
    setMockDialogTask(null);
    setMockPreview(null);
    setMockResumeUpload(null);
    setMockJdUpload(null);
    setMockJobDescription('');
    setMockError('');
    setMockSending(false);
  }, []);

  const handleOpenMockDialog = useCallback(
    (task: Task) => {
      if (!canRequestMock) {
        toast({
          title: 'Mock request unavailable',
          description: 'Your role is not permitted to request mock interviews.',
          variant: 'destructive'
        });
        return;
      }

      const sanitizePlain = (value: string | undefined) =>
        DOMPurify.sanitize(value ?? '', { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim();

      const start = parseStart(task);
      const interviewIso = start ? start.toISOString() : '';
      const storedEntry = loadStoredMockEntry(task);
      const fallbackMoment = !interviewIso && storedEntry?.interviewDateTime
        ? moment(storedEntry.interviewDateTime).tz(TZ)
        : null;

      const candidateName = sanitizePlain(task['Candidate Name'] || storedEntry?.candidateName || '');
      const candidateEmail = sanitizePlain(task['Email ID'] || storedEntry?.candidateEmail || '');
      const technology = sanitizePlain(task['Technology'] || storedEntry?.technology || '');
      const contactNumber = sanitizePlain(task['Contact No'] || storedEntry?.contactNumber || '');
      const endClient = sanitizePlain(task['End Client'] || storedEntry?.endClient || '');
      const interviewRound = sanitizePlain(task['Interview Round'] || storedEntry?.interviewRound || '');

      const interviewDateTimeIso = interviewIso || storedEntry?.interviewDateTime || '';
      const interviewDisplay = start
        ? start.tz(TZ).format('MMM D, YYYY [at] hh:mm A [EST]')
        : fallbackMoment && fallbackMoment.isValid()
          ? fallbackMoment.format('MMM D, YYYY [at] hh:mm A [EST]')
          : 'Not available';

      const storedAttachments = Array.isArray(storedEntry?.attachments)
        ? storedEntry.attachments.filter((attachment: SupportMockAttachment | null) => Boolean(attachment)) as SupportMockAttachment[]
        : [];

      const jobDescriptionRaw = storedEntry?.jobDescriptionText || '';
      const jobDescription = DOMPurify.sanitize(jobDescriptionRaw, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim();

      setMockPreview({
        candidateName,
        candidateEmail,
        technology,
        contactNumber,
        endClient,
        interviewRound,
        interviewDateTimeIso,
        interviewDisplay,
        storedAttachments,
        jobDescriptionText: jobDescription,
        sourceTaskId: storedEntry?.sourceTaskId || task._id,
        storedBy: storedEntry?.storedBy
      });
      setMockJobDescription(jobDescription);
      setMockResumeUpload(null);
      setMockJdUpload(null);
      setMockError(candidateEmail ? '' : 'Candidate email is required to request a mock.');
      setMockSending(false);
      setMockDialogTask(task);
    },
    [canRequestMock, loadStoredMockEntry, parseStart, toast]
  );

  const ensureGraphMailToken = useCallback(async () => {
    let activeAccount = account || instance.getActiveAccount() || null;
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
        } catch (error) {
          console.warn('Silent Graph token acquisition failed, attempting popup', error);
          const popupResponse = await instance.acquireTokenPopup({
            scopes: GRAPH_MAIL_SCOPES
          });
          graphToken = popupResponse.accessToken;
        }
      }
    } catch (error) {
      console.error('Failed to acquire Graph token', error);
      toast({
        title: 'Authorization failed',
        description: 'Authorize Microsoft access and try again.',
        variant: 'destructive'
      });
      return null;
    }

    if (!graphToken) {
      toast({
        title: 'Authorization required',
        description: 'Sign in to Microsoft before sending mock requests.',
        variant: 'destructive'
      });
      return null;
    }

    return graphToken;
  }, [account, instance, toast]);

  const handleMockSend = useCallback(async () => {
    if (!mockDialogTask || !mockPreview) {
      return;
    }

    const sanitizedJobDescription = DOMPurify.sanitize(mockJobDescription, {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: []
    }).trim();

    if (!mockPreview.candidateName || !mockPreview.candidateEmail) {
      setMockError('Candidate name and email are required.');
      return;
    }

    if (!mockPreview.interviewDateTimeIso) {
      setMockError('Interview date and time are required.');
      return;
    }

    if (!mockPreview.contactNumber) {
      setMockError('Provide the candidate contact number before requesting a mock.');
      return;
    }

    setMockError('');
    setMockSending(true);

    try {
      let resumeAttachment: SupportMockAttachment | null = null;
      let jdAttachment: SupportMockAttachment | null = null;

      const findStored = (category: string) =>
        mockPreview.storedAttachments.find((attachment) => {
          const normalized = (attachment?.category || '').toString().toLowerCase();
          return normalized === category && typeof attachment?.data === 'string' && attachment.data.trim();
        }) || null;

      if (mockResumeUpload) {
        resumeAttachment = await encodeMockAttachment(mockResumeUpload, 'resume');
      } else {
        resumeAttachment = findStored('resume');
      }

      if (mockJdUpload) {
        jdAttachment = await encodeMockAttachment(mockJdUpload, 'jobDescription');
      } else {
        jdAttachment = findStored('jobdescription');
      }

      if (!resumeAttachment || !resumeAttachment.data) {
        setMockError('Attach the candidate resume (PDF, up to 2 MB).');
        setMockSending(false);
        return;
      }

      if (!jdAttachment || !jdAttachment.data) {
        setMockError('Attach the job description (PDF, up to 2 MB).');
        setMockSending(false);
        return;
      }

      const graphToken = await ensureGraphMailToken();
      if (!graphToken) {
        setMockSending(false);
        return;
      }

      const payload = {
        candidateName: mockPreview.candidateName,
        candidateEmail: mockPreview.candidateEmail,
        contactNumber: mockPreview.contactNumber,
        technology: mockPreview.technology,
        endClient: mockPreview.endClient,
        interviewRound: mockPreview.interviewRound,
        interviewDateTime: mockPreview.interviewDateTimeIso,
        jobDescriptionText: sanitizedJobDescription,
        attachments: [
          { ...resumeAttachment, category: 'resume' },
          { ...jdAttachment, category: 'jobDescription' }
        ],
        sourceTaskId: mockPreview.sourceTaskId || mockDialogTask._id
      };

      const response = await authFetch(`${API_URL}/api/support/mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-graph-access-token': graphToken
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        const message = typeof result?.error === 'string' ? result.error : 'Unable to send mock request';
        setMockError(message);
        setMockSending(false);
        return;
      }

      const storedEntry: SupportMockStoredEntry = {
        candidateName: payload.candidateName,
        candidateEmail: payload.candidateEmail,
        contactNumber: payload.contactNumber,
        technology: payload.technology,
        endClient: payload.endClient,
        interviewRound: payload.interviewRound,
        interviewDateTime: payload.interviewDateTime,
        attachments: payload.attachments,
        jobDescriptionText: payload.jobDescriptionText,
        sourceTaskId: payload.sourceTaskId,
        storedAt: new Date().toISOString(),
        storedBy: (localStorage.getItem('email') || '').trim().toLowerCase() || undefined
      };

      persistMockMaterials(storedEntry);

      toast({
        title: 'Mock request sent',
        description: 'Mock interview details emailed successfully.'
      });
      closeMockDialog();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send mock request';
      setMockError(message);
    } finally {
      setMockSending(false);
    }
  }, [
    API_URL,
    authFetch,
    closeMockDialog,
    encodeMockAttachment,
    ensureGraphMailToken,
    mockDialogTask,
    mockJobDescription,
    mockJdUpload,
    mockPreview,
    mockResumeUpload,
    persistMockMaterials,
    toast
  ]);

  const closeThanksDialog = useCallback(() => {
    setThanksDialogTask(null);
    setThanksMailContent('');
    setThanksMailHtml('');
    setThanksMailGeneratedAt(null);
    setThanksMailError('');
    setThanksMailRateInfo(null);
    setThanksMailLoading(false);
  }, []);

  const handleOpenThanksMailDialog = useCallback(
    (task: Task, existingDraft?: ThanksMailEntry | null) => {
      const storedDraft = existingDraft ?? loadThanksMailFromStorage(task._id);
      if (!task.transcription && !storedDraft) {
        toast({
          title: 'Transcript unavailable',
          description: 'TxAv is missing for this task. Ask the transcription team to upload the interview transcript before generating a thank-you email.',
          variant: 'destructive'
        });
        return;
      }

      setThanksMailContent(storedDraft?.content || '');
      setThanksMailHtml(typeof storedDraft?.html === 'string' ? storedDraft.html : '');
      setThanksMailGeneratedAt(storedDraft?.generatedAt || null);
      setThanksMailError('');
      setThanksMailRateInfo(null);
      setThanksMailLoading(false);
      setThanksDialogTask(task);
    },
    [loadThanksMailFromStorage, toast]
  );

  const handleGenerateThanksMail = useCallback(async () => {
    if (!thanksDialogTask) {
      return;
    }

    if (!thanksDialogTask.transcription) {
      setThanksMailError('Transcript not available for this task.');
      return;
    }

    setThanksMailLoading(true);
    setThanksMailError('');
    const pendingToast = toast({
      title: 'Generating thank-you email…',
      description: 'This may take up to a minute. You can keep working—we\'ll notify you once it\'s ready.',
      duration: 60000
    });
    try {
      const response = await authFetch(`${API_URL}/api/tasks/${thanksDialogTask._id}/thanks-mail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = payload?.error || 'Unable to generate thank-you email.';
        setThanksMailError(message);
        if (payload?.rateLimit) {
          setThanksMailRateInfo(payload.rateLimit);
        }
        pendingToast.dismiss();
        return;
      }

      const markdown = typeof payload.markdown === 'string' ? payload.markdown : '';
      const rawHtml = typeof payload.html === 'string' ? payload.html : '';
      const safeHtml = rawHtml ? DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } }) : '';
      const generatedAt = typeof payload.generatedAt === 'string' ? payload.generatedAt : new Date().toISOString();
      setThanksMailContent(markdown);
      setThanksMailHtml(safeHtml);
      setThanksMailGeneratedAt(generatedAt);
      setThanksMailRateInfo(payload.rateLimit || null);
      persistThanksMailToStorage(thanksDialogTask._id, { content: markdown, html: safeHtml, generatedAt });
      pendingToast.dismiss();
      toast({
        title: 'Thank-you email ready',
        description: 'A draft is now available below and saved for quick reuse.',
        className: 'bg-gradient-to-r from-emerald-500 via-teal-500 to-lime-500 text-white shadow-lg',
        duration: 6000
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to generate thank-you email.';
      setThanksMailError(message);
      pendingToast.dismiss();
    } finally {
      pendingToast.dismiss();
      setThanksMailLoading(false);
    }
  }, [API_URL, authFetch, persistThanksMailToStorage, thanksDialogTask, toast]);

  const handleCopyThanksMail = useCallback(async () => {
    if (!thanksMailContent) {
      return;
    }
    try {
      if (!navigator?.clipboard?.writeText) {
        setThanksMailError('Clipboard access is unavailable in this environment. Copy the draft manually.');
        return;
      }
      await navigator.clipboard.writeText(thanksMailContent);
      toast({
        title: 'Copied to clipboard',
        description: 'The thank-you email draft is ready to paste.'
      });
    } catch (error) {
      setThanksMailError('Unable to copy the draft. Copy it manually instead.');
      console.error('Failed to copy thanks mail content', error);
    }
  }, [thanksMailContent, toast]);

  const createOutlookEvent = useCallback(
    async (
      task: Task,
      accountOverride?: AccountInfo | null,
      overrides?: Partial<Task>
    ): Promise<boolean> => {
      if (!canManageMeetings) {
        toast({
          title: 'Meetings unavailable',
          description: 'Microsoft Teams integration is not configured or your role is not permitted.',
          variant: 'destructive',
        });
        return false;
      }

      const activeAccount = accountOverride ?? (await ensureMicrosoftAccount());
      if (!activeAccount) return false;

      let tokenResp: AuthenticationResult;
      try {
        tokenResp = await instance.acquireTokenSilent({
          account: activeAccount,
          scopes: ['Calendars.ReadWrite', 'OnlineMeetings.ReadWrite'],
        });
      } catch {
        tokenResp = await instance.acquireTokenPopup({
          scopes: ['Calendars.ReadWrite', 'OnlineMeetings.ReadWrite'],
        });
      }

      const accessToken = tokenResp.accessToken;
      if (!accessToken) {
        toast({
          title: 'Authorization failed',
          description: 'Sign in again to Microsoft and retry.',
          variant: 'destructive',
        });
        return false;
      }

      const workingTask: Task = overrides ? { ...task, ...overrides } : task;
      const joinLink = extractJoinLink(workingTask);
      if (!joinLink) {
        toast({
          title: 'Missing meeting link',
          description: 'Create the Teams meeting first, then add the event.',
          variant: 'destructive',
        });
        return false;
      }

      const start = parseStart(workingTask);
      const end = parseEnd(workingTask);
      if (!start || !end) {
        toast({
          title: 'Missing start/end',
          description: 'This task does not have valid start/end times.',
          variant: 'destructive',
        });
        return false;
      }

      const subjectRaw = workingTask.subject || `Interview for ${workingTask['Candidate Name'] || 'candidate'}`;
      const subject = DOMPurify.sanitize(subjectRaw);
      const safeCandidate = DOMPurify.sanitize(workingTask['Candidate Name'] || '');
      const safeClient = DOMPurify.sanitize(workingTask['End Client'] || '');
      const safeRound = DOMPurify.sanitize(workingTask['Interview Round'] || '');
      const safeJoinLink = DOMPurify.sanitize(joinLink);

      const detailsHtml = DOMPurify.sanitize(
        [
          '<div>',
          `<p><strong>Candidate:</strong> ${safeCandidate}</p>`,
          `<p><strong>Client:</strong> ${safeClient}</p>`,
          `<p><strong>Round:</strong> ${safeRound}</p>`,
          `<p><strong>Join:</strong> <a href="${safeJoinLink}" target="_blank" rel="noopener noreferrer">Click to join</a></p>`,
          '</div>',
        ].join(''),
        { ADD_ATTR: ['target', 'rel'] }
      );

      const startLocal = start.clone().tz(TZ).format('YYYY-MM-DDTHH:mm:ss');
      const endLocal = end.clone().tz(TZ).format('YYYY-MM-DDTHH:mm:ss');

      const eventPayload = {
        subject,
        body: {
          contentType: 'HTML',
          content: detailsHtml,
        },
        start: {
          dateTime: startLocal,
          timeZone: WINDOWS_TZ,
        },
        end: {
          dateTime: endLocal,
          timeZone: WINDOWS_TZ,
        },
        attendees: [
          {
            emailAddress: {
              address: 'harsh.patel@silverspaceinc.com',
              name: 'Harsh Patel',
            },
            type: 'required',
          },
        ],
        isOnlineMeeting: true,
        onlineMeetingProvider: 'teamsForBusiness',
        location: { displayName: 'Microsoft Teams Meeting' },
      };

      try {
        const res = await fetch('https://graph.microsoft.com/v1.0/me/events', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(eventPayload),
        });

        if (!res.ok) {
          const errText = await res.text();
          toast({
            title: 'Event creation failed',
            description: DOMPurify.sanitize(errText.slice(0, 200)) || 'Unable to create calendar event.',
            variant: 'destructive',
          });
          return false;
        }

        await res.json();

        toast({
          title: 'Event created',
          description: 'The interview has been added to your Outlook calendar.',
        });
        return true;
      } catch (error) {
        console.error('Outlook event creation failed', error);
        toast({
          title: 'Event creation failed',
          description: 'Unexpected error creating the calendar event.',
          variant: 'destructive',
        });
        return false;
      }
    },
    [
      canManageMeetings,
      toast,
      ensureMicrosoftAccount,
      instance,
      extractJoinLink,
      parseStart,
      parseEnd,
    ]
  );

  const handleCreateMeeting = useCallback(
    async (task: Task) => {
      if (!canManageMeetings) {
        toast({
          title: 'Meetings unavailable',
          description: 'Microsoft Teams integration is not configured or your role is not permitted.',
          variant: 'destructive',
        });
        return;
      }

      setMeetingBusyState(task._id, true);

      try {
        const activeAccount = await ensureMicrosoftAccount();
        if (!activeAccount) {
          return;
        }

        let consentOk = false;
        try {
          consentOk = await checkMeetingConsent(instance, activeAccount);
        } catch (error) {
          console.warn('Consent check failed', error);
        }

        if (!consentOk) {
          const granted = await openConsentAndPoll(instance, activeAccount);
          await refreshConsent();
          if (!granted) {
            toast({
              title: 'Consent required',
              description: 'Please grant Microsoft Graph consent to create meetings.',
              variant: 'destructive',
            });
            return;
          }
        }

        let userToken = '';
        try {
          userToken = await acquireBackendToken(instance, activeAccount, API_SCOPE || undefined);
        } catch (error) {
          console.error('Failed to acquire backend token', error);
          toast({
            title: 'Authorization failed',
            description: 'Sign in again to Microsoft and retry.',
            variant: 'destructive',
          });
          return;
        }

        if (!userToken) {
          toast({
            title: 'Authorization pending',
            description: 'Complete the Microsoft sign-in flow and try again.',
            variant: 'destructive',
          });
          return;
        }

        const subjectRaw = task.subject || `Interview for ${task["Candidate Name"] || 'candidate'}`;
        const subject = DOMPurify.sanitize(subjectRaw);
        const payload: Record<string, unknown> = {
          subject,
          taskId: task._id,
          recordAutomatically: true,
        };

        const start = parseStart(task);
        const adjusted = new Date(start.toDate().getTime() - (35 * 60 * 1000));
        // Format nicely in EDT
        const edtTime = adjusted.toLocaleString("en-US", {
          timeZone: "America/New_York",
          hour: "numeric",
          minute: "2-digit",
          hour12: true
        });
        if (start) {
          payload.startDateTime = start.toDate().toISOString();
        }

        const end = parseEnd(task);
        if (end) {
          payload.endDateTime = end.toDate().toISOString();
        }

        const response = await fetch(`${API_BASE}/api/graph/meetings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${userToken}`,
          },
          body: JSON.stringify(payload),
        });

        if (response.status === 403) {
          toast({
            title: 'Consent required',
            description: 'Grant Microsoft consent and try again.',
            variant: 'destructive',
          });
          await refreshConsent();
          return;
        }

        if (response.status === 503) {
          toast({
            title: 'Microsoft integration unavailable',
            description: 'The backend is not configured for Teams meetings.',
            variant: 'destructive',
          });
          return;
        }

        if (!response.ok) {
          const errorBody = await response.text();
          toast({
            title: 'Meeting creation failed',
            description: DOMPurify.sanitize(errorBody.slice(0, 200)) || 'Unexpected error creating meeting.',
            variant: 'destructive',
          });
          return;
        }

        const data = await response.json();
        const joinUrl = typeof data?.joinUrl === 'string' ? data.joinUrl : '';
        const joinWebUrl = typeof data?.joinWebUrl === 'string' ? data.joinWebUrl : '';

        setTasks((prev) =>
          prev.map((item) =>
            item._id === task._id
              ? {
                  ...item,
                  joinUrl,
                  joinWebUrl,
                }
              : item
          )
        );

        const resolvedLink = extractJoinLink({ ...task, joinUrl, joinWebUrl });
        if (resolvedLink) {
          try {
            await navigator.clipboard.writeText(resolvedLink);
            toast({
              title: 'Teams meeting created',
              description: 'Join link copied to your clipboard.',
            });
          } catch (error) {
            console.warn('Failed to copy Teams link', error);
            toast({
              title: 'Teams meeting created',
              description: `Join link: ${resolvedLink}`,
            });
          }

          await createOutlookEvent(task, activeAccount, { joinUrl, joinWebUrl });

          const recipientRaw = task['Email ID'] ?? '';
          const recipientEmail = typeof recipientRaw === 'string' ? recipientRaw.trim() : '';
          console.log('recipientRaw', recipientRaw);
          console.log('recipientEmail', recipientEmail);
          if (recipientEmail) {
            try {
              await fetch('https://default4ece6d1e592c44f1b1876076e91805.10.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/f9e4c56d839c42539f80c0bdcf9c4002/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=NCFHcyOAQ0WygZWYNIby6IlMKTQNiI87Rs7Kbv43Cj8', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  to: recipientEmail,
                  subject: `Join Meeting at ${edtTime} EST`,
                  body: resolvedLink,
                  start: start ? start.toDate().toISOString() : undefined
                }),
              });
            } catch (error) {
              console.error('Failed to notify via Google Apps Script', error);
            }
          }
        } else {
          toast({
            title: 'Teams meeting created',
            description: 'Meeting created but join link was not provided.',
          });
        }
      } catch (error) {
        console.error('Teams meeting creation failed', error);
        toast({
          title: 'Meeting creation failed',
          description: 'Unexpected error creating a Microsoft Teams meeting.',
          variant: 'destructive',
        });
      } finally {
        setMeetingBusyState(task._id, false);
      }
    },
    [
      canManageMeetings,
      toast,
      setMeetingBusyState,
      ensureMicrosoftAccount,
      instance,
      refreshConsent,
      parseStart,
      parseEnd,
      acquireBackendToken,
      checkMeetingConsent,
      openConsentAndPoll,
      API_BASE,
      API_SCOPE,
      extractJoinLink,
      createOutlookEvent,
    ]
  );


  const formatDate = (m: Moment | null) => (m ? m.tz(TZ).format(DATE_FMT) : "");
  const formatTime = (m: Moment | null) => (m ? m.tz(TZ).format(TIME_FMT) : "");

  // === Reminder key helpers ===
  const reminderKeyFor = (t: Task, start: Moment) => `${t._id}|${start.toISOString()}`;

  // === Schedule a long timeout by chaining if needed ===
  const ensureLargeTimeout = (key: string, ms: number, onFire: () => void) => {
    // If already scheduled, skip
    if (timersRef.current.has(key)) return;

    if (ms > MAX_DELAY) {
      const id = window.setTimeout(() => {
        timersRef.current.delete(key);
        ensureLargeTimeout(key, ms - MAX_DELAY, onFire);
      }, MAX_DELAY);
      timersRef.current.set(key, id);
      return;
    }

    const id = window.setTimeout(() => {
      timersRef.current.delete(key);
      onFire();
    }, Math.max(0, ms));
    timersRef.current.set(key, id);
  };

  // === Fire a reminder ===
  const fireReminder = (key: string, t: Task, firedSet: Set<string>) => {
    if (firedSet.has(key)) return; // already fired
    const subj = DOMPurify.sanitize(t.subject || "");
    toast({ title: "Interview Reminder", description: subj });
    sendNotification("Interview Reminder", subj);
    playTune();
    firedSet.add(key);
    writeFired(firedSet);

    // Remove from schedule store after firing
    const scheduled = readScheduled();
    delete scheduled[key];
    writeScheduled(scheduled);
  };

  // === Reconcile reminder schedules with tasks (persist + schedule timers) ===
  const reconcileReminders = useCallback(
    (incoming: Task[]) => {
      const now = moment.tz(TZ);
      const scheduled = readScheduled(); // key -> triggerAtISO
      const firedSet = readFired();

      // Build a set of valid keys from current tasks
      const validKeys = new Set<string>();

      for (const t of incoming) {
        const start = parseStart(t);
        if (!start || !start.isValid()) continue;

        const triggerAt = start.clone().subtract(MINUTES_BEFORE, "minutes");
        if (!triggerAt.isAfter(now)) continue; // skip past/too late

        const key = reminderKeyFor(t, start);
        validKeys.add(key);

        // If already fired, skip
        if (firedSet.has(key)) {
          // ensure it's not lingering in schedule store
          if (scheduled[key]) {
            delete scheduled[key];
          }
          continue;
        }

        // If not scheduled or trigger time changed, (re)schedule & persist
        const triggerISO = triggerAt.toISOString();
        if (scheduled[key] !== triggerISO) {
          // Update persistence
          scheduled[key] = triggerISO;

          // Clear any previous timer for this key
          const oldId = timersRef.current.get(key);
          if (oldId) {
            window.clearTimeout(oldId);
            timersRef.current.delete(key);
          }

          // Schedule new timer (with long-delay support)
          const delay = triggerAt.diff(now);
          ensureLargeTimeout(key, delay, () => fireReminder(key, t, firedSet));
        } else {
          // Already persisted; ensure a timer exists (reschedule on mount/reloads)
          if (!timersRef.current.has(key)) {
            const delay = triggerAt.diff(now);
            if (delay > 0) {
              ensureLargeTimeout(key, delay, () => fireReminder(key, t, firedSet));
            } else {
              // If it's already due but not fired, fire immediately and clean up
              fireReminder(key, t, firedSet);
            }
          }
        }
      }

      // Remove schedules for keys that are no longer valid (task removed or changed time)
      for (const schedKey of Object.keys(scheduled)) {
        if (!validKeys.has(schedKey)) {
          // cancel timer if exists
          const id = timersRef.current.get(schedKey);
          if (id) {
            window.clearTimeout(id);
            timersRef.current.delete(schedKey);
          }
          delete scheduled[schedKey];
        }
      }

      writeScheduled(scheduled);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // === Fetch & socket wiring ===
  const readMap = (): Record<string, string> =>
    JSON.parse(localStorage.getItem(TASK_STATUS_MAP) || "{}");
  const writeMap = (m: Record<string, string>) =>
    localStorage.setItem(TASK_STATUS_MAP, JSON.stringify(m));

  const fetchTasks = useCallback(() => {
    const payload = { ...buildDashboardPayload({ ...filters, dateField: selectedTabRef.current as any }) };
    socket.emit(
      "getTasksByRange",
      payload,
      (resp: { success: boolean; tasks?: Task[]; error?: string }) => {
        if (!resp.success) {
          setError(resp.error || "Failed to load tasks");
          toast({
            title: "Error",
            description: resp.error || "Failed to load tasks",
            variant: "destructive",
          });
          return;
        }

        const incoming = sortByPrimaryStart(resp.tasks || []);

        // Notifications only when viewing Today (not upcoming)
        const isTodayView = filters.range === 'day' && !filters.upcoming && moment(filters.dayDate).isSame(moment.tz(TZ), 'day');
        const oldMap = readMap();
        const newMap: Record<string, string> = {};
        incoming.forEach((task) => {
          const seenBefore = seenTasksRef.current.has(task._id) || Object.prototype.hasOwnProperty.call(oldMap, task._id);
          newMap[task._id] = task.status || "";
          seenTasksRef.current.add(task._id);
          if (!firstLoad.current && isTodayView) {
            if (!seenBefore) {
              const desc = DOMPurify.sanitize(task.subject || "");
              toast({ title: "New Task Added", description: desc });
              sendNotification("New Task Added", desc);
              playTune();
            } else if (oldMap[task._id] !== task.status) {
              const desc = DOMPurify.sanitize(task.subject || "");
              const s = DOMPurify.sanitize(task.status || "");
              toast({
                title: "Task Status Updated",
                description: `${desc} is now ${s}`,
              });
              sendNotification("Task Status Updated", `${desc} is now ${s}`);
              playTune();
            }
          }
        });
        writeMap(newMap);
        firstLoad.current = false;

        setTasks(incoming);

        // Schedule reminders only for today's interviews view
        if (isTodayView) {
          reconcileReminders(incoming);
        }
      }
    );
  }, [socket, toast, reconcileReminders, sortByPrimaryStart, filters]);

  useEffect(() => {
    const onNew = (task: Task) => {
      const isInit = firstLoad.current;
      const map = readMap();
      const isTodayView = filters.range === 'day' && !filters.upcoming && moment(filters.dayDate).isSame(moment.tz(TZ), 'day');

      if (!isInCurrentFilters(task)) {
        if (map[task._id]) {
          delete map[task._id];
          writeMap(map);
        }
        setTasks((prev) => {
          const filtered = prev.filter((t) => t._id !== task._id);
          const sorted = sortByPrimaryStart(filtered);
          if (isTodayView) reconcileReminders(sorted);
          return sorted;
        });
        return;
      }

      const alreadyTracked = map[task._id] !== undefined;
      const wasSeen = seenTasksRef.current.has(task._id);
      map[task._id] = task.status || "";
      seenTasksRef.current.add(task._id);
      writeMap(map);

      setTasks((prev) => {
        const exists = prev.some((t) => t._id === task._id);
        const next = exists ? prev.map((t) => (t._id === task._id ? task : t)) : [...prev, task];
        const sorted = sortByPrimaryStart(next);
        if (isTodayView) reconcileReminders(sorted);
        return sorted;
      });

      if (!isInit && !alreadyTracked && !wasSeen && isTodayView) {
        const desc = DOMPurify.sanitize(task.subject || "");
        toast({ title: "New Task Added", description: desc });
        sendNotification("New Task Added", desc);
        playTune();
      }
    };

    const onUpdate = (task: Task) => {
      const map = readMap();
      const previousStatus = map[task._id] || "";
      const isTodayView = filters.range === 'day' && !filters.upcoming && moment(filters.dayDate).isSame(moment.tz(TZ), 'day');

      if (!isInCurrentFilters(task)) {
        if (map[task._id]) {
          delete map[task._id];
          writeMap(map);
        }
        setTasks((list) => {
          const filtered = list.filter((t) => t._id !== task._id);
          const sorted = sortByPrimaryStart(filtered);
          if (isTodayView) reconcileReminders(sorted);
          return sorted;
        });
        return;
      }

      map[task._id] = task.status || "";
      seenTasksRef.current.add(task._id);
      writeMap(map);

      setTasks((list) => {
        const next = list.map((t) => (t._id === task._id ? task : t));
        const sorted = sortByPrimaryStart(next);
        if (isTodayView) reconcileReminders(sorted);
        return sorted;
      });

      if (isTodayView && previousStatus !== (task.status || "")) {
        const desc = DOMPurify.sanitize(task.subject || "");
        const statusDesc = DOMPurify.sanitize(task.status || "");
        toast({
          title: "Task Status Updated",
          description: `${desc} is now ${statusDesc}`,
        });
        sendNotification("Task Status Updated", `${desc} is now ${statusDesc}`);
        playTune();
      }
    };

    const onAuthError = async (err: Error) => {
      if (err.message !== "Unauthorized") return;
      const ok = await refreshAccessToken();
      if (!ok) return socket.disconnect();
      socket.auth = { token: localStorage.getItem("accessToken") || "" };
      socket.once("connect", fetchTasks);
      socket.connect();
    };

    socket.on("taskCreated", onNew);
    socket.on("taskUpdated", onUpdate);
    socket.on("connect_error", onAuthError);

    socket.once("connect", fetchTasks);
    socket.connect();

    const interval = setInterval(fetchTasks, 60_000);

    return () => {
      socket.off("taskCreated", onNew);
      socket.off("taskUpdated", onUpdate);
      socket.off("connect_error", onAuthError);
      socket.disconnect();
      clearInterval(interval);

      // Clean all timers
      for (const [, id] of timersRef.current.entries()) window.clearTimeout(id);
      timersRef.current.clear();
    };
  }, [socket, toast, refreshAccessToken, fetchTasks, reconcileReminders, isTodayForCurrentTab, sortByPrimaryStart]);

  // When filters change, refetch
  useEffect(() => {
    if (socket.connected) fetchTasks();
  }, [filters.range, filters.start, filters.end, filters.dateField, filters.upcoming, fetchTasks, socket]);

  // === Filtering / sorting ===
  const teamLeadOptions = useMemo(() => {
    const base = Object.entries(teamLeadData)
      .map(([value, entry]) => ({ value, label: formatNameInput(entry.label) || entry.label }))
      .filter((option) => option.label)
      .sort((a, b) => a.label.localeCompare(b.label));

    return [{ value: 'all', label: 'All Team Leads' }, ...base];
  }, [teamLeadData]);

  const teamLeadRecruiterMap = useMemo(() => {
    const map = new Map<string, Set<string>>();

    const addNormalized = (target: Set<string>, name: string | null | undefined) => {
      if (!name) return;
      const normalized = formatNameInput(name).toLowerCase();
      if (normalized) {
        target.add(normalized);
      }
    };

    Object.entries(teamLeadData).forEach(([key, entry]) => {
      const set = new Set<string>();

      addNormalized(set, entry.label);
      set.add(key);

      entry.recruiters.forEach((recruiter) => addNormalized(set, recruiter));
      entry.mleadNames.forEach((lead) => addNormalized(set, lead));

      if (entry.role === 'mam') {
        // Ensure the MAM's own name is always present even if formatting differs
        addNormalized(set, entry.label);
      }

      map.set(key, set);
    });

    return map;
  }, [teamLeadData]);

  const statuses = Array.from(new Set(tasks.map((t) => t.status).filter(Boolean)));

  const sortedTasks = useMemo(() => sortByPrimaryStart(tasks), [tasks, sortByPrimaryStart]);

  const displayed = sortedTasks
    .filter((t) => {
      const s = primaryStart(t);
      return !!s;
    })
    .filter((t) => filterStatus === "all" || t.status === filterStatus)
    .filter((t) =>
      (t["Candidate Name"] || "").toLowerCase().includes(candidateFilter.toLowerCase())
    )
    .filter((t) =>
      (t.assignedExpert || "").toLowerCase().includes(expertFilter.toLowerCase())
    )
    .filter((t) => {
      if (selectedTeamLead === 'all') return true;
      const recruiters = teamLeadRecruiterMap.get(selectedTeamLead);
      if (!recruiters || recruiters.size === 0) return false;
      const recruiterDisplay = formatNameInput(t.recruiterName || '');
      if (!recruiterDisplay) return false;
      return recruiters.has(recruiterDisplay.toLowerCase());
    })
    .filter((t) =>
      user !== 'user'
        ? (t.recruiterName || "").toLowerCase().includes(recruiterFilter.toLowerCase())
        : true
    );


  return (
    <DashboardLayout>
      <Toaster />
      <div className="p-4 space-y-4">
        {error && <p className="text-red-500">{error}</p>}


        {canManageMeetings && account && needsConsent && !hideGrantConsentBanner && (
          <OnlineMeetingConsentBanner
            checking={consentChecking}
            error={consentError}
            onGrant={() => {
              void grantConsent();
            }}
          />
        )}

        {/* Additional filters */}
        <div className="flex flex-wrap gap-4 items-center">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s} value={s!}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder="Filter candidate"
            value={candidateFilter}
            onChange={(e) => setCandidateFilter(e.target.value)}
            className="w-40"
          />
          <Input
            placeholder="Filter expert"
            value={expertFilter}
            onChange={(e) => setExpertFilter(e.target.value)}
            className="w-40"
          />
          {(normalizedRole === 'mm' || normalizedRole === 'mam') && (
            <Select
              value={selectedTeamLead}
              onValueChange={setSelectedTeamLead}
              disabled={teamLeadLoading || teamLeadOptions.length <= 1}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder={teamLeadLoading ? "Loading team leads" : "All Team Leads"} />
              </SelectTrigger>
              <SelectContent>
                {teamLeadOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(user === "MAM" || user === "MM") && (
            <Input
              placeholder="Filter recruiter"
              value={recruiterFilter}
              onChange={(e) => setRecruiterFilter(e.target.value)}
              className="w-40"
            />
          )}

          {/* Toggle: Subject column visibility */}
          <div className="flex items-center gap-2 ml-auto">
            <Switch id="toggle-subject" checked={showSubject} onCheckedChange={setShowSubject} />
            <label htmlFor="toggle-subject" className="text-sm text-muted-foreground select-none">
              Show Subject
            </label>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setFiltersOpen((prev) => !prev)}
              aria-label={filtersOpen ? 'Hide dashboard filters' : 'Show dashboard filters'}
              aria-expanded={filtersOpen}
            >
              <Filter className="h-5 w-5" />
              <span className="sr-only">Toggle filters</span>
            </Button>
          </div>
        </div>

        {filtersOpen && (
          <DashboardFilters filters={filters} onChange={setFilters} allowReceivedDate={allowReceivedDate} />
        )}

        {teamLeadError && (normalizedRole === 'mm' || normalizedRole === 'mam') && (
          <p className="text-sm text-red-500">{teamLeadError}</p>
        )}

        {displayed.length === 0 ? (
          <p>No tasks found for the selected filters.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {showSubject && <TableHead>Subject</TableHead>}
                <TableHead>Candidate</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Round</TableHead>
                <TableHead>Expert</TableHead>
                {(user !== "user") && <TableHead>Suggestions</TableHead>}
                {(user === "MAM" || user === "MM" || user === "mlead") && <TableHead>Recruiter</TableHead>}
                <TableHead>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-help select-none font-semibold text-sm tracking-wide">
                        TxAv
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Green when a transcript is available; red when missing.</p>
                    </TooltipContent>
                  </Tooltip>
                </TableHead>
                {meetingsEnabled && <TableHead>Meeting</TableHead>}
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.map((task) => {
                const start = parseStart(task);
                const end = parseEnd(task);
                const isMeetingBusy = Boolean(meetingBusy[task._id]);
                const joinLink = extractJoinLink(task);
                const storedThanksDraft = loadThanksMailFromStorage(task._id);
                const canOpenThanksMail = Boolean(task.transcription || storedThanksDraft);
                return (
                  <TableRow key={task._id} className={getRowClasses(task.status)}>
                    {showSubject && (
                      <TableCell>{DOMPurify.sanitize(task.subject || "")}</TableCell>
                    )}
                    <TableCell>{DOMPurify.sanitize(task["Candidate Name"] || "")}</TableCell>
                    <TableCell>{formatDate(start)}</TableCell>
                    <TableCell>{formatTime(start)}</TableCell>
                    <TableCell>{formatTime(end)}</TableCell>
                    <TableCell>{DOMPurify.sanitize(task["End Client"] || "")}</TableCell>
                    <TableCell>{DOMPurify.sanitize(task["Interview Round"] || "")}</TableCell>
                    <TableCell>{DOMPurify.sanitize(task.assignedExpert || "")}</TableCell>
                    {(user !== "user") && (<TableCell>
                      {DOMPurify.sanitize(
                        (task.suggestions && task.suggestions.length > 0
                          ? task.suggestions.join(", ")
                          : task.candidateExpertDisplay || "Not available")
                      )}
                    </TableCell>)}
                    {(user === "MAM" || user === "MM" || user === "mlead") && (
                      <TableCell>{DOMPurify.sanitize(task.recruiterName || "")}</TableCell>
                    )}
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={`inline-flex h-3 w-3 rounded-full border border-border ${
                              task.transcription ? 'bg-green-500' : 'bg-red-500'
                            }`}
                            role="img"
                            aria-label={
                              task.transcription
                                ? 'Transcription available'
                                : 'Transcription not available'
                            }
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {task.transcription ? 'Transcription available' : 'Transcription not available'}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    {meetingsEnabled && (
                      <TableCell>
                        {joinLink ? (
                          <div className="flex flex-nowrap items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenMeeting(joinLink)}
                            >
                              Join
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                void handleCopyMeeting(joinLink);
                              }}
                              aria-label="Copy link"
                            >
                              <Copy className="h-4 w-4" aria-hidden="true" />
                              <span className="sr-only">Copy link</span>
                            </Button>
                          </div>
                        ) : canManageMeetings ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isMeetingBusy || consentChecking}
                            onClick={() => {
                              void handleCreateMeeting(task);
                            }}
                          >
                            {isMeetingBusy ? 'Creating…' : 'Create meeting'}
                          </Button>
                        ) : null}
                      </TableCell>
                    )}
                    <TableCell>
                      {task.status && (
                        <Badge className={getStatusBadge(task.status)}>{task.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {canCloneSupport || canRequestMock || canGenerateThanksMail ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline">
                              Actions
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canGenerateThanksMail && (
                              <DropdownMenuItem
                                onClick={() => handleOpenThanksMailDialog(task, storedThanksDraft)}
                                disabled={!canOpenThanksMail}
                              >
                                Generate Thanks Mail
                              </DropdownMenuItem>
                            )}
                            {canGenerateThanksMail && (canRequestMock || canCloneSupport) && (
                              <DropdownMenuSeparator />
                            )}
                            {canRequestMock && (
                              <DropdownMenuItem onClick={() => handleOpenMockDialog(task)}>
                                Request Mock
                              </DropdownMenuItem>
                            )}
                            {canCloneSupport && (
                              <DropdownMenuItem onClick={() => handleCloneSupport(task)}>
                                Clone Support Request
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => navigate("/feedback")}
                        >
                          FeedBack
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
      <Dialog open={Boolean(mockDialogTask)} onOpenChange={(open) => !open && closeMockDialog()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Request Mock Interview</DialogTitle>
          </DialogHeader>
          {mockPreview ? (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-red-600">
                Complete the mock before the day of interview.
              </p>
              <p className="text-sm text-muted-foreground">
                Interview Round{" "}
                <span className="font-medium text-foreground">
                  {mockPreview.interviewRound || "Not specified"}
                </span>{" "}
                is scheduled at{" "}
                <span className="font-medium text-foreground">
                  {mockPreview.interviewDisplay}
                </span>
                .
              </p>
              <div className="rounded-md border bg-card">
                <div className="border-b px-4 py-2">
                  <p className="text-sm font-medium text-foreground">Email Subject</p>
                  <p className="text-sm text-muted-foreground break-words">{mockSubject}</p>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      { label: "Candidate Name", value: mockPreview.candidateName },
                      { label: "Email", value: mockPreview.candidateEmail },
                      { label: "Technology", value: mockPreview.technology || "Not specified" },
                      { label: "Phone Number", value: mockPreview.contactNumber || "Not specified" },
                      { label: "End Client", value: mockPreview.endClient || "Not specified" }
                    ].map(({ label, value }) => (
                      <tr key={label} className="border-b last:border-b-0">
                        <th className="w-48 bg-muted px-4 py-2 text-left font-semibold text-muted-foreground">
                          {label}
                        </th>
                        <td className="px-4 py-2 text-foreground">{value || "Not available"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Cached Attachments</p>
                {mockPreview.storedAttachments.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {mockPreview.storedAttachments.map((attachment, index) => {
                      const category = (attachment?.category || '').toString();
                      const hasData = Boolean(attachment?.data && attachment.data.trim());
                      return (
                        <li key={`${attachment?.name || 'attachment'}-${index}`}>
                          {attachment?.name || 'Attachment'}
                          {category ? ` (${category})` : ''}
                          {hasData ? ' — ready to attach' : ' — data unavailable'}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No cached resume or job description found for this task.
                  </p>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="mock-resume">Resume (PDF)</Label>
                  <Input
                    id="mock-resume"
                    type="file"
                    accept="application/pdf"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setMockResumeUpload(file);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    {mockResumeUpload
                      ? `Selected: ${mockResumeUpload.name}`
                      : storedResumeAvailable
                        ? 'Using cached resume.'
                        : 'Upload a resume PDF (max 2 MB).'}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mock-jd">Job Description (PDF)</Label>
                  <Input
                    id="mock-jd"
                    type="file"
                    accept="application/pdf"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setMockJdUpload(file);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    {mockJdUpload
                      ? `Selected: ${mockJdUpload.name}`
                      : storedJdAvailable
                        ? 'Using cached job description.'
                        : 'Upload the job description PDF (max 2 MB).'}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mock-jd-text">Job Description Notes (optional)</Label>
                <Textarea
                  id="mock-jd-text"
                  rows={4}
                  value={mockJobDescription}
                  onChange={(event) => setMockJobDescription(event.target.value)}
                  placeholder="Paste any relevant JD text to include in the email."
                />
              </div>
              {mockError && <p className="text-sm text-red-600">{mockError}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select a task to prepare the mock request.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeMockDialog} disabled={mockSending}>
              Cancel
            </Button>
            <Button onClick={handleMockSend} disabled={mockSending || !mockPreview}>
              {mockSending ? 'Sending…' : 'Send Mock Email'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(thanksDialogTask)} onOpenChange={(open) => !open && closeThanksDialog()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Generate Thank-You Email</DialogTitle>
          </DialogHeader>
          {thanksDialogTask ? (
            <div className="space-y-4">
              <Alert>
                <AlertTitle>GPT-5 usage is limited</AlertTitle>
                <AlertDescription className="text-sm text-muted-foreground">
                  You can generate up to {THANKS_MAIL_LIMIT} drafts every {THANKS_MAIL_WINDOW_HOURS} hours. The draft is stored locally for {thanksDialogTask["Candidate Name"] || 'this candidate'} so you can reuse or tweak it without another API call.
                </AlertDescription>
              </Alert>
              {!thanksDialogTask.transcription && (
                <Alert variant="destructive">
                  <AlertTitle>Transcript missing</AlertTitle>
                  <AlertDescription>
                    TxAv is unavailable. You can review saved drafts below, but generating a new email requires the recorded transcript.
                  </AlertDescription>
                </Alert>
              )}
              <p className="text-xs text-muted-foreground">
                Generating a draft can take up to a minute. Feel free to keep working—the app will notify you when the email is ready.
              </p>
              {thanksMailGeneratedAt && (
                <p className="text-xs text-muted-foreground">
                  Last generated on {new Date(thanksMailGeneratedAt).toLocaleString()}
                </p>
              )}
              <div className="rounded-md border bg-card/30 p-4">
                {sanitizedThanksMailHtml ? (
                  <div
                    className="space-y-2 text-sm leading-6 text-foreground"
                    dangerouslySetInnerHTML={{ __html: sanitizedThanksMailHtml }}
                  />
                ) : thanksMailContent ? (
                  <pre className="whitespace-pre-wrap text-sm text-foreground">
                    {thanksMailContent}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No draft yet. Generate a thank-you email to see it here.
                  </p>
                )}
              </div>
              {thanksMailRateInfo && (
                <p className="text-xs text-muted-foreground">
                  {thanksMailRateInfo.remaining} of {THANKS_MAIL_LIMIT} requests remaining. Resets around{' '}
                  {thanksMailRateInfo.resetAt
                    ? new Date(thanksMailRateInfo.resetAt).toLocaleTimeString()
                    : 'the next window'}.
                </p>
              )}
              {thanksMailError && <p className="text-sm text-red-600">{thanksMailError}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select a task with TxAv to generate a thank-you email.</p>
          )}
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex w-full flex-col gap-1 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="outline"
                className="sm:w-auto"
                onClick={closeThanksDialog}
                disabled={thanksMailLoading}
              >
                Close
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="sm:w-auto"
                onClick={handleCopyThanksMail}
                disabled={!thanksMailContent}
              >
                Copy email
              </Button>
            </div>
            <Button
              type="button"
              onClick={handleGenerateThanksMail}
              disabled={thanksMailLoading || !thanksDialogTask?.transcription}
              className="sm:w-auto"
            >
              {thanksMailLoading ? 'Generating… (takes up to a minute)' : 'Generate with GPT-5'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
