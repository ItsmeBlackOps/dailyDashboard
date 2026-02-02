
export interface ChangelogUpdate {
    id: string; // Version or Unique ID
    date: string;
    roles?: string[]; // If omitted, visible to all
    title: string;
    content: string; // Markdown or plain text
}

export const CHANGELOG: ChangelogUpdate[] = [
    {
        id: '1.2.0',
        date: '2025-01-29',
        roles: ['admin', 'recruiter', 'mlead', 'mam', 'mm'],
        title: 'New Feature: Resume Understanding Logic',
        content: `
**Workflows Updated:**
- **Resume Understanding Button:** Added a dedicated button in the Branch Candidates sidebar to seamlessly move candidates to the Resume Understanding queue.
- **Expert Name Column:** Now visible in the Resume Understanding table for improved transparency.
- **Improved Email Matching:** System now uses case-insensitive matching for better accuracy.

*Visible to: Admin, Recruiter, MLead, MAM, MM.*
    `
    }
];
