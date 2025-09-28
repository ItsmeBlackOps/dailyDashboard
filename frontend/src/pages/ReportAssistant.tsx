import { useCallback, useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import * as XLSX from 'xlsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { Send, Download } from 'lucide-react';

const ALLOWED_ROLES = new Set(['admin', 'MM', 'MAM', 'mtl', 'MTL']);
const PREVIEW_LIMIT = 50;

interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface ReportColumn {
  key: string;
  label: string;
}

interface ReportPreviewResponse {
  success: boolean;
  summary: string;
  token: string;
  columns: ReportColumn[];
  rows: Record<string, string>[];
  total: number;
  previewCount: number;
  truncated: boolean;
  error?: string;
}

interface ReportDownloadResponse {
  success: boolean;
  filename: string;
  columns: ReportColumn[];
  rows: Record<string, string>[];
  error?: string;
}

const ReportAssistant = () => {
  const role = useMemo(() => localStorage.getItem('role') || '', []);
  const canUseAssistant = ALLOWED_ROLES.has(role);
  const { refreshAccessToken } = useAuth();
  const { toast } = useToast();

  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [reportToken, setReportToken] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [columns, setColumns] = useState<ReportColumn[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isTruncated, setIsTruncated] = useState(false);

  const socket: Socket | null = useMemo(() => {
    if (!canUseAssistant) return null;
    const token = localStorage.getItem('accessToken') || '';
    return io(API_URL, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { token }
    });
  }, [canUseAssistant]);

  useEffect(() => {
    if (!socket) return;

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

  const appendMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        role,
        content,
        timestamp: new Date().toISOString()
      }
    ]);
  }, []);

  const handleSend = useCallback(() => {
    if (!socket || loading) return;
    const trimmed = input.trim();
    if (!trimmed) return;

    appendMessage('user', trimmed);
    setInput('');
    setLoading(true);

    socket.emit(
      'reportBotQuery',
      { message: trimmed },
      (resp: ReportPreviewResponse) => {
        setLoading(false);
        if (!resp?.success) {
          const error = resp?.error || 'Unable to generate report';
          toast({ title: 'Report assistant', description: error, variant: 'destructive' });
          appendMessage('assistant', error);
          return;
        }

        setReportToken(resp.token);
        setSummary(resp.summary);
        setColumns(resp.columns || []);
        setRows(resp.rows || []);
        setTotalCount(resp.total || 0);
        setIsTruncated(Boolean(resp.truncated));
        appendMessage('assistant', resp.summary || 'Here is the requested report.');
      }
    );
  }, [socket, loading, input, appendMessage, toast]);

  const handleDownload = useCallback(() => {
    if (!socket || !reportToken) return;
    setDownloading(true);

    socket.emit(
      'reportBotDownload',
      { token: reportToken },
      (resp: ReportDownloadResponse) => {
        setDownloading(false);
        if (!resp?.success) {
          toast({
            title: 'Download failed',
            description: resp?.error || 'Unable to prepare the file',
            variant: 'destructive'
          });
          return;
        }

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(resp.rows || []);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
        const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

        const blob = new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = resp.filename || 'report.xlsx';
        link.click();
        URL.revokeObjectURL(link.href);
      }
    );
  }, [socket, reportToken, toast]);

  if (!canUseAssistant) {
    return (
      <DashboardLayout>
        <Card>
          <CardHeader>
            <CardTitle>Report Assistant</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              The report assistant is available for reporting roles only. Please contact your administrator if you believe this is an error.
            </p>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">Report Assistant</h1>
          <p className="text-muted-foreground text-sm">
            Ask for interview or lead reports in plain language. The assistant will translate the request into a MongoDB query, preview the results, and let you download them as a spreadsheet.
          </p>
        </div>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Conversation</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 min-h-[360px]">
            <div className="flex-1 flex flex-col rounded-md border border-border/60 bg-muted/10 p-3">
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Try queries such as “Show completed interviews for Anita between Sept 1 and Sept 5” or “Leads received last week for recruiter John”.
                  </p>
                ) : (
                  messages.map((msg, idx) => (
                    <div
                      key={`${msg.timestamp}-${idx}`}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                          msg.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background border border-border/60 text-foreground'
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Describe the report you need (e.g. “Expert wise summary for final round this month”)."
                rows={4}
                disabled={loading}
              />
              <div className="flex justify-end gap-2">
                {summary && (
                  <Badge variant="outline" className="self-center whitespace-nowrap">
                    Previewing {rows.length} of {totalCount} rows
                  </Badge>
                )}
                <Button onClick={handleSend} disabled={loading || !socket}>
                  <Send className="h-4 w-4 mr-2" />
                  {loading ? 'Asking…' : 'Ask'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <CardTitle>Report Preview</CardTitle>
              {summary && <p className="text-sm text-muted-foreground leading-snug">{summary}</p>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {summary && (
                <Badge variant="outline" className="whitespace-nowrap">
                  Previewing {rows.length} of {totalCount} rows
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                disabled={!reportToken || downloading || rows.length === 0}
              >
                <Download className="h-4 w-4 mr-1" />
                {downloading ? 'Preparing…' : 'Download'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Submit a request to see a preview table here. Only the first {PREVIEW_LIMIT} rows are shown; the full dataset is available in the download.
              </p>
            ) : (
              <div className="max-h-[420px] w-full overflow-auto rounded-md border border-border/60">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {columns.map((col) => (
                        <TableHead key={col.key}>{col.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        {columns.map((col) => (
                          <TableCell key={`${row.id}-${col.key}`}>{row[col.key] ?? ''}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {isTruncated && (
              <p className="text-xs text-muted-foreground">
                Preview truncated. Download the report to see all rows.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default ReportAssistant;
