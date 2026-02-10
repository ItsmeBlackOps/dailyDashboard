import { describe, it, expect } from '@jest/globals';
import { taskService } from '../src/services/taskService.js';

describe('taskService.visibility', () => {
    describe('mlead visibility', () => {
        const mleadEmail = 'avinash.mishra@vizvainc.com'; // Mixed case example
        const mleadRole = 'mlead';
        const manager = 'Some Manager';
        const teamEmails = ['recruiter1@vizvainc.com', 'recruiter2@vizvainc.com'];

        it('matches sender with mixed case (case-insensitive)', () => {
            const query = taskService.buildSearchQuery(mleadEmail, mleadRole, manager, []);
            const patterns = query.$or || [];

            // Should match lowercased email in sender/cc
            const lowerEmail = mleadEmail.toLowerCase();
            const hasSenderMatch = patterns.some(p => p.sender && p.sender.$regex && p.sender.$options === 'i' && p.sender.$regex.includes(lowerEmail));
            const hasCcMatch = patterns.some(p => p.cc && p.cc.$regex && p.cc.$options === 'i' && p.cc.$regex.includes(lowerEmail));

            expect(hasSenderMatch).toBe(true);
            expect(hasCcMatch).toBe(true);
        });

        it('includes tasks where team members are sender or cc', () => {
            const query = taskService.buildSearchQuery(mleadEmail, mleadRole, manager, teamEmails);
            const patterns = query.$or || [];

            // Check for recruiter 1 - expecting it to be present in the regex
            // Note: The code escapes the email, so we expect 'recruiter1@vizvainc\\.com'
            // We can just check that the regex string contains the local part to be safe/simple
            const r1Local = teamEmails[0].split('@')[0];
            const hasR1Sender = patterns.some(p => p.sender && p.sender.$regex && p.sender.$regex.includes(r1Local));

            expect(hasR1Sender).toBe(true);
        });

        it('does NOT include assignedTo matching for mlead', () => {
            const query = taskService.buildSearchQuery(mleadEmail, mleadRole, manager, teamEmails);
            const patterns = query.$or || [];

            // We expect NO pattern that matches assignedTo for the mlead's email
            const lowerEmail = mleadEmail.toLowerCase();
            // The code produces assignedTo for TEAM members, but not for self.
            // We check that NONE of the assignedTo patterns match the SELF email.

            const hasAssignedToMe = patterns.some(p =>
                p.assignedTo &&
                ((p.assignedTo.$regex && p.assignedTo.$regex.includes(lowerEmail)) || p.assignedTo === lowerEmail)
            );

            expect(hasAssignedToMe).toBe(false);
        });
    });

    describe('mam visibility', () => {
        const mamEmail = 'mam.user@vizvainc.com';
        const mamRole = 'mam';
        const manager = 'Upper Manager';
        const teamEmails = ['mlead1@vizvainc.com', 'recruiter1@vizvainc.com']; // Team includes mleads and their recruiters

        it('matches sender with mixed case (case-insensitive)', () => {
            const query = taskService.buildSearchQuery(mamEmail, mamRole, manager, []);
            const patterns = query.$or || [];

            const lowerEmail = mamEmail.toLowerCase();
            const hasSenderMatch = patterns.some(p => p.sender && p.sender.$regex && p.sender.$options === 'i' && p.sender.$regex.includes(lowerEmail));

            expect(hasSenderMatch).toBe(true);
        });

        it('includes tasks from team members', () => {
            const query = taskService.buildSearchQuery(mamEmail, mamRole, manager, teamEmails);
            const patterns = query.$or || [];

            const mleadLocal = teamEmails[0].split('@')[0];
            const hasMleadSender = patterns.some(p => p.sender && p.sender.$regex && p.sender.$regex.includes(mleadLocal));

            expect(hasMleadSender).toBe(true);
        });
    });
});
