// src/pages/Reports.tsx
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import moment, { Moment } from 'moment-timezone';
import { io, Socket } from 'socket.io-client';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth, SOCKET_URL } from '@/hooks/useAuth';
import { useTab } from '@/hooks/useTabs';
import { BarChart3, FileText, Download, Plus, TrendingUp, Users, DollarSign, Target, FileSpreadsheet } from 'lucide-react';

// If multi-sheet Excel is desired:
// npm i xlsx
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as XLSX from 'xlsx';

/** Task shape (aligned with TasksToday) */
interface Task {
  _id: string;
  subject?: string;
  startTime?: string; // "MM/DD/YYYY HH:mm" or ISO
  endTime?: string;
  receivedDateTime?: string; // ISO or "MM/DD/YYYY HH:mm"
  "Candidate Name"?: string;
  "Date of Interview"?: string;
  "Start Time Of Interview"?: string;
  "End Time Of Interview"?: string;
  "End Client"?: string;
  "Interview Round"?: string;
  status?: string;
  assignedEmail?: string;
  assignedExpert?: string;
  recruiterName?: string;
}

const TZ = 'America/New_York';
const PARSE_FMT = 'MM/DD/YYYY HH:mm';
const DATE_FMT = 'MM/DD/YYYY';
const TIME_FMT = 'hh:mm A';

// ---------- date helpers (same approach as TasksToday) ----------
const parseStart = (t: Task): Moment | null => {
  if (t.startTime) {
    const m = moment.tz(t.startTime, PARSE_FMT, TZ);
    if (m.isValid()) return m;
    const iso = moment.tz(t.startTime, TZ);
    if (iso.isValid()) return iso;
  }
  if (t['Date of Interview'] && t['Start Time Of Interview']) {
    const m = moment.tz(
      `${t['Date of Interview']} ${t['Start Time Of Interview']}`,
      'MM/DD/YYYY hh:mm A',
      TZ
    );
    return m.isValid() ? m : null;
  }
  return null;
};

const parseEnd = (t: Task): Moment | null => {
  if (t.endTime) {
    const m = moment.tz(t.endTime, PARSE_FMT, TZ);
    if (m.isValid()) return m;
    const iso = moment.tz(t.endTime, TZ);
    if (iso.isValid()) return iso;
  }
  return null;
};

const parseReceived = (t: Task): Moment | null => {
  if (t.receivedDateTime) {
    const m = moment.tz(t.receivedDateTime, PARSE_FMT, TZ);
    if (m.isValid()) return m;
    const iso = moment.tz(t.receivedDateTime, TZ);
    if (iso.isValid()) return iso;
  }
  return null;
};

const formatDate = (m: Moment | null) => (m ? m.tz(TZ).format(DATE_FMT) : '');
const formatTime = (m: Moment | null) => (m ? m.tz(TZ).format(TIME_FMT) : '');

// ---------- export helpers ----------
function downloadBlobCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCSV(rows: Record<string, any>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    if (/[",\n]/.test(s)) return `"${s}"`;
    return s;
  };
  const headerLine = headers.map(escape).join(',');
  const lines = rows.map((r) => headers.map((h) => escape(r[h])).join(','));
  return [headerLine, ...lines].join('\n');
}

function buildRow(t: Task, mode: 'DOI' | 'RDT'): Record<string, any> {
  const start = parseStart(t);
  const received = parseReceived(t);
  return {
    Subject: t.subject || '',
    Candidate: t['Candidate Name'] || '',
    Date: formatDate(mode === 'DOI' ? start : received),
    Start: formatTime(start),
    End: formatTime(parseEnd(t)),
    Client: t['End Client'] || '',
    Round: t['Interview Round'] || '',
    Expert: t.assignedExpert || '',
    Recruiter: t.recruiterName || '',
    Status: t.status || '',
  };
}

// ---------- reports ----------
type ReportKind = 'DOI_TODAY' | 'DOI_ALL' | 'RDT_TODAY' | 'RDT_ALL';

const REPORTS_META: { id: ReportKind; name: string; description: string }[] = [
  { id: 'DOI_TODAY', name: 'Date of Interview — Today', description: 'Interviews scheduled today' },
  { id: 'DOI_ALL', name: 'Date of Interview — Upcoming', description: 'Interviews strictly after today' },
  { id: 'RDT_TODAY', name: 'Received Date Time — Today', description: 'Leads received today' },
  { id: 'RDT_ALL', name: 'Received Date Time — Upcoming', description: 'Leads received strictly after today' },
];

export default function Reports() {
  // C20 — normalize on read; accept both legacy and new role names.
  // `mtl` was a stale legacy abbreviation that no user holds anymore.
  const role = useMemo(() => (localStorage.getItem('role') || '').trim().toLowerCase(), []);
  const canUseAssistant = ['admin', 'mm', 'mam', 'manager', 'assistantmanager'].includes(role);
  const { toast } = useToast();
  const { refreshAccessToken } = useAuth();
  const { selectedTab, setSelectedTab } = useTab();

  const allowReceivedDate = useMemo(() => {
    return ['admin', 'mm', 'mam', 'mlead', 'manager', 'assistantmanager', 'teamlead'].includes(role);
  }, [role]);

  const dateFieldOptions = useMemo(() => {
    const base = [
      { value: 'Date of Interview', label: 'Date of Interview' },
    ];
    if (allowReceivedDate) {
      base.push({ value: 'receivedDateTime', label: 'Received Date Time' });
    }
    return base;
  }, [allowReceivedDate]);

  const [loadingId, setLoadingId] = useState<ReportKind | 'ALL' | null>(null);
  const [tasksCache, setTasksCache] = useState<Task[] | null>(null);

  const currentDateField = useMemo(() => {
    if (!allowReceivedDate) {
      return 'Date of Interview';
    }
    return selectedTab === 'receivedDateTime' ? 'receivedDateTime' : 'Date of Interview';
  }, [allowReceivedDate, selectedTab]);

  useEffect(() => {
    if (!allowReceivedDate && selectedTab === 'receivedDateTime') {
      setSelectedTab('Date of Interview');
    }
  }, [allowReceivedDate, selectedTab, setSelectedTab]);

  useEffect(() => {
    setTasksCache(null);
  }, [currentDateField, setTasksCache]);

  const handleDateFieldChange = useCallback(
    (value: string) => {
      setSelectedTab(value);
    },
    [setSelectedTab]
  );

  // dashed-border spinner overlay for Excel generation
  const showExcelOverlay = loadingId === 'ALL';

  const socket: Socket = useMemo(() => {
    const token = localStorage.getItem('accessToken') || '';
    return io(SOCKET_URL, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { token },
    });
  }, []);

  useEffect(() => {
    const onAuthError = async (err: Error) => {
      if (err.message !== 'Unauthorized') return;
      const ok = await refreshAccessToken();
      if (!ok) return socket.disconnect();
      socket.auth = { token: localStorage.getItem('accessToken') || '' };
      socket.connect();
    };
    socket.on('connect_error', onAuthError);
    socket.connect();
    return () => {
      socket.off('connect_error', onAuthError);
      socket.disconnect();
    };
  }, [socket, refreshAccessToken]);

  const fetchTasks = useCallback(async (): Promise<Task[]> => {
    if (tasksCache) return tasksCache;

    return new Promise<Task[]>((resolve) => {
      socket.emit(
        'getTasksToday',
        { tab: currentDateField },
        (resp: { success: boolean; tasks?: Task[]; error?: string }) => {
          if (!resp.success) {
            toast({
              title: 'Error',
              description: resp.error || 'Failed to load data',
              variant: 'destructive',
            });
            resolve([]);
            return;
          }
          const arr = resp.tasks || [];
          setTasksCache(arr);
          resolve(arr);
        }
      );
    });
  }, [socket, toast, tasksCache, currentDateField]);

  const nowNY = moment.tz(TZ);
  const startOfTodayNY = nowNY.clone().startOf('day');
  const endOfTodayNY = nowNY.clone().endOf('day');

  const filterByKind = (tasks: Task[], kind: ReportKind): Task[] => {
    const isToday = (m: Moment | null) => !!m && m.isSame(startOfTodayNY, 'day');
    const isAfterToday = (m: Moment | null) => !!m && m.isAfter(endOfTodayNY);

    switch (kind) {
      case 'DOI_TODAY':
        return tasks.filter((t) => isToday(parseStart(t)));
      case 'DOI_ALL':
        return tasks.filter((t) => isAfterToday(parseStart(t)));
      case 'RDT_TODAY':
        return tasks.filter((t) => isToday(parseReceived(t)));
      case 'RDT_ALL':
        return tasks.filter((t) => isAfterToday(parseReceived(t)));
    }
  };

  const rowsFor = (tasks: Task[], mode: 'DOI' | 'RDT'): Record<string, any>[] =>
    tasks.map((t) => buildRow(t, mode));

  const exportOneCSV = async (kind: ReportKind) => {
    setLoadingId(kind);
    try {
      const tasks = await fetchTasks();
      const filtered = filterByKind(tasks, kind);
      const mode: 'DOI' | 'RDT' = kind.startsWith('DOI') ? 'DOI' : 'RDT';
      const rows = rowsFor(filtered, mode);
      const csv = toCSV(rows);
      const stamp = moment.tz(TZ).format('YYYYMMDD_HHmm');
      downloadBlobCSV(csv, `${kind}_${stamp}.csv`);
      toast({ title: 'Exported CSV', description: `${rows.length} rows` });
    } catch (e: any) {
      toast({ title: 'Export failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setLoadingId(null);
    }
  };

  const exportAllExcel = async () => {
    setLoadingId('ALL');
    try {
      const tasks = await fetchTasks();
      const wb = XLSX.utils.book_new();

      const addSheet = (kind: ReportKind, mode: 'DOI' | 'RDT') => {
        const filtered = filterByKind(tasks, kind);
        const rows = rowsFor(filtered, mode);
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, kind);
      };

      addSheet('DOI_TODAY', 'DOI');
      addSheet('DOI_ALL', 'DOI');
      addSheet('RDT_TODAY', 'RDT');
      addSheet('RDT_ALL', 'RDT');

      const stamp = moment.tz(TZ).format('YYYYMMDD_HHmm');
      XLSX.writeFile(wb, `Reports_${stamp}.xlsx`);
      toast({ title: 'Excel ready', description: 'Generated with 4 sheets' });
    } catch (e: any) {
      toast({ title: 'Export failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setLoadingId(null);
    }
  };

  const iconFor = (type: 'sales' | 'leads' | 'pipeline' | 'activity') => {
    switch (type) {
      case 'sales':
        return DollarSign;
      case 'leads':
        return Target;
      case 'pipeline':
        return TrendingUp;
      case 'activity':
        return Users;
      default:
        return FileText;
    }
  };

  return (
    <DashboardLayout>
      <div className="relative">
        {/* Excel overlay with dashed-border spinner */}
        {showExcelOverlay && (
          <div
            className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center"
            aria-live="assertive"
            aria-busy="true"
            role="alert"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="h-10 w-10 border-2 border-dashed border-primary rounded-full animate-spin" />
              <p className="text-sm font-medium">Generating Excel…</p>
            </div>
          </div>
        )}

        <div className="space-y-6 p-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
              <p className="text-muted-foreground">
                Generate CSVs or a single Excel with 4 sheets (NY timezone filters).
              </p>
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              {canUseAssistant && (
                <Button asChild variant="secondary">
                  <Link to="/reports/assistant">Report Assistant</Link>
                </Button>
              )}
              <Button onClick={exportAllExcel} disabled={loadingId !== null} aria-disabled={loadingId !== null}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Export Excel (4 sheets)
              </Button>
              <Button asChild variant="outline">
                <Link to="/report-details">
                  <Plus className="mr-2 h-4 w-4" />
                  New Report
                </Link>
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Date Field</p>
            <Select value={currentDateField} onValueChange={handleDateFieldChange}>
              <SelectTrigger className="w-full sm:w-60">
                <SelectValue placeholder="Select date field" />
              </SelectTrigger>
              <SelectContent>
                {dateFieldOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quick Stats */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Available Exports</CardTitle>
                <Download className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">4</div>
                <p className="text-xs text-muted-foreground">DOI/RDT • Today/Upcoming</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Timezone</CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{TZ}</div>
                <p className="text-xs text-muted-foreground">Date filters use NY time</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Today’s Window</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-sm">
                  <div>Start: {startOfTodayNY.format('YYYY-MM-DD HH:mm')}</div>
                  <div>End: {endOfTodayNY.format('YYYY-MM-DD HH:mm')}</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Format</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">CSV / XLSX</div>
                <p className="text-xs text-muted-foreground">Click a row for CSV; button for Excel</p>
              </CardContent>
            </Card>
          </div>

          {/* Reports List */}
          <Card>
            <CardHeader>
              <CardTitle>Exportable Reports</CardTitle>
              <CardDescription>Click download to fetch & export just that dataset</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {REPORTS_META.map((r) => {
                  const IconComponent = iconFor('activity');
                  const isBusy = loadingId === r.id || loadingId === 'ALL';
                  const badgeColor = r.id.includes('DOI') ? 'bg-blue-100 text-blue-800' : 'bg-violet-100 text-violet-800';
                  const whenColor = r.id.endsWith('TODAY') ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-800';
                  return (
                    <div
                      key={r.id}
                      className="flex items-center space-x-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-shrink-0">
                        <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                          <IconComponent className="h-6 w-6 text-muted-foreground" />
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold">{r.name}</h3>
                          <div className="flex space-x-2">
                            <Badge className={badgeColor}>
                              {r.id.startsWith('DOI') ? 'Date of Interview' : 'ReceivedDateTime'}
                            </Badge>
                            <Badge className={whenColor}>{r.id.endsWith('TODAY') ? 'Today' : 'Upcoming'}</Badge>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{r.description}</p>
                      </div>

                      {/* CSV Download button (per report) */}
                      <div className="flex items-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => exportOneCSV(r.id)}
                          disabled={isBusy}
                          aria-disabled={isBusy}
                        >
                          {loadingId === r.id ? (
                            <div className="h-4 w-4 border-2 border-dashed border-primary rounded-full animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
