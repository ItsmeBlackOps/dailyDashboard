import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Phone, PhoneMissed, FileCheck } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_URL, useAuth } from '@/hooks/useAuth';
import moment from 'moment-timezone';

interface Activity {
    id: string;
    type: 'call_attempt' | 'document_prepared';
    outcome?: 'connected' | 'unavailable';
    notes?: string;
    createdBy: { email: string; name: string; role: string };
    createdAt: string;
}

interface CandidateActivityTabProps {
    candidateId: string;
    isOpen: boolean;
}

export function CandidateActivityTab({ candidateId, isOpen }: CandidateActivityTabProps) {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [formOpen, setFormOpen] = useState(false);
    const [formOutcome, setFormOutcome] = useState<'connected' | 'unavailable'>('connected');
    const [formNotes, setFormNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const { refreshAccessToken } = useAuth();

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

    const submitActivity = (type: 'call_attempt' | 'document_prepared', outcome?: 'connected' | 'unavailable', notes?: string) => {
        if (!socket) return;
        setSubmitting(true);
        socket.emit('addActivity', { candidateId, type, outcome, notes }, (response: any) => {
            setSubmitting(false);
            if (response?.success && response.data) {
                setActivities(prev => {
                    if (prev.some(a => String(a.id) === String(response.data.id))) return prev;
                    return [...prev, response.data];
                });
                setFormOpen(false);
                setFormNotes('');
                setFormOutcome('connected');
            } else {
                setError(response?.error || 'Failed to log activity');
            }
        });
    };

    const handleSaveCall = () => {
        submitActivity('call_attempt', formOutcome, formNotes.trim() || undefined);
    };

    const handleDocumentPrepared = () => {
        submitActivity('document_prepared');
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
                    <div className="text-xs text-muted-foreground">{activity.createdBy.name}</div>
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
        <div className="flex flex-col gap-4">
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

            {formOpen && (
                <div className="border rounded-lg p-3 flex flex-col gap-3">
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

            {!formOpen && (
                <div className="flex gap-2 pt-2 border-t">
                    <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
                        <Phone className="h-3.5 w-3.5 mr-1.5" />
                        Log Call
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDocumentPrepared} disabled={submitting}>
                        {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FileCheck className="h-3.5 w-3.5 mr-1.5" />}
                        Document Prepared
                    </Button>
                </div>
            )}
        </div>
    );
}
