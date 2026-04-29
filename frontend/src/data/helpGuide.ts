// Role-aware in-app help & feature guide content.
// Each section is grouped by audience role(s). The HelpGuide component
// filters sections by the current user's role; "all" sections are shown
// to everyone. Update this file as features land.

export type GuideRole =
  | 'all'
  | 'admin'
  | 'mlead'        // marketing lead
  | 'teamlead'
  | 'recruiter'
  | 'tech';        // technical/engineering audience

export interface GuideStep {
  /** Imperative instruction. */
  text: string;
  /** Optional in-app deep link (react-router path) the user can click. */
  to?: string;
  /** Optional plain external URL. */
  href?: string;
}

export interface GuideSection {
  id: string;
  title: string;
  /** One-line summary shown under the title. */
  summary: string;
  /** Roles for whom this section is relevant. Use ['all'] to show everywhere. */
  roles: GuideRole[];
  /** "New" badge — set when a feature shipped in the last ~14 days. */
  isNew?: boolean;
  /** Step-by-step click path. */
  steps: GuideStep[];
  /** Optional callouts/tips shown beneath the steps. */
  tips?: string[];
}

export const HELP_GUIDE: GuideSection[] = [
  // ── Candidate Profile ──────────────────────────────────────────────
  {
    id: 'candidate-profile',
    title: 'Open a Candidate Profile',
    summary: 'See full resume, search profile, and history in one place.',
    roles: ['all'],
    isNew: true,
    steps: [
      { text: 'Go to Branch Candidates from the sidebar.', to: '/branch-candidates' },
      { text: 'Find the candidate row and click the user-circle icon (between Discussion and Mock Interview).' },
      { text: 'The profile page opens with resume, Search Profile card, and timeline.' },
    ],
    tips: [
      'You can also reach a profile from any task — click the candidate name in the task header.',
      'The Actions pane (three-dot menu) is still available on the row for quick edits.',
    ],
  },

  // ── Search Profile (forge profile) ─────────────────────────────────
  {
    id: 'search-profile',
    title: 'Re-derive Search Profile from Resume',
    summary: 'AI extracts titles, keywords, and years of experience for job search.',
    roles: ['all'],
    isNew: true,
    steps: [
      { text: 'Open the candidate profile (see "Open a Candidate Profile" above).' },
      { text: 'Scroll to the Search Profile card.' },
      { text: 'Click "Re-derive from Resume" (or "Derive Now" if no profile exists yet).' },
      { text: 'Wait ~10s — titles, keywords, and YoE refresh automatically.' },
    ],
    tips: [
      'The profile is auto-derived the first time a resume is uploaded.',
      'Use Re-derive after uploading a fresher resume to keep search quality high.',
    ],
  },

  // ── Find Jobs ──────────────────────────────────────────────────────
  {
    id: 'find-jobs',
    title: 'Find Jobs for a Candidate',
    summary: 'One click → AI plans titles → searches LinkedIn + all career portals.',
    roles: ['all'],
    isNew: true,
    steps: [
      { text: 'Open the candidate row on Branch Candidates.', to: '/branch-candidates' },
      { text: 'Click the "Find Jobs" action.' },
      { text: 'Confirm in the dialog — no fields to fill, just press "Start Job Search".' },
      { text: 'You get a toast; results stream into the session page.' },
    ],
    tips: [
      'The scraper uses the candidate\'s Search Profile to fan out across multiple titles automatically.',
      'Default search window is the last 7 days, remote-friendly, US-only, full-time + contractor.',
      'Easy Apply / agency listings are filtered out by default.',
    ],
  },

  // ── Interview Recording (Fireflies bot) ────────────────────────────
  {
    id: 'recording',
    title: 'How Interview Recording Works',
    summary: 'Fireflies auto-joins interviews — no manual link copy-paste.',
    roles: ['all'],
    isNew: true,
    steps: [
      { text: 'When an interview-support email arrives, the task is created automatically.' },
      { text: 'Backend scans the email body for Zoom / Meet / Teams / Webex / Whereby / BlueJeans / GoToMeeting URLs.' },
      { text: 'At T-20 minutes, a precheck bot joins to validate the link.' },
      { text: 'At T-0, the main bot joins for up to 3 hours and starts recording.' },
      { text: 'If the bot fails to join, scheduler retries up to 3 times before marking the task as failed.' },
    ],
    tips: [
      'You can override the meeting link manually from the Task Sheet → "Save & Invite Bot" if auto-extraction missed it.',
      'Bot status is visible in the task: pending → precheck_invited → precheck_joined → main_invited → main_joined.',
    ],
  },

  // ── Tasks page essentials ──────────────────────────────────────────
  {
    id: 'tasks-tab',
    title: 'Tasks Tab — Recruiter / Team Lead Filters',
    summary: 'Filter tasks by team lead, recruiter, or status.',
    roles: ['admin', 'teamlead', 'mlead', 'recruiter'],
    steps: [
      { text: 'Open Tasks from the sidebar.', to: '/' },
      { text: 'Use the Team Lead dropdown to scope visible tasks to one lead\'s team.' },
      { text: 'Use the Recruiter dropdown to drill into a specific recruiter.' },
      { text: 'Click any task row to open the Task Sheet with full body, replies, and bot status.' },
    ],
    tips: [
      'If the Recruiter dropdown is empty, refresh — recent fix shipped (Apr 28) restored the data.',
    ],
  },

  // ── Interview Support Admin ────────────────────────────────────────
  {
    id: 'interview-support-admin',
    title: 'Interview Support Admin (restricted)',
    summary: 'Outlook scan, Kafka push, logs and unprocessed queue.',
    roles: ['admin'],
    steps: [
      { text: 'Open Interview Support from the sidebar.', to: '/interview-support' },
      { text: 'Tab "Unprocessed" — review emails not yet pushed to Kafka.' },
      { text: 'Tab "Scan Outlook" — manually trigger an Outlook fetch.' },
      { text: 'Tab "Logs" — view delivery / processing stats.' },
    ],
    tips: [
      'Restricted to harsh.patel@silverspaceinc.com. Other admins will see a 403.',
    ],
  },

  // ── Performance Hub ────────────────────────────────────────────────
  {
    id: 'performance',
    title: 'Performance Pill & Admin Performance Tab',
    summary: 'See FE / BE response times in real time + 7-day trend.',
    roles: ['admin', 'tech'],
    steps: [
      { text: 'The pill in the header shows current FE/BE p50 latency (e.g. 320ms FE · 480ms BE).' },
      { text: 'Click into Admin → Performance for breakdown by route + 7-day trend chart.', to: '/performance' },
    ],
    tips: [
      'Metrics are stored in the perfMetrics collection with a 7-day TTL.',
      'Indexes are auto-created on backend startup via ensurePerfIndexes job.',
    ],
  },

  // ── Hub Stats / Branch view ────────────────────────────────────────
  {
    id: 'profile-hub',
    title: 'Profile Hub — Branch Aging, Workload, Recruiters',
    summary: 'Multi-tab analytics for marketing leads.',
    roles: ['mlead', 'admin'],
    steps: [
      { text: 'Open Profile Hub from the sidebar.', to: '/profile-hub' },
      { text: 'Switch tabs: Aging, Workload, Recruiters Workload, POs, Alerts, Analytics.' },
      { text: 'Each tab respects your scope filter (branch / lead / recruiter).' },
    ],
  },

  // ── Tech: backfill scripts ─────────────────────────────────────────
  {
    id: 'tech-backfill',
    title: 'Backfill Scripts (one-off jobs)',
    summary: 'CLI scripts to backfill Search Profiles or scan email bodies for meeting links.',
    roles: ['tech', 'admin'],
    steps: [
      { text: 'SSH to the production VM.' },
      { text: 'cd into the backend container or volume mount.' },
      { text: 'Run: node backend/scripts/backfill-forge-profiles.js --concurrency=3 --dry  (test first)' },
      { text: 'Drop --dry to commit. Use --force to re-derive everyone, --limit=N to throttle.' },
    ],
    tips: [
      '--dry logs what would happen without calling OpenAI — safe to run anywhere.',
      'Concurrency-3 keeps within OpenAI rate limits for gpt-4o-mini.',
    ],
  },

  // ── Tech: scraper env tuning ───────────────────────────────────────
  {
    id: 'tech-scraper',
    title: 'Tuning the Job Scraper',
    summary: 'Env vars that control title fan-out, time range, and Apify filters.',
    roles: ['tech'],
    steps: [
      { text: 'All env vars live on the scraper container (host-level env wins over server.py defaults).' },
      { text: 'Time range: LINKEDIN_TIME_RANGE=7d, FANTASTIC_JOBS_TIME_RANGE=7d.' },
      { text: 'AI filters: FANTASTIC_JOBS_INCLUDE_AI=true, FANTASTIC_JOBS_AI_EMPLOYMENT_TYPES=FULL_TIME,CONTRACTOR.' },
      { text: 'Work modes: FANTASTIC_JOBS_AI_WORK_ARRANGEMENTS=On-site,Hybrid,Remote OK,Remote Solely.' },
      { text: 'LinkedIn: LINKEDIN_NO_DIRECT_APPLY=true (excludes Easy Apply).' },
    ],
    tips: [
      'The scraper\'s LLM plan derives multiple titles per resume on its own — no manual title list needed.',
      'Override a candidate\'s YoE band only if you must — empty values let the LLM decide.',
    ],
  },

  // ── Tech: API auth ─────────────────────────────────────────────────
  {
    id: 'tech-auth',
    title: 'API Authentication Pattern',
    summary: 'JWT lives in localStorage["accessToken"] — never "token".',
    roles: ['tech'],
    steps: [
      { text: 'Frontend: use the useAuth() hook → authFetch — it injects the token automatically.' },
      { text: 'For one-off fetches, read localStorage.getItem("accessToken") (NOT "token").' },
      { text: 'Backend: every /api route is protected by authenticateHTTP middleware.' },
    ],
    tips: [
      'Bug pattern fixed twice now: reading the wrong key → silent Bearer null → 401 dropdown empty. Use authFetch.',
    ],
  },
];
