import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock dependencies before import
jest.unstable_mockModule('../../src/services/candidateService.js', () => ({
    candidateService: {
        addComment: jest.fn(),
        getCandidateById: jest.fn(),
        resolveHierarchyWatchers: jest.fn(),
        resolveExpertHierarchy: jest.fn()
    }
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn()
    }
}));

// Dynamic import after mocking
const { candidateSocketHandler } = await import('../../src/sockets/candidateSocket.js');
const { candidateService } = await import('../../src/services/candidateService.js');

describe('CandidateSocketHandler RBAC Regression', () => {
    let mockSocket;
    let mockCallback;

    beforeEach(() => {
        mockSocket = {
            data: {
                user: {
                    email: 'test@example.com',
                    role: 'user'
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
        candidateService.resolveHierarchyWatchers.mockReturnValue([]);
        candidateService.resolveExpertHierarchy.mockReturnValue([]);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should allow valid user to add internal comment', async () => {
        const payload = {
            candidateId: 'cand-123',
            content: 'Hello world',
            type: 'internal'
        };

        candidateService.addComment.mockResolvedValue({
            id: 'comment-1',
            content: 'Hello world',
            author: { name: 'Test User' }
        });
        candidateService.getCandidateById.mockResolvedValue({ id: 'cand-123' });

        await candidateSocketHandler.handleAddResumeComment(mockSocket, payload, mockCallback);

        expect(candidateService.addComment).toHaveBeenCalledWith(
            mockSocket.data.user,
            'cand-123',
            'Hello world',
            'internal'
        );
        expect(mockCallback).toHaveBeenCalledWith({ success: true, data: expect.anything() });
    });

    it('should propagate 403 error from service when user is unauthorized for complaint', async () => {
        mockSocket.data.user.role = 'expert';
        const payload = {
            candidateId: 'cand-123',
            content: 'Complaint text',
            type: 'complaint'
        };

        const error = new Error('You are not authorized to create complaint comments');
        error.statusCode = 403;
        candidateService.addComment.mockRejectedValue(error);

        await candidateSocketHandler.handleAddResumeComment(mockSocket, payload, mockCallback);

        expect(mockCallback).toHaveBeenCalledWith({
            success: false,
            error: 'You are not authorized to create complaint comments'
        });
    });

    it('should fail if authentication is missing', async () => {
        mockSocket.data.user = null;
        const payload = { candidateId: '123', content: 'test' };

        const error = new Error('Authentication required');
        error.statusCode = 401;
        candidateService.addComment.mockRejectedValue(error);

        await candidateSocketHandler.handleAddResumeComment(mockSocket, payload, mockCallback);

        expect(mockCallback).toHaveBeenCalledWith({
            success: false,
            error: 'Unable to add comment'
        });
    });

    it('should allow recruiter to add complaint', async () => {
        mockSocket.data.user.role = 'recruiter';
        const payload = {
            candidateId: 'cand-123',
            content: 'Valid complaint',
            type: 'complaint'
        };

        candidateService.addComment.mockResolvedValue({ id: 'c1' });
        candidateService.getCandidateById.mockResolvedValue({ id: 'cand-123' });

        await candidateSocketHandler.handleAddResumeComment(mockSocket, payload, mockCallback);

        expect(candidateService.addComment).toHaveBeenCalled();
        expect(mockCallback).toHaveBeenCalledWith({ success: true, data: expect.anything() });
    });
});
