import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { usePostHog } from 'posthog-js/react'; // [Harsh] PostHog
import DOMPurify from "dompurify";
import { io, Socket } from "socket.io-client";
import { MessageSquare } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { SOCKET_URL, useAuth } from "@/hooks/useAuth";
import { ResumeDiscussionDrawer } from "@/components/resume/ResumeDiscussionDrawer";



function formatEmailDisplay(value: string): string {
  if (!value) return '';
  const local = value.includes('@') ? value.split('@')[0] : value;
  return local
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ');
}

type QueueStatus = "pending" | "done";

interface CandidateRecord {
  id: string;
  name: string;
  branch: string;
  recruiter: string;
  technology: string;
  email: string;
  contact: string;
  expert: string;
  expertRaw?: string;
  resumeUnderstandingStatus?: QueueStatus;
  workflowStatus?: string;
  updatedAt?: string;
  resumeUnderstanding?: boolean;
  resumeLink?: string;
}

interface QueueResponse {
  success: boolean;
  status: QueueStatus;
  candidates?: CandidateRecord[];
  error?: string;
}

interface UpdateResponse {
  success: boolean;
  candidate?: CandidateRecord;
  error?: string;
}

const STATUS_LABELS: Record<QueueStatus, string> = {
  pending: "Pending",
  done: "Completed"
};

export default function ResumeUnderstanding() {
  const posthog = usePostHog(); // [Harsh] Analytics
  const { toast } = useToast();
  const { refreshAccessToken } = useAuth();
  const role = useMemo(() => (localStorage.getItem("role") || "").trim().toLowerCase(), []);
  const allowed = useMemo(
    () => ["expert", "user", "lead", "am", "recruiter", "manager", "admin", "mlead", "mam", "mm"].includes(role),
    [role]
  );
  const showCompletedTab = role !== 'user' && role !== 'expert';
  // 'user' role is usually the Expert.
  // We want Recruiters to see completed tab? Yes.

  const shouldFilterByExpert = useMemo(
    () => ["expert", "user"].includes(role),
    [role]
  );

  const [activeStatus, setActiveStatus] = useState<QueueStatus>("pending");
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateRecord | null>(null);

  const [queues, setQueues] = useState<Record<QueueStatus, CandidateRecord[]>>({
    pending: [],
    done: []
  });
  const [loadingStatus, setLoadingStatus] = useState<Record<QueueStatus, boolean>>({
    pending: true,
    done: false
  });
  const [errors, setErrors] = useState<Record<QueueStatus, string>>({
    pending: "",
    done: ""
  });
  const [fetched, setFetched] = useState<Record<QueueStatus, boolean>>({
    pending: false,
    done: false
  });
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [searchParams, setSearchParams] = useSearchParams();

  const socket = useMemo<Socket | null>(() => {
    if (!allowed) {
      return null;
    }
    const token = localStorage.getItem("accessToken") || "";
    return io(SOCKET_URL, {
      autoConnect: false,
      transports: ["websocket"],
      auth: { token }
    });
  }, [allowed]);

  const userEmail = useMemo(() => (localStorage.getItem("email") || "").trim().toLowerCase(), []);

  const fetchQueue = useCallback((status: QueueStatus) => {
    if (!socket) return;
    setLoadingStatus((prev) => ({ ...prev, [status]: true }));
    setErrors((prev) => ({ ...prev, [status]: "" }));

    socket.emit('getResumeUnderstandingQueue', { status }, (response: QueueResponse) => {
      if (!response?.success) {
        setErrors((prev) => ({ ...prev, [status]: response?.error || 'Unable to load candidates.' }));
        setQueues((prev) => ({ ...prev, [status]: [] }));
        setLoadingStatus((prev) => ({ ...prev, [status]: false }));
        return;
      }

      const rows = Array.isArray(response.candidates) ? response.candidates : [];
      // Defensive filtering for pending queue
      const filteredRows = status === 'pending'
        ? rows.filter(c => c.resumeUnderstandingStatus !== 'done')
        : rows;

      setQueues((prev) => ({ ...prev, [status]: filteredRows }));
      setLoadingStatus((prev) => ({ ...prev, [status]: false }));
      setFetched((prev) => ({ ...prev, [status]: true }));
    });
  }, [socket]);

  useEffect(() => {
    if (!socket) {
      return;
    }
    const handleConnect = () => fetchQueue('pending');

    const handleAuthError = async (err: Error) => {
      if (err.message !== 'Unauthorized') return;
      const ok = await refreshAccessToken();
      if (!ok) {
        setErrors((prev) => ({ ...prev, pending: 'Session expired. Please sign in again.' }));
        return;
      }
      socket.auth = { token: localStorage.getItem('accessToken') || '' };
      socket.once('connect', () => fetchQueue('pending'));
      socket.connect();
    };

    const handleAssignment = (payload: { candidate?: CandidateRecord }) => {
      const candidate = payload?.candidate;
      if (!candidate?.id) return;

      const candidateExpert = (candidate.expertRaw || '').trim().toLowerCase();
      if (shouldFilterByExpert && candidateExpert && candidateExpert !== userEmail) {
        return;
      }

      setQueues((prev) => ({
        pending: [candidate, ...prev.pending.filter((item) => item.id !== candidate.id)],
        done: prev.done.filter((item) => item.id !== candidate.id)
      }));
    };

    const handleUpdate = (payload: { candidate?: CandidateRecord }) => {
      const candidate = payload?.candidate;
      if (!candidate?.id) return;

      const candidateExpert = (candidate.expertRaw || '').trim().toLowerCase();
      if (shouldFilterByExpert && candidateExpert && candidateExpert !== userEmail) {
        return;
      }

      setQueues((prev) => {
        const filteredPending = prev.pending.filter((item) => item.id !== candidate.id);
        const filteredDone = prev.done.filter((item) => item.id !== candidate.id);
        if (candidate.resumeUnderstandingStatus === 'done') {
          return {
            pending: filteredPending,
            done: [candidate, ...filteredDone]
          };
        }
        return {
          pending: [candidate, ...filteredPending],
          done: filteredDone
        };
      });
    };

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleAuthError);
    socket.on('resumeUnderstandingAssigned', handleAssignment);
    socket.on('resumeUnderstandingUpdated', handleUpdate);

    socket.connect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleAuthError);
      socket.off('resumeUnderstandingAssigned', handleAssignment);
      socket.off('resumeUnderstandingUpdated', handleUpdate);
      socket.disconnect();
    };
  }, [socket, fetchQueue, refreshAccessToken, userEmail, shouldFilterByExpert]);

  useEffect(() => {
    if (activeStatus === 'done' && !fetched.done) {
      fetchQueue('done');
    }
  }, [activeStatus, fetched.done, fetchQueue]);

  const handleStatusChange = (value: string) => {
    if (!showCompletedTab && value === 'done') {
      return;
    }
    const next = value === 'done' ? 'done' : 'pending';
    setActiveStatus(next);
  };

  useEffect(() => {
    if (!showCompletedTab && activeStatus === 'done') {
      setActiveStatus('pending');
    }
  }, [showCompletedTab, activeStatus]);

  // Track Page View
  useEffect(() => {
    posthog.capture('resume_understanding_viewed', {
      user_role: role
    });
  }, [role, posthog]);

  // Track Tab Change
  useEffect(() => {
    posthog.capture('resume_tab_changed', {
      user_role: role,
      tab: activeStatus
    });
  }, [activeStatus, role, posthog]);

  // Handle Deep Linking for Discussion
  useEffect(() => {
    const discussionId = searchParams.get('discussionCandidateId');
    if (discussionId && !selectedCandidate) {
      // Check if we have it in current queues
      const allCandidates = [...queues.pending, ...queues.done];
      const found = allCandidates.find(c => c.id === discussionId);
      if (found) {
        setSelectedCandidate(found);
      }
      // Optional: If not found, we might need to fetch it individually or wait for queue fetch
    }
  }, [searchParams, queues, selectedCandidate]);

  const updateResumeStatus = (candidateId: string, status: QueueStatus) => {
    if (!socket) return;

    setActionLoading((prev) => ({ ...prev, [candidateId]: true }));
    setActionErrors((prev) => ({ ...prev, [candidateId]: '' }));

    socket.emit('updateResumeUnderstanding', { candidateId, status }, (response: UpdateResponse) => {
      setActionLoading((prev) => ({ ...prev, [candidateId]: false }));

      if (!response?.success || !response.candidate) {
        setActionErrors((prev) => ({
          ...prev,
          [candidateId]: response?.error || 'Unable to update status'
        }));
        return;
      }

      const candidate = response.candidate;
      setQueues((prev) => {
        const filteredPending = prev.pending.filter((item) => item.id !== candidate.id);
        const filteredDone = prev.done.filter((item) => item.id !== candidate.id);
        if (candidate.resumeUnderstandingStatus === 'done') {
          return {
            pending: filteredPending,
            done: [candidate, ...filteredDone]
          };
        }
        return {
          pending: [candidate, ...filteredPending],
          done: filteredDone
        };
      });

      // [Harsh] Analytics - Track Resume Queue Processing
      posthog?.capture('resume_queue_processed', {
        action: status === 'done' ? 'mark_done' : 'mark_pending',
        expert_email: localStorage.getItem('email'),
        candidate_id: candidateId
      });

      toast({
        title: status === 'done' ? 'Marked as complete' : 'Back to pending',
        description: status === 'done'
          ? 'Candidate removed from your pending queue.'
          : 'Candidate is back in your pending queue.'
      });
    });
  };

  const currentQueue = queues[activeStatus];
  const currentLoading = loadingStatus[activeStatus];
  const currentError = errors[activeStatus];

  if (!allowed) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Resume Understanding</h1>
            <p className="text-muted-foreground">
              This workspace is only available for experts and leads responsible for resume understanding tasks.
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Resume Understanding</h1>
          <p className="text-muted-foreground">
            Review the candidates assigned to you, complete their resume understanding, and track your recently finished items.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Assigned Candidates</CardTitle>
            <CardDescription>
              {showCompletedTab
                ? 'Switch between pending and completed candidates. Status changes update the sidebar badge automatically.'
                : 'Review the pending resume understanding tasks assigned to you.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeStatus} onValueChange={handleStatusChange}>
              <TabsList className={`grid ${showCompletedTab ? 'grid-cols-2' : 'grid-cols-1'} max-w-xs`}>
                <TabsTrigger value="pending">Pending</TabsTrigger>
                {showCompletedTab && <TabsTrigger value="done">Completed</TabsTrigger>}
              </TabsList>
              <TabsContent value={activeStatus} className="mt-4">
                {currentLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <Skeleton key={index} className="h-10 w-full" />
                    ))}
                  </div>
                ) : currentError ? (
                  <p className="text-sm text-destructive">{DOMPurify.sanitize(currentError)}</p>
                ) : currentQueue.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {activeStatus === 'pending'
                      ? 'You have no pending resume understanding items.'
                      : 'No recently completed items to display.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Candidate</TableHead>
                          {/* [HAR-86] Expert Name Column */}
                          {role !== 'user' && <TableHead>Expert Name</TableHead>}
                          <TableHead>Technology</TableHead>
                          <TableHead>Recruiter</TableHead>
                          <TableHead>Branch</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Resume</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {currentQueue.map((candidate) => {
                          const candidateActionLoading = actionLoading[candidate.id];
                          const candidateError = actionErrors[candidate.id];
                          const resumeLinkRaw = (candidate.resumeLink || '').trim();
                          const sanitizedResumeLink = resumeLinkRaw ? DOMPurify.sanitize(resumeLinkRaw) : '';
                          let resumeHref: string | null = null;
                          if (sanitizedResumeLink) {
                            try {
                              resumeHref = new URL(sanitizedResumeLink).toString();
                            } catch (error) {
                              resumeHref = null;
                            }
                          }

                          return (
                            <TableRow key={candidate.id}>
                              <TableCell>{DOMPurify.sanitize(candidate.name || '')}</TableCell>
                              {/* [HAR-86] Expert Name Cell */}
                              {role !== 'user' && (
                                <TableCell>{formatEmailDisplay(candidate.expertRaw || candidate.expert || '')}</TableCell>
                              )}
                              <TableCell>{DOMPurify.sanitize(candidate.technology || '')}</TableCell>
                              <TableCell>{DOMPurify.sanitize(candidate.recruiter || '')}</TableCell>
                              <TableCell>{DOMPurify.sanitize(candidate.branch || '')}</TableCell>
                              <TableCell>{DOMPurify.sanitize(candidate.email || '')}</TableCell>
                              <TableCell className="max-w-[280px]">
                                {sanitizedResumeLink ? (
                                  resumeHref ? (
                                    <div className="flex flex-col gap-1">
                                      <a
                                        href={resumeHref}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline"
                                        title={sanitizedResumeLink}
                                      >
                                        View resume
                                      </a>
                                      <span className="text-xs text-muted-foreground break-all">
                                        {sanitizedResumeLink}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-sm break-all text-muted-foreground">
                                      {sanitizedResumeLink}
                                    </span>
                                  )
                                ) : (
                                  <span className="text-muted-foreground">No resume</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right space-y-2">
                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setSelectedCandidate(candidate)}
                                    title="Discussion"
                                  >
                                    <MessageSquare className="h-4 w-4" />
                                  </Button>
                                  {(role === 'admin' || ((role === 'lead' || role === 'user') && (candidate.expertRaw || '').toLowerCase() === userEmail.toLowerCase())) && (
                                    activeStatus === 'pending' ? (
                                      <Button
                                        size="sm"
                                        onClick={() => updateResumeStatus(candidate.id, 'done')}
                                        disabled={candidateActionLoading}
                                      >
                                        {candidateActionLoading ? 'Updating…' : 'Mark Done'}
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => updateResumeStatus(candidate.id, 'pending')}
                                        disabled={candidateActionLoading}
                                      >
                                        {candidateActionLoading ? 'Updating…' : 'Mark Pending'}
                                      </Button>
                                    )
                                  )}
                                </div>
                                {candidateError && (
                                  <p className="text-xs text-destructive">{candidateError}</p>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
      {selectedCandidate && (
        <ResumeDiscussionDrawer
          isOpen={!!selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          candidateId={selectedCandidate.id}
          candidateName={selectedCandidate.name}
        />
      )}
    </DashboardLayout>
  );
}
