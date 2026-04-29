export interface Job {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remote_type: 'remote' | 'hybrid' | 'onsite';
  ats: string;
  url: string;
  date_posted: string;
  skills?: string[];
  snippet: string;
}

export interface TailoredStatus {
  status: 'pending' | 'running' | 'complete' | 'error';
  tailoredResumeUrl?: string;
  error?: string;
}

export interface JobSession {
  _id: string;
  sessionId: string;
  candidateId: string;
  status: 'running' | 'complete' | 'error';
  filters: Record<string, unknown>;
  /** Backend stores `requestedAt`; older shapes used `createdAt`. */
  requestedAt?: string;
  createdAt?: string;
  completedAt?: string | null;
  error?: string | null;
  totalFound?: number;
}

export interface JobSessionResponse {
  success: boolean;
  session: JobSession;
  jobs: Job[];
  tailored: Record<string, TailoredStatus>;
}

export type SortKey = 'date-desc' | 'date-asc' | 'company-asc' | 'title-asc';

export interface JobFilters {
  remote: string[];
  ats: string[];
  state: string[];
  company: string[];
  onlyStarred: boolean;
}
