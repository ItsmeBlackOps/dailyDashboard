
import React, { createContext, useContext, useEffect, useState, useRef, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_URL, API_URL, useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import DOMPurify from 'dompurify';

// Sound Assets (We use paths, assuming public/sounds exists or will exist)
const SOUND_RING = '/sounds/ring.mp3';
const SOUND_DOUBLE_BEEP = '/sounds/double-beep.mp3';

interface ChangeDetails {
    oldValue?: any;
    newValue?: any;
    changedFields?: string[];
    bulkCandidates?: Array<{
        candidateId: string;
        candidateName: string;
        oldValue: any;
        newValue: any;
    }>;
}

interface Actor {
    email: string;
    name: string;
    role: string;
}

interface NotificationEvent {
    id: string;
    type: 'comment' | 'assignment' | 'info' | 'batch';
    title: string;
    description: string;
    timestamp: string;
    read: boolean;
    candidateId?: string; // For linking
    commentId?: string;
    link?: string; // Add link support
    changeDetails?: ChangeDetails;
    actor?: Actor;
    batchData?: any[];
    resumeUnderstandingStatus?: string;
}

interface NotificationContextType {
    notifications: NotificationEvent[];
    unreadCount: number;
    markAsRead: (id: string) => void;
    clearAll: () => void;
    // Modal State
    selectedNotification: NotificationEvent | null;
    isModalOpen: boolean;
    openModal: (notification: NotificationEvent) => void;
    closeModal: () => void;
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
    const [selectedNotification, setSelectedNotification] = useState<NotificationEvent | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const { toast } = useToast();
    const { refreshAccessToken, authFetch } = useAuth();
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

    // Audio Objects (Memoized to prevent reloading)
    const audioRing = useMemo(() => new Audio('/sounds/ring.mp3'), []);
    const audioBeep = useMemo(() => new Audio('/sounds/double-beep.mp3'), []);

    const playSound = (type: 'ring' | 'beep') => {
        const audio = type === 'ring' ? audioRing : audioBeep;

        try {
            audio.currentTime = 0; // Reset to start
            audio.volume = 0.6;
            const playPromise = audio.play();

            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    console.warn(`Audio play failed for ${type}:`, err);
                });
            }
        } catch (error) {
            console.error("Audio playback error", error);
        }
    };

    const openModal = (notification: NotificationEvent) => {
        setSelectedNotification(notification);
        setIsModalOpen(true);
        // Mark as read when opening? Optional.
        if (!notification.read) {
            markAsRead(notification.id);
        }
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setSelectedNotification(null);
    };

    // Initial Fetch
    useEffect(() => {
        if (!userId) return;

        const fetchHistory = async () => {
            try {
                const res = await authFetch(`${API_URL}/api/notifications`);
                const data = await res.json();
                if (data.success && Array.isArray(data.notifications)) {
                    setNotifications(data.notifications.map((n: any) => ({
                        id: n.id || n._id,
                        type: n.type,
                        title: n.title,
                        description: n.description,
                        timestamp: n.createdAt || n.timestamp, // Handle DB field
                        read: n.isRead || n.read, // Handle DB field
                        candidateId: n.candidateId,
                        link: n.link,
                        changeDetails: n.changeDetails,
                        actor: n.actor,
                        batchData: n.batchData
                    })));
                }
            } catch (err) {
                console.error('Failed to fetch notifications', err);
            }
        };

        fetchHistory();
    }, [userId, authFetch]);

    useEffect(() => {
        if (!socket) return;

        const handleConnect = () => {
            console.log("Notification Socket Connected");
        };

        const handleNewComment = (payload: { candidate: any, comment: any }) => {
            const { candidate, comment } = payload;
            const authorName = comment?.author?.name || 'Unknown';
            const candidateName = candidate?.name || 'Candidate';
            const commentText = comment?.text || comment?.content || 'New comment'; // Handle content field
            // console.log(candidate);

            // Use commentId as the stable dedup key
            const notifId = comment.id || comment._id;
            if (!notifId) return; // Cannot dedup without stable ID — skip ephemeral notifications

            // Notification List Item (Persistent)
            const newNotif: NotificationEvent = {
                id: notifId,
                type: 'comment',
                title: 'New Message',
                description: `New message from ${authorName} regarding ${candidateName}`,
                timestamp: new Date().toISOString(),
                read: false,
                candidateId: candidate?.id,
                commentId: notifId,
                resumeUnderstandingStatus: candidate?.resumeUnderstandingStatus
            };

            // Guard: skip if already present (initial fetch + socket event race)
            setNotifications(prev => {
                if (prev.some(n => n.id === newNotif.id)) return prev;
                return [newNotif, ...prev];
            });

            // Toast Alert (Ephemeral - Specific Format)
            console.log('🔔 Discussion Notification Triggered:', { authorName, commentText });
            toast({
                title: 'New Discussion Message',
                description: `${authorName}: ${commentText}`,
                duration: 5000,
            });
            playSound('ring');
        };

        const handleAssignment = (payload: { candidate: any, expert: any, recruiter: any }) => {
            // console.log('[Frontend Notification Payload]', JSON.stringify(payload, null, 2));
            const { candidate, expert, recruiter } = payload;
            const candidateName = candidate?.["Candidate Name"] || 'Unknown Candidate';
            const expertName = candidate?.expert || 'Unknown Expert';
            const expertEmail = candidate?.Expert || '';
            const recruiterEmail = candidate?.recruiterRaw || '';

            const myEmail = localStorage.getItem("email") || "";
            const myRole = (localStorage.getItem("role") || "").toLowerCase();
            console.log("[Handle Assignment Payload]:", payload);
            let title = 'New Assignment';
            let description = '';

            // LOGIC MATRIX
            if (myEmail === expertEmail) {
                // Expert View
                description = `A new candidate, ${candidateName}, has been assigned to you for the resume understanding.`;
            } else if (['lead', 'am'].includes(myRole)) {
                // Lead / AM View
                description = `A new candidate, ${candidateName}, has been assigned to ${expertName} for the resume understanding.`;
            } else if (myEmail === recruiterEmail) {
                // Recruiter View (Creator)
                // Note: Distinct story for 'Marketing' vs 'Expert Assigned'
                // If expert is assigned, use the Expert Story. 
                // We assume this event fires ON expert assignment.
                description = `${expertName}, has been assigned to ${candidateName} for resume understanding.`;
            } else if (['mam', 'mlead', 'manager'].includes(myRole)) {
                // Manager View
                description = `${expertName}, has been assigned to ${candidateName} for resume understanding.`;
            } else {
                // Fallback
                description = `Task assigned: ${candidateName} to ${expertName}`;
            }

            const newNotif: NotificationEvent = {
                id: `assign-${candidate.id}-${Date.now()}`,
                type: 'assignment',
                title,
                description,
                timestamp: new Date().toISOString(),
                read: false,
                candidateId: candidate?.id
            };

            setNotifications(prev => [newNotif, ...prev]);

            toast({
                title: newNotif.title,
                description: newNotif.description,
            });

            console.log('🔔 Assignment Notification Triggered:', title);
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

        // Completion Handler
        const handleUpdate = (payload: { candidate: any, updatedBy: any }) => {
            const { candidate, updatedBy } = payload;

            // Check if Status is 'Completed' (assuming 'completed' or 'Completed')
            const status = (candidate?.resumeUnderstandingStatus || '').toLowerCase();
            if (status === 'completed') {
                const completerName = updatedBy?.name || candidate?.expert || 'Expert'; // Fallback
                const name = candidate?.name || 'Candidate';

                const newNotif: NotificationEvent = {
                    id: `complete-${candidate.id}-${Date.now()}`,
                    type: 'info',
                    title: 'Task Completed',
                    description: `Resume Understanding, for ${name} is completed by ${completerName}`,
                    timestamp: new Date().toISOString(),
                    read: false,
                    candidateId: candidate?.id
                };

                setNotifications(prev => [newNotif, ...prev]);
                toast({ title: newNotif.title, description: newNotif.description });
                playSound('beep');
            }
        };


        socket.on('resumeUnderstandingUpdated', handleUpdate);

        // Status Update Handler (Marketing Status)
        const handleStatusUpdate = (payload: { candidate: any, newStatus: string, updatedBy: any, changeDetails?: ChangeDetails, actor?: Actor }) => {
            const { candidate, newStatus, updatedBy, changeDetails, actor } = payload;
            const updaterName = updatedBy?.name || 'Unknown User';
            const candidateName = candidate?.name || 'Candidate';

            const newNotif: NotificationEvent = {
                id: `status-${candidate.id}-${Date.now()}`,
                type: 'info',
                title: 'Status Updated',
                description: `Status of ${candidateName} updated to ${newStatus} by ${updaterName}`,
                timestamp: new Date().toISOString(),
                read: false,
                candidateId: candidate?.id,
                changeDetails,
                actor
            };

            setNotifications(prev => [newNotif, ...prev]);
            toast({
                title: newNotif.title,
                description: newNotif.description,
            });
            console.log('🔔 Status Notification Triggered');
            playSound('ring');
        };

        socket.on('candidateStatusUpdated', handleStatusUpdate);

        // Bulk Status Update Handler
        const handleBulkStatusUpdate = (payload: { count: number, status: string, updatedBy: any, ids: string[], changeDetails?: any, actor?: any }) => {
            console.log('🔔 Bulk Status Notification Received:', payload);
            const { count, status, updatedBy, changeDetails, actor } = payload;

            const newNotif: NotificationEvent = {
                id: `bulk-${Date.now()}`,
                type: 'batch',
                title: 'Bulk Status Update',
                description: `Updated ${count} candidates to ${status} by ${updatedBy?.name || 'User'}`,
                timestamp: new Date().toISOString(),
                read: false,
                changeDetails,
                actor,
                batchData: changeDetails?.bulkCandidates
            };

            setNotifications(prev => [newNotif, ...prev]);
            toast({
                title: newNotif.title,
                description: newNotif.description,
            });
            playSound('ring');
        }
        socket.on('bulkCandidateStatusUpdated', handleBulkStatusUpdate);

        // Task Notification Handler
        const handleTaskNotification = (payload: any) => {
            console.log('🔔 Task Notification Received:', payload);
            const { title, description } = payload;

            const newNotif: NotificationEvent = {
                id: `task-${Date.now()}`,
                type: 'info',
                title: title || 'Task Update',
                description: description || 'You have a new task update',
                timestamp: new Date().toISOString(),
                read: false,
            };

            setNotifications(prev => [newNotif, ...prev]);
            toast({
                title: newNotif.title,
                description: newNotif.description,
            });
            playSound('ring');
        };
        socket.on('taskNotification', handleTaskNotification);

        socket.connect();

        return () => {
            socket.off('connect', handleConnect);
            socket.off('connect_error', handleAuthError);
            socket.off('newCommentNotification', handleNewComment);
            socket.off('candidateExpertAssigned', handleAssignment);
            socket.off('resumeUnderstandingAssigned', handleAssignment);
            socket.off('resumeUnderstandingUpdated', handleUpdate);
            socket.off('candidateStatusUpdated', handleStatusUpdate);
            socket.off('bulkCandidateStatusUpdated', handleBulkStatusUpdate);
            socket.off('taskNotification', handleTaskNotification);
            socket.disconnect();
        };
    }, [socket, refreshAccessToken, toast]);

    const markAsRead = async (id: string) => {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
        try {
            await authFetch(`${API_URL}/api/notifications/${id}/read`, { method: 'PUT' });
        } catch (err) {
            console.error('Failed to mark notification read', err);
        }
    };

    const clearAll = async () => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true }))); // UI Optimistic
        try {
            await authFetch(`${API_URL}/api/notifications/read-all`, { method: 'PUT' });
        } catch (err) {
            console.error('Failed to clear notifications', err);
        }
    };

    const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

    return (
        <NotificationContext.Provider value={{ notifications, unreadCount, markAsRead, clearAll, selectedNotification, isModalOpen, openModal, closeModal }}>
            {children}
            {/* Audio element if needed for persistent playback context, but new Audio() works often */}
        </NotificationContext.Provider>
    );
}
