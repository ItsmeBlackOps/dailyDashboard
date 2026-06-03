import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Phone, FileCheck, GraduationCap } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_URL, useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useNotifications } from '@/context/NotificationContext';
import { CandidateTimeline } from '@/components/candidates/CandidateTimeline';

type ActivityType =
    | 'call_attempt'
    | 'document_prepared'
    | 'mock_interview'
    | 'task_created'
    | 'task_recreated'
    | 'call_response';

interface CandidateActivityTabProps {
    candidateId: string;
    isOpen: boolean;
    canLogActivity?: boolean;
}

export function CandidateActivityTab({ candidateId, isOpen, canLogActivity = false }: CandidateActivityTabProps) {
    const [error, setError] = useState('');
    const [formOpen, setFormOpen] = useState(false);
    const [mockFormOpen, setMockFormOpen] = useState(false);
    const [formOutcome, setFormOutcome] = useState<'connected' | 'unavailable'>('connected');
    const [formNotes, setFormNotes] = useState('');
    const [mockNotes, setMockNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    // Bumped to force the unified CandidateTimeline to refetch (new manual
    // entry saved, or a newActivity socket push arrived).
    const [refreshKey, setRefreshKey] = useState(0);
    const { refreshAccessToken } = useAuth();
    const { toast } = useToast();
    const { activityRefreshTrigger } = useNotifications();

    const socket = useMemo<Socket | null>(() => {
        if (!candidateId || !isOpen) return null;
        const token = localStorage.getItem('accessToken') || '';
        return io(SOCKET_URL, {
            autoConnect: false,
            transports: ['websocket'],
            auth: { token }
        });
    }, [candidateId, isOpen]);

    useEffect(() => {
        if (!isOpen || !candidateId || !socket) return;

        // A new activity was pushed for this candidate — refetch the unified feed.
        const handleNewActivity = (payload: { candidateId: string }) => {
            if (payload.candidateId === candidateId) {
                setRefreshKey((k) => k + 1);
            }
        };

        const handleConnect = () => {
            socket.emit('joinCandidateRoom', candidateId);
        };

        const handleAuthError = async (err: Error) => {
            if (err.message === 'Unauthorized') {
                const ok = await refreshAccessToken();
                if (ok) {
                    socket.auth = { token: localStorage.getItem('accessToken') || '' };
                    socket.connect();
                }
            }
        };

        socket.on('connect', handleConnect);
        socket.on('connect_error', handleAuthError);
        socket.on('newActivity', handleNewActivity);
        socket.connect();

        return () => {
            socket.emit('leaveCandidateRoom', candidateId);
            socket.off('connect', handleConnect);
            socket.off('connect_error', handleAuthError);
            socket.off('newActivity', handleNewActivity);
            socket.disconnect();
        };
    }, [isOpen, candidateId, socket, refreshAccessToken]);

    // Refetch the feed when a recruiter responds to a call alert elsewhere.
    useEffect(() => {
        if (!isOpen || !candidateId || activityRefreshTrigger === 0) return;
        setRefreshKey((k) => k + 1);
    }, [activityRefreshTrigger, isOpen, candidateId]);

    const submitActivity = (type: ActivityType, outcome?: 'connected' | 'unavailable', notes?: string) => {
        if (!socket) return;
        setSubmitting(true);
        setError('');
        socket.emit('addActivity', { candidateId, type, outcome, notes }, (response: any) => {
            setSubmitting(false);
            if (response?.success && response.data) {
                // Refetch the unified timeline so the new entry shows live.
                setRefreshKey((k) => k + 1);
                setFormOpen(false);
                setMockFormOpen(false);
                setFormNotes('');
                setMockNotes('');
                setFormOutcome('connected');

                const typeLabels: Record<string, string> = {
                    call_attempt: outcome === 'connected' ? 'Call Connected' : 'Candidate Unavailable',
                    document_prepared: 'Document Prepared',
                    mock_interview: 'Mock Interview',
                    task_created: 'Task Created',
                    task_recreated: 'Task Recreated',
                    call_response: 'Call Response'
                };
                toast({
                    title: 'Activity Logged',
                    description: typeLabels[type] || type,
                    duration: 3000,
                });
            } else {
                const errMsg = response?.error || 'Failed to log activity';
                setError(errMsg);
                toast({
                    title: 'Error',
                    description: errMsg,
                    variant: 'destructive',
                    duration: 4000,
                });
            }
        });
    };

    const handleSaveCall = () => {
        submitActivity('call_attempt', formOutcome, formNotes.trim() || undefined);
    };

    const handleDocumentPrepared = () => {
        submitActivity('document_prepared');
    };

    const handleMockInterview = () => {
        submitActivity('mock_interview', undefined, mockNotes.trim() || undefined);
    };

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* Scrollable unified timeline */}
            <div className="flex-1 overflow-auto p-4">
                {error && <div className="text-destructive text-sm text-center py-2">{error}</div>}
                <CandidateTimeline candidateId={candidateId} refreshKey={refreshKey} />
            </div>

            {/* Pinned bottom area — only for users who can log activities */}
            {canLogActivity && (
            <div className="p-4 border-t bg-background mt-auto">
                {formOpen && (
                    <div className="flex flex-col gap-3">
                        <div className="flex gap-2">
                            <Button
                                variant={formOutcome === 'connected' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setFormOutcome('connected')}
                            >
                                Connected
                            </Button>
                            <Button
                                variant={formOutcome === 'unavailable' ? 'destructive' : 'outline'}
                                size="sm"
                                onClick={() => setFormOutcome('unavailable')}
                            >
                                Unavailable
                            </Button>
                        </div>
                        <Textarea
                            value={formNotes}
                            onChange={(e) => setFormNotes(e.target.value)}
                            placeholder="Notes (optional)"
                            className="min-h-[60px] resize-none text-sm"
                        />
                        <div className="flex gap-2">
                            <Button size="sm" onClick={handleSaveCall} disabled={submitting}>
                                {submitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                                Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setFormOpen(false); setFormNotes(''); setFormOutcome('connected'); }}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}

                {mockFormOpen && (
                    <div className="flex flex-col gap-3">
                        <Textarea
                            value={mockNotes}
                            onChange={(e) => setMockNotes(e.target.value)}
                            placeholder="Notes (optional)"
                            className="min-h-[60px] resize-none text-sm"
                        />
                        <div className="flex gap-2">
                            <Button size="sm" onClick={handleMockInterview} disabled={submitting}>
                                {submitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                                Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setMockFormOpen(false); setMockNotes(''); }}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}

                {!formOpen && !mockFormOpen && (
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
                            <Phone className="h-3.5 w-3.5 mr-1.5" />
                            Log Call
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleDocumentPrepared} disabled={submitting}>
                            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FileCheck className="h-3.5 w-3.5 mr-1.5" />}
                            Document Prepared
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setMockFormOpen(true)}>
                            <GraduationCap className="h-3.5 w-3.5 mr-1.5" />
                            Mock Interview
                        </Button>
                    </div>
                )}
            </div>
            )}
        </div>
    );
}
