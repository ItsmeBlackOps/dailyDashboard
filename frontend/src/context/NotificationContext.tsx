
import React, { createContext, useContext, useEffect, useState, useRef, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_URL, useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import DOMPurify from 'dompurify';

// Sound Assets (We use paths, assuming public/sounds exists or will exist)
const SOUND_RING = '/sounds/ring.mp3';
const SOUND_DOUBLE_BEEP = '/sounds/double-beep.mp3';

interface NotificationEvent {
    id: string;
    type: 'comment' | 'assignment' | 'info';
    title: string;
    description: string;
    timestamp: string;
    read: boolean;
    candidateId?: string; // For linking
    commentId?: string;
}

interface NotificationContextType {
    notifications: NotificationEvent[];
    unreadCount: number;
    markAsRead: (id: string) => void;
    clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

export function useNotifications() {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
    const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
    const { toast } = useToast();
    const { refreshAccessToken } = useAuth();
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const userId = useMemo(() => localStorage.getItem("email") || "", []);
    const role = useMemo(() => localStorage.getItem("role") || "", []);

    // Socket Setup
    const socket = useMemo<Socket | null>(() => {
        if (!userId) return null;
        const token = localStorage.getItem("accessToken") || "";
        return io(SOCKET_URL, {
            autoConnect: false,
            transports: ["websocket"],
            auth: { token }
        });
    }, [userId]);

    const playSound = (type: 'ring' | 'beep') => {
        const src = type === 'ring' ? SOUND_RING : SOUND_DOUBLE_BEEP;
        try {
            const audio = new Audio(src);
            audio.volume = 0.5; // Reasonable volume
            audio.play().catch(err => console.warn("Audio play failed (interaction needed?):", err));
        } catch (error) {
            console.error("Audio error", error);
        }
    };

    useEffect(() => {
        if (!socket) return;

        const handleConnect = () => {
            console.log("Notification Socket Connected");
            // Join role rooms? Backend usually puts us in them automatically or we need to emit 'joinRole'
            // Current candidateSocket doesn't explicit join roles, but authSocket might.
            // We'll rely on emitToUser for now which targets socketId connected with auth.
        };

        const handleNewComment = (payload: { candidate: any, comment: any }) => {
            const { candidate, comment } = payload;
            const authorName = comment?.author?.name || 'Unknown';
            const candidateName = candidate?.name || 'Candidate';

            // Dedupe if needed (rare with socket)

            const newNotif: NotificationEvent = {
                id: comment.id || Date.now().toString(),
                type: 'comment',
                title: `New Message: ${authorName}`,
                description: `Comment on ${candidateName}`,
                timestamp: new Date().toISOString(),
                read: false,
                candidateId: candidate?.id,
                commentId: comment.id
            };

            setNotifications(prev => [newNotif, ...prev]);

            // TOAST & SOUND
            toast({
                title: newNotif.title,
                description: newNotif.description,
            });
            playSound('ring');
        };

        const handleAssignment = (payload: { candidate: any }) => {
            const { candidate } = payload;
            const name = candidate?.name || 'Candidate';

            const newNotif: NotificationEvent = {
                id: `assign-${candidate.id}-${Date.now()}`,
                type: 'assignment',
                title: 'New Assignment',
                description: `You have been assigned to ${name}`,
                timestamp: new Date().toISOString(),
                read: false,
                candidateId: candidate?.id
            };

            setNotifications(prev => [newNotif, ...prev]);

            toast({
                title: newNotif.title,
                description: newNotif.description,
            });
            playSound('beep');
        };

        // Auth Error Handling (Standard)
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
        socket.on('newCommentNotification', handleNewComment);
        // Note: 'candidateExpertAssigned' is event name in backend
        socket.on('candidateExpertAssigned', handleAssignment);
        // Also 'resumeUnderstandingAssigned'
        socket.on('resumeUnderstandingAssigned', handleAssignment);

        socket.connect();

        return () => {
            socket.off('connect', handleConnect);
            socket.off('connect_error', handleAuthError);
            socket.off('newCommentNotification', handleNewComment);
            socket.off('candidateExpertAssigned', handleAssignment);
            socket.off('resumeUnderstandingAssigned', handleAssignment);
            socket.disconnect();
        };
    }, [socket, refreshAccessToken, toast]);

    const markAsRead = (id: string) => {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    };

    const clearAll = () => {
        setNotifications([]);
    };

    const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

    return (
        <NotificationContext.Provider value={{ notifications, unreadCount, markAsRead, clearAll }}>
            {children}
            {/* Audio element if needed for persistent playback context, but new Audio() works often */}
        </NotificationContext.Provider>
    );
}
