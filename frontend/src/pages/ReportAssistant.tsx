```
import { useCallback, useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import * as XLSX from 'xlsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { useAuth, SOCKET_URL } from '@/hooks/useAuth';
import { Send, Download, Paperclip, Smile } from 'lucide-react';
import { cn } from '@/lib/utils';

import { PERMISSIONS } from "@/config/permissions";

// const ALLOWED_ROLES = new Set(['admin', 'MM', 'MAM', 'mtl', 'MTL']); // Replaced by config
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
  const { refreshAccessToken, hasPermission } = useAuth();
  const canUseAssistant = hasPermission(PERMISSIONS.VIEW_REPORT_ASSISTANT);
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
    return io(SOCKET_URL, {
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
/          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col h-[480px] w-full rounded-lg border border-border/60 bg-background shadow-sm">
              <div className="flex items-center justify-between p-3 border-b bg-primary text-primary-foreground rounded-t-lg">
                <div className="flex items-center gap-2">
                  <Avatar className="w-8 h-8">
                    <AvatarImage src="/placeholder.svg" alt="Report assistant" />
                    <AvatarFallback>RA</AvatarFallback>
                  </Avatar>
                  <div className="leading-tight">
                    <p className="text-sm font-medium">Report Assistant</p>
                    <p className="text-xs opacity-90">Ask for interview or lead reports</p>
                  </div>
                </div>
                <Badge variant="secondary" className="bg-primary-foreground/20 text-primary-foreground">
                  Live support
                </Badge>
              </div>

              <ScrollArea className="flex-1 p-3">
                <div className="space-y-3">
                  {messages.length === 0 ? (
                    <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                      Try queries such as “Show completed interviews for Anita between Sept 1 and Sept 5” or “Leads received last week for recruiter John”.
                    </div>
                  ) : (
                    messages.map((msg, idx) => (
                      <div
                        key={`${ msg.timestamp } -${ idx } `}
                        className={cn('flex gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                      >
                        {msg.role === 'assistant' && (
                          <Avatar className="w-6 h-6">
                            <AvatarImage src="/placeholder.svg" alt="Assistant" />
                            <AvatarFallback>RA</AvatarFallback>
                          </Avatar>
                        )}
                        <div
                          className={cn(
                            'max-w-[70%] rounded-lg px-3 py-2 text-sm shadow-sm',
                            msg.role === 'user'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-foreground'
                          )}
                        >
                          <p>{msg.content}</p>
                          <p className="mt-1 text-xs opacity-70">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>

              <div className="border-t p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                    <Paperclip className="h-4 w-4" />
                    <span className="sr-only">Attach file (coming soon)</span>
                  </Button>
                  <Input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Describe the report you need…"
                    className="flex-1"
                    disabled={loading}
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                    <Smile className="h-4 w-4" />
                    <span className="sr-only">Insert emoji (coming soon)</span>
                  </Button>
                  <Button size="icon" className="h-8 w-8" onClick={handleSend} disabled={loading || !socket}>
                    <Send className="h-4 w-4" />
                    <span className="sr-only">Send message</span>
                  </Button>
                </div>
                {summary && (
                  <Badge variant="outline" className="whitespace-nowrap">
                    Previewing {rows.length} of {totalCount} rows
                  </Badge>
                )}
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
                          <TableCell key={`${ row.id } -${ col.key } `}>{row[col.key] ?? ''}</TableCell>
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
