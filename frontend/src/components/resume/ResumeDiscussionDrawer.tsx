import { useState, useEffect, useRef, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Send, Lock, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { io, Socket } from "socket.io-client";
import { SOCKET_URL, useAuth } from "@/hooks/useAuth";
import moment from 'moment-timezone';
import DOMPurify from 'dompurify';
import { usePostHog } from 'posthog-js/react';
import { useNotifications } from "@/context/NotificationContext";
import { CandidateActivityTab } from "./CandidateActivityTab";

interface Comment {
    id: string;
    author: {
        email: string;
        name: string;
        role: string;
    };
    content: string;
    type: 'internal' | 'complaint';
    createdAt: string;
}

interface ResumeDiscussionDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    candidateId: string;
    candidateName: string;
    expertRaw?: string;
}

export function ResumeDiscussionDrawer({
    isOpen,
    onClose,
    candidateId,
    candidateName,
    expertRaw
}: ResumeDiscussionDrawerProps) {
    const [comments, setComments] = useState<Comment[]>([]);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [newMessage, setNewMessage] = useState('');
    const [isComplaint, setIsComplaint] = useState(false);
    const [activeTab, setActiveTab] = useState('discussion');
    const scrollRef = useRef<HTMLDivElement>(null);
    const { refreshAccessToken } = useAuth();

    const role = useMemo(() => (localStorage.getItem("role") || "").trim().toLowerCase(), []);
    const userEmail = useMemo(() => (localStorage.getItem("email") || "").trim().toLowerCase(), []);
    const canSeeComplaints = useMemo(() => !['expert', 'user'].includes(role), [role]);
    const canCreateComplaints = useMemo(() => ['recruiter', 'mlead', 'mam', 'mm', 'admin', 'manager'].includes(role), [role]);
    const canLogActivity = useMemo(() => {
        return role === 'admin' || ((role === 'lead' || role === 'user') && (expertRaw || '').toLowerCase() === userEmail);
    }, [role, expertRaw, userEmail]);
    const { notifications, markAsRead } = useNotifications();
    const posthog = usePostHog();

    // Tab-aware mark-as-read
    useEffect(() => {
        if (isOpen && candidateId) {
            const targetType = activeTab === 'discussion' ? 'comment' : 'activity';
            notifications.forEach(n => {
                if (n.candidateId === candidateId && n.type === targetType && !n.read) {
                    markAsRead(n.id);
                }
            });
        }
    }, [isOpen, candidateId, activeTab, notifications, markAsRead]);

    const socket = useMemo<Socket | null>(() => {
        if (!candidateId || !isOpen) return null;
        const token = localStorage.getItem("accessToken") || "";
        return io(SOCKET_URL, {
            autoConnect: false,
            transports: ["websocket"],
            auth: { token }
        });
    }, [candidateId, isOpen]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [comments]);

    useEffect(() => {
        if (!isOpen || !candidateId || !socket) return;

        const fetchComments = () => {
            setLoading(true);
            socket.emit('getResumeComments', { candidateId }, (response: any) => {
                setLoading(false);
                if (response?.success && Array.isArray(response.data)) {
                    setComments(response.data);
                } else {
                    setError(response?.error || 'Failed to load comments');
                }
            });
        };

        const handleNewComment = (payload: { candidateId: string, comment: Comment }) => {
            if (payload.candidateId === candidateId && payload.comment) {
                setComments(prev => {
                    if (prev.some(c => c.id === payload.comment.id)) return prev;
                    return [...prev, payload.comment];
                });
            }
        };

        const handleConnect = () => {
            socket.emit('joinCandidateRoom', candidateId);
            fetchComments();
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
        socket.on('newComment', handleNewComment);

        socket.connect();

        return () => {
            socket.emit('leaveCandidateRoom', candidateId);
            socket.off('connect', handleConnect);
            socket.off('connect_error', handleAuthError);
            socket.off('newComment', handleNewComment);
            socket.disconnect();
        };
    }, [isOpen, candidateId, socket, refreshAccessToken]);

    const handleSend = () => {
        if (!newMessage.trim() || !socket) return;
        if (!socket.connected) {
            // Try to reconnect once?
            socket.connect();
            // And show error
            // setSending(false); (No, let it spin a moment or show toast)
            // toast({ description: "Reconnecting to chat...", variant: "default" });
            // Actually better to fail fast so user retry
        }

        setSending(true);
        setError('');

        // Timeout protection
        const timeoutId = setTimeout(() => {
            if (sending) { // If still sending
                setSending(false);
                // toast({ title: "Send failed", description: "Server timed out. Please try again.", variant: "destructive" });
            }
        }, 8000);

        socket.emit('addResumeComment', {
            candidateId,
            content: newMessage,
            type: isComplaint ? 'complaint' : 'internal'
        }, (response: any) => {
            clearTimeout(timeoutId);
            setSending(false);
            if (response?.success && response.data) {
                setNewMessage('');
                setIsComplaint(false);
                setComments(prev => [...prev, response.data]);

                posthog?.capture('discussion_comment_posted', {
                    candidate_id: candidateId,
                    type: isComplaint ? 'complaint' : 'internal',
                });
            } else {
                setError(response?.error || 'Failed to send message');
                // toast({ title: "Error", description: response?.error || "Could not send message", variant: "destructive" });
            }
        });
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <SheetContent className="w-full sm:max-w-md flex flex-col h-full p-0 gap-0">
                <SheetHeader className="p-4 border-b">
                    <SheetTitle className="flex items-center gap-2">
                        Discussion
                        <Badge variant="outline" className="font-normal">{candidateName}</Badge>
                    </SheetTitle>
                    <SheetDescription>
                        Collaborate on this candidate.
                    </SheetDescription>
                </SheetHeader>

                <div className="mx-4 mt-2 inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
                    <button
                        className={`relative inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all ${activeTab === 'discussion' ? 'bg-background text-foreground shadow-sm' : ''}`}
                        onClick={() => setActiveTab('discussion')}
                    >
                        Discussion
                        {notifications.some(n =>
                            n.candidateId === candidateId &&
                            n.type === 'comment' &&
                            !n.read
                        ) && (
                            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500" />
                        )}
                    </button>
                    <button
                        className={`relative inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all ${activeTab === 'activity' ? 'bg-background text-foreground shadow-sm' : ''}`}
                        onClick={() => setActiveTab('activity')}
                    >
                        Activity
                        {notifications.some(n =>
                            n.candidateId === candidateId &&
                            n.type === 'activity' &&
                            !n.read
                        ) && (
                            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500" />
                        )}
                    </button>
                </div>

                {activeTab === 'discussion' && (
                    <div className="flex-1 flex flex-col min-h-0">
                        <div className="flex-1 overflow-y-auto p-4">
                            {loading ? (
                                <div className="flex justify-center py-8">
                                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                </div>
                            ) : error ? (
                                <div className="text-destructive text-sm text-center py-4">{error}</div>
                            ) : comments.length === 0 ? (
                                <div className="text-muted-foreground text-center py-8 text-sm">
                                    No comments yet. Start the discussion!
                                </div>
                            ) : (
                                <div className="flex flex-col gap-4">
                                    {comments.map((comment) => (
                                        <div key={comment.id} className={`flex gap-3 ${comment.type === 'complaint' ? 'bg-destructive/10 p-2 rounded-lg -mx-2' : ''}`}>
                                            <Avatar className="h-8 w-8 mt-1">
                                                <AvatarImage src={`https://ui-avatars.com/api/?name=${encodeURIComponent(comment.author?.name ?? 'U')}&background=random`} />
                                                <AvatarFallback>{(comment.author?.name ?? 'U').charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 space-y-1">
                                                <div className="flex items-center justify-between">
                                                    <span className="font-semibold text-sm">{comment.author?.name ?? 'Unknown'}</span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {moment(comment.createdAt).fromNow()}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-muted-foreground mb-1">{comment.author?.role ?? ''}</div>
                                                <div className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
                                                    {comment.content}
                                                </div>
                                                {comment.type === 'complaint' && (
                                                    <div className="flex items-center gap-1 text-[10px] text-destructive uppercase tracking-wider font-semibold mt-1">
                                                        <Lock className="h-3 w-3" /> Hidden from Experts
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    <div ref={scrollRef} />
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t bg-background">
                            {canCreateComplaints && (
                                <div className="flex items-center space-x-2 mb-3">
                                    <Switch id="complaint-mode" checked={isComplaint} onCheckedChange={setIsComplaint} />
                                    <Label htmlFor="complaint-mode" className={`text-xs font-medium cursor-pointer flex items-center gap-1 ${isComplaint ? 'text-destructive' : 'text-muted-foreground'}`}>
                                        {isComplaint ? (
                                            <>
                                                <Lock className="h-3 w-3" /> Complaint (Hidden from Expert)
                                            </>
                                        ) : (
                                            'Normal Comment'
                                        )}
                                    </Label>
                                </div>
                            )}
                            <div className="flex gap-2">
                                <Textarea
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Type your message..."
                                    className="min-h-[80px] resize-none"
                                />
                                <Button size="icon" className="h-auto w-12" onClick={handleSend} disabled={!newMessage.trim() || sending}>
                                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'activity' && (
                    <div className="flex-1 flex flex-col min-h-0">
                        <CandidateActivityTab candidateId={candidateId} isOpen={isOpen} canLogActivity={canLogActivity} />
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
