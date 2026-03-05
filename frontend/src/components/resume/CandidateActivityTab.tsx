import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Phone, PhoneMissed, FileCheck, GraduationCap, UserPlus, RefreshCw, MessageSquareReply } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_URL, useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useNotifications } from '@/context/NotificationContext';
import moment from 'moment-timezone';

interface Activity {
    id: string;
    type: 'call_attempt' | 'document_prepared' | 'mock_interview' | 'task_created' | 'task_recreated' | 'call_response';
    outcome?: 'connected' | 'unavailable';
    notes?: string;
    createdBy: { email: string; name: string; role: string };
    createdAt: string;
}

interface CandidateActivityTabProps {
    candidateId: string;
    isOpen: boolean;
    canLogActivity?: boolean;
}

export function CandidateActivityTab({ candidateId, isOpen, canLogActivity = false }: CandidateActivityTabProps) {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [formOpen, setFormOpen] = useState(false);
    const [mockFormOpen, setMockFormOpen] = useState(false);
    const [formOutcome, setFormOutcome] = useState<'connected' | 'unavailable'>('connected');
    const [formNotes, setFormNotes] = useState('');
    const [mockNotes, setMockNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
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

        const fetchActivities = () => {
            setLoading(true);
            socket.emit('getActivities', { candidateId }, (response: any) => {
                setLoading(false);
                if (response?.success && Array.isArray(response.data)) {
                    setActivities(response.data);
                } else {
                    setError(response?.error || 'Failed to load activities');
                }
            });
        };

        const handleNewActivity = (payload: { candidateId: string; activity: Activity }) => {
            if (payload.candidateId === candidateId && payload.activity) {
                setActivities(prev => {
                    if (prev.some(a => String(a.id) === String(payload.activity.id))) return prev;
                    return [...prev, payload.activity];
                });
            }
        };

        const handleConnect = () => {
            socket.emit('joinCandidateRoom', candidateId);
            fetchActivities();
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

    // Refetch activities when recruiter responds to a call alert (activityRefreshTrigger increments)
    useEffect(() => {
        if (!isOpen || !candidateId || !socket || !socket.connected || activityRefreshTrigger === 0) return;
        socket.emit('getActivities', { candidateId }, (response: any) => {
            if (response?.success && Array.isArray(response.data)) {
                setActivities(response.data);
            }
        });
    }, [activityRefreshTrigger]);

    const submitActivity = (type: Activity['type'], outcome?: 'connected' | 'unavailable', notes?: string) => {
        if (!socket) return;
        setSubmitting(true);
        setError('');
        socket.emit('addActivity', { candidateId, type, outcome, notes }, (response: any) => {
            setSubmitting(false);
            if (response?.success && response.data) {
                setActivities(prev => {
                    if (prev.some(a => String(a.id) === String(response.data.id))) return prev;
                    return [...prev, response.data];
                });
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

    const renderActivity = (activity: Activity) => {
        let icon: React.ReactNode;
        let label: string;

        if (activity.type === 'call_attempt') {
            if (activity.outcome === 'connected') {
                icon = <Phone className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />;
                label = 'Call Connected';
            } else {
                icon = <PhoneMissed className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />;
                label = 'Candidate Unavailable';
            }
        } else if (activity.type === 'mock_interview') {
            icon = <GraduationCap className="h-4 w-4 text-violet-500 flex-shrink-0 mt-0.5" />;
            label = 'Mock Interview';
        } else if (activity.type === 'task_created') {
            icon = <UserPlus className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />;
            label = 'Task Created';
        } else if (activity.type === 'task_recreated') {
            icon = <RefreshCw className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />;
            label = 'Task Recreated';
        } else if (activity.type === 'call_response') {
            icon = <MessageSquareReply className="h-4 w-4 text-orange-500 flex-shrink-0 mt-0.5" />;
            label = 'Call Response';
        } else {
            icon = <FileCheck className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />;
            label = 'Document Prepared';
        }

        return (
            <div key={String(activity.id)} className="flex gap-3 py-2">
                {icon}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{label}</span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {moment(activity.createdAt).fromNow()}
                        </span>
                    </div>
                    <div className="text-xs text-muted-foreground">{activity.createdBy?.name ?? 'Unknown'}</div>
                    {activity.notes && (
                        <div className="text-xs text-foreground/80 mt-1 whitespace-pre-wrap break-words">
                            {activity.notes}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* Scrollable activity list */}
            <div className="flex-1 overflow-auto p-4">
                {loading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : error ? (
                    <div className="text-destructive text-sm text-center py-4">{error}</div>
                ) : activities.length === 0 ? (
                    <div className="text-muted-foreground text-center py-8 text-sm">
                        No activity logged yet. Start by logging a call.
                    </div>
                ) : (
                    <div className="divide-y">
                        {activities.map(renderActivity)}
                    </div>
                )}
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
