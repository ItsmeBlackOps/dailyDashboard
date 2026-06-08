// Normalizes a server candidate record into the row shape the Branch
// Candidates list renders. Single source of truth for both the fetch path
// and the optimistic insert after create (Task B2).
export function normalizeCandidateRow<T extends Record<string, unknown>>(candidate: T) {
  return {
    ...candidate,
    recruiter: (candidate as any).recruiter || '',
    recruiterRaw: (candidate as any).recruiterRaw || '',
    expert: (candidate as any).expert || '',
    expertRaw: (candidate as any).expertRaw || '',
    resumeLink: (candidate as any).resumeLink || '',
    resumeUnderstanding: Boolean((candidate as any).resumeUnderstanding),
    resumeUnderstandingStatus: (candidate as any).resumeUnderstandingStatus,
    workflowStatus: (candidate as any).workflowStatus,
  };
}
