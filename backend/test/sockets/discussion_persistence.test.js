import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock dependencies
jest.unstable_mockModule('../../src/services/candidateService.js', () => ({
    candidateService: {
        addComment: jest.fn(),
        getCandidateById: jest.fn(),
        resolveHierarchyWatchers: jest.fn(),
        resolveExpertHierarchy: jest.fn()
    }
}));

jest.unstable_mockModule('../../src/services/notificationService.js', () => ({
    notificationService: {
        broadcastToWatchers: jest.fn().mockResolvedValue([])
    }
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn()
    }
}));

// Dynamic import
const { candidateSocketHandler } = await import('../../src/sockets/candidateSocket.js');
const { candidateService } = await import('../../src/services/candidateService.js');
const { notificationService } = await import('../../src/services/notificationService.js');

describe('CandidateSocketHandler - Discussion Persistence', () => {
    let mockSocket;
    let mockCallback;

    beforeEach(() => {
        mockSocket = {
            data: {
                user: {
                    email: 'sender@example.com',
                    role: 'user',
                    displayName: 'Sender Name'
                }
            },
            to: jest.fn().mockReturnThis(),
            emit: jest.fn(),
            nsp: {
                to: jest.fn().mockReturnThis(),
                emit: jest.fn(),
                adapter: {
                    rooms: new Map()
                },
                sockets: new Map()
            }
        };
        mockCallback = jest.fn();

        // Reset mocks
        candidateService.addComment.mockReset();
        candidateService.getCandidateById.mockReset();
        candidateService.resolveHierarchyWatchers.mockReset();
        candidateService.resolveExpertHierarchy.mockReset();
        notificationService.broadcastToWatchers.mockReset();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should persist notifications to watchers when comment is added', async () => {
        const payload = {
            candidateId: 'cand-1',
            content: 'Test comment',
            type: 'internal'
        };

        // Mock Service Responses
        candidateService.addComment.mockResolvedValue({
            id: 'comment-1',
            content: 'Test comment',
            author: { name: 'Sender Name' },
            type: 'internal'
        });

        candidateService.getCandidateById.mockResolvedValue({
            id: 'cand-1',
            resumeUnderstandingStatus: 'pending',
            expertRaw: 'expert@example.com'
        });

        candidateService.resolveHierarchyWatchers.mockReturnValue(['manager@example.com']);
        candidateService.resolveExpertHierarchy.mockReturnValue(['expert@example.com']);

        // Invoke
        await candidateSocketHandler.handleAddResumeComment(mockSocket, payload, mockCallback);

        // Verification
        // 1. Check callback success
        expect(mockCallback).toHaveBeenCalledWith({ success: true, data: expect.anything() });

        // 2. Check persistence call
        // Wait for async promise chain in handleAddResumeComment (it doesn't await the notification promise)
        // However, in test env, we might need to wait or expect slightly differently.
        // But since we are mocking, we can check if it was called.
        // Wait! The code in handleAddResumeComment does NOT await `this.emitCommentNotifications`!
        // It calls it and attaches .then().
        // So we need to wait for promises to flush.

        await new Promise(process.nextTick);

        expect(notificationService.broadcastToWatchers).toHaveBeenCalled();
        const [recipients, notificationData] = notificationService.broadcastToWatchers.mock.calls[0];

        expect(recipients).toContain('manager@example.com');
        expect(recipients).toContain('expert@example.com');
        expect(recipients).not.toContain('sender@example.com'); // Should be filtered

        expect(notificationData).toMatchObject({
            type: 'comment',
            candidateId: 'cand-1',
            commentId: 'comment-1',
            resumeUnderstandingStatus: 'pending',
            title: 'New Discussion Message',
            isRead: false
        });
    });

    it('should NOT persist notifications if no recipients found', async () => {
        const payload = { candidateId: 'cand-2', content: 'Empty', type: 'internal' };

        candidateService.addComment.mockResolvedValue({ id: 'c2', content: 'Empty', author: {} });
        candidateService.getCandidateById.mockResolvedValue({ id: 'cand-2' });
        candidateService.resolveHierarchyWatchers.mockReturnValue([]);
        candidateService.resolveExpertHierarchy.mockReturnValue([]);

        await candidateSocketHandler.handleAddResumeComment(mockSocket, payload, mockCallback);
        await new Promise(process.nextTick);

        expect(notificationService.broadcastToWatchers).not.toHaveBeenCalled();
    });
});
