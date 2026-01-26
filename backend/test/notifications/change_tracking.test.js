
import { describe, it, expect, jest, afterEach, beforeEach } from '@jest/globals';
import { candidateService } from '../../src/services/candidateService.js';
import { candidateModel } from '../../src/models/Candidate.js';
import { notificationModel } from '../../src/models/Notification.js';
import { domainEventBus } from '../../src/events/eventBus.js';
import { userModel } from '../../src/models/User.js';

describe('Notification Change Tracking', () => {
    let publishSpy;

    beforeEach(() => {
        // Mock candidateModel methods
        candidateModel.updateCandidateById = jest.fn();
        candidateModel.getCandidateById = jest.fn();

        // Mock userModel
        userModel.getAllUsers = jest.fn().mockReturnValue([]);

        // Mock notificationModel
        notificationModel.createNotification = jest.fn().mockResolvedValue({ id: 'notif123' });
        notificationModel.createManyNotifications = jest.fn().mockResolvedValue([]);

        // Spy on event bus
        publishSpy = jest.spyOn(domainEventBus, 'publish');
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('captures change details when status is updated', async () => {
        const oldCandidate = {
            _id: 'cand123',
            id: 'cand123',
            name: 'John Doe',
            workflowStatus: 'Active',
            status: 'Active',
            branch: 'DEL',
            recruiter: 'recruiter@example.com'
        };

        const newCandidate = {
            ...oldCandidate,
            workflowStatus: 'Joined',
            status: 'Joined'
        };

        candidateModel.getCandidateById.mockResolvedValue(oldCandidate);
        candidateModel.updateCandidateById.mockResolvedValue(newCandidate);

        const user = { email: 'admin@example.com', role: 'admin', name: 'Admin User' };

        await candidateService.updateCandidate(
            user,
            'cand123',
            { status: 'Joined' }
        );

        // Verify Event was published with changeDetails
        expect(publishSpy).toHaveBeenCalled();
        const callArgs = publishSpy.mock.calls.find(call => call[0] === 'candidate.updated');

        expect(callArgs).toBeDefined();
        const payload = callArgs[1];

        expect(payload.changeDetails).toBeDefined();
        expect(payload.changeDetails).toEqual({
            changedFields: ['status'],
            oldValue: { status: 'Active' },
            newValue: { status: 'Joined' }
        });

        expect(payload.actor).toEqual({
            email: 'admin@example.com',
            name: 'Admin User',
            role: 'admin'
        });
    });

    it('does not generate change details if status is unchanged', async () => {
        const oldCandidate = {
            _id: 'cand123',
            id: 'cand123',
            name: 'John Doe',
            workflowStatus: 'Active',
            status: 'Active'
        };

        // User sends same status
        candidateModel.getCandidateById.mockResolvedValue(oldCandidate);
        candidateModel.updateCandidateById.mockResolvedValue(oldCandidate); // Returns same

        const user = { email: 'admin@example.com', role: 'admin' };

        await candidateService.updateCandidate(
            user,
            'cand123',
            { status: 'Active' }
        );

        // Verify Event payload
        const callArgs = publishSpy.mock.calls.find(call => call[0] === 'candidate.updated');
        const payload = callArgs[1];

        // Assuming getCandidateChangeDetails returns null or empty for no changes
        // But updateCandidate logic always generates it if logic matches. 
        // Wait, updateCandidate logic: const changes = this.getCandidateChangeDetails(oldCandidate, updates);
        // updates = { status: 'Active' }. oldCandidate.status = 'Active'.
        // Logic: if (updates.status && updates.status !== oldStatus) ... via simple check? or is deep compare?
        // Let's verify actual behavior. If logic is robust, it should handle it.
        // If logic is dumb (just checks presence in updates), it might say { old: Active, new: Active }.

        // Based on my implementation:
        // updates.status !== oldStatus

        if (payload.changeDetails) {
            expect(payload.changeDetails.changedFields).toEqual([]);
        } else {
            expect(payload.changeDetails).toBeUndefined();
        }
    });
});
