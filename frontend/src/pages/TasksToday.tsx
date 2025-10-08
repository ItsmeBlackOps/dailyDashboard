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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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
}

const TASK_STATUS_MAP = "tasksTodayStatusMap";
const TZ = "America/New_York";
const WINDOWS_TZ = "Eastern Standard Time"; // Teams/Outlook expect Windows TZ names
const PARSE_FMT = "MM/DD/YYYY HH:mm"; // 24h parsing for preferred keys
const LEGACY_FMT = "MM/DD/YYYY hh:mm A"; // legacy input format
const DATE_FMT = "MM/DD/YYYY";
const TIME_FMT = "hh:mm A";

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
          storedAt: new Date().toISOString()
        };

        localStorage.setItem('supportCloneDraft', JSON.stringify(payload));
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
    [canCloneSupport, navigate, parseStart, parseEnd, toast, prepareCloneAttachments]
  );

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
                      {canCloneSupport ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleCloneSupport(task)}
                        >
                          Clone
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">No access</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </DashboardLayout>
  );
}
