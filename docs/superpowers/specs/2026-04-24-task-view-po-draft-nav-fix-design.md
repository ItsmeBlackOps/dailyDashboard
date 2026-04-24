# Design: Universal Task Sheet + PO Draft + Tab Navigation Fix

**Date:** 2026-04-24  
**Status:** Approved

---

## Overview

Three coordinated improvements to dailyDashboard:

1. **Universal Task Slide-in Sheet** — a single consistent component for viewing task details + email thread, used everywhere tasks appear
2. **PO Draft** — create a Placement Offer record from an existing task, with auto-fill + manual fields, generates a mailto: template
3. **Tab Navigation Fix** — sync active tab to URL query param so Back returns to the correct tab

---

## 1. Universal Task Sheet

### What it replaces
The existing `TaskDetailDrawer` (Dialog-based) is replaced by a `TaskSheet` component using Shadcn `Sheet` (slide-in from right). The `TaskDetailPage` (`/task/:taskId`) remains as a full-page fallback.

### Component: `frontend/src/components/shared/TaskSheet.tsx`

**Props:**
```ts
interface TaskSheetProps {
  taskId: string | null;
  onClose: () => void;
}
```

**Behavior:**
- `open` when `taskId` is non-null
- On open: fetches `GET /api/candidates/task/:taskId` — shows skeleton while loading
- Displays:
  - Status badge, date, time (start–end)
  - Grid: Client, Role, Round, Actual Round, Vendor, Recruiter, Expert, Assigned At
  - Suggestions badges
  - Email thread: original body + replies as bubbles (avatar, sender, timestamp, body)
  - Fallback card if no email thread
- Footer actions:
  - **Create PO Draft** — opens `PODraftSheet` stacked on top
  - **View Candidate Profile** — navigates to `/candidate/:id`, closes sheet

**Used in:**
- `ExpertAnalytics.tsx` — replaces current `TaskDetailDrawer`
- `RecruiterAnalytics.tsx` — replaces current `TaskDetailDrawer`
- `TasksToday.tsx` — new: clicking a task row opens sheet
- `CandidateDetailPage.tsx` — timeline interview cards on click
- `AlertsTab.tsx` — task rows
- `POTab.tsx` — task rows

**Lazy fetch:** Data is only fetched when `taskId` becomes non-null. Closing resets to null and clears task state.

---

## 2. PO Draft

### MongoDB Collection: `poDetails`

```js
{
  _id: ObjectId,

  // Auto-filled from task
  candidateId: ObjectId,        // ref: candidateDetails._id
  candidateName: String,
  emailId: String,
  endClient: String,
  position: String,             // role from task
  vendor: String,
  branch: String,
  recruiter: String,            // marketing recruiter email

  // Manually entered
  jobType: String,              // 'W2' | 'C2C' | 'FTE'
  rate: String,                 // e.g. "$98,009.60 / Annum"
  signupDate: Date,
  joiningDate: Date,
  agreementPct: Number,         // e.g. 14
  agreementMonths: Number,      // e.g. 5
  upfrontAmount: Number,        // e.g. 1500
  poCount: {
    total: Number,
    ggr: Number,
    lkn: Number,
    ahm: Number,
    lko: Number,
    uk: Number,
  },
  interviewExpert: String,

  // Metadata
  isDraft: Boolean,             // true until explicitly published
  sourceTaskId: ObjectId,       // task used to pre-fill
  createdBy: String,            // user email
  createdAt: Date,
  updatedAt: Date,
}
```

**Indexes:**
```js
{ candidateId: 1 }
{ recruiter: 1, createdAt: -1 }
{ branch: 1, joiningDate: 1 }
```

### Backend Routes

All routes under `/api/po`, protected by `authenticateHTTP`:

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/po` | Create or update a PO draft. Body: all poDetails fields. |
| `GET` | `/api/po` | List POs. Query: `branch`, `recruiter`, `isDraft`, `page`, `limit` |
| `GET` | `/api/po/:candidateId` | Get PO record for a candidate |
| `DELETE` | `/api/po/:id` | Delete a draft |

**Controller:** `backend/src/controllers/poController.js`  
**Route file:** `backend/src/routes/po.js`  
**Registered in:** `backend/src/app.js` as `app.use('/api/po', poRouter)`

### Frontend Component: `PODraftSheet`

**File:** `frontend/src/components/shared/PODraftSheet.tsx`

**Props:**
```ts
interface PODraftSheetProps {
  open: boolean;
  onClose: () => void;
  prefill: {
    taskId: string;
    candidateId?: string;
    candidateName: string;
    emailId: string;
    endClient: string;
    position: string;
    vendor: string;
    branch: string;
    recruiter: string;
  } | null;
}
```

**Layout — two sections:**

**Section 1 — Auto-filled (read-only, green tint):**
Candidate Name, Email ID, End Client, Position, Vendor, Branch, Recruiter

**Section 2 — Manual fields:**
- Job Type: dropdown (W2 / C2C / FTE)
- Rate: text input
- Signup Date: date picker
- Joining Date: date picker
- Agreement: three inputs — % / months / upfront amount
- PO Count: six number inputs (Total, GGR, LKN, AHM, LKO, UK)
- Interview Expert: text input

**Actions:**
- **Save Draft** → `POST /api/po` with `isDraft: true` → success toast
- **Generate Mail Template** → builds `mailto:` URL → `window.open(mailtoUrl, '_blank')`
- **Cancel** → closes sheet

**mailto: template format:**
```
Subject: PO Details — {candidateName}

Hello Team,
Kindly find the PO details of {candidateName}

Name of Candidate: {candidateName}
Branch: {branch} | Company: SST/Vizva
PO Count: Total – {total} | GGR – {ggr} | LKN – {lkn} | AHM – {ahm} | LKO – {lko}
Email ID: {emailId}
Type of Job: {jobType}
Position: {position}
Implementation/End Client: {endClient}
Vendor: {vendor}
Rate: {rate}
Signup Date: {signupDate}
Joining Date: {joiningDate}
Agreement: {agreementPct}% in {agreementMonths} Months / Upfront – ${upfrontAmount} (NR)

Marketing Recruiter: {recruiter}
Interview Support Expert: {interviewExpert}
```

**Trigger points:**
- `TaskSheet` footer — "Create PO Draft" button (passes task data as prefill)
- `CandidateDetailPage` actions — "Create PO" button (visible when status = "Placement Offer")

### POTab Update
- Reads from `GET /api/po?isDraft=false` for published POs
- Reads from `GET /api/po?isDraft=true` for drafts (separate sub-tab or filter toggle)
- Existing missing-poDate alert remains for `candidateDetails` backward compat

---

## 3. Tab Navigation Fix

**Problem:** Tabbed pages (ProfileHub, DashboardV2) store active tab in React state only. Navigating away and pressing Back resets to the default tab.

**Fix:** Sync active tab to URL query parameter using React Router.

**Pattern for every tabbed page:**
```tsx
import { useSearchParams } from 'react-router-dom';

const [searchParams, setSearchParams] = useSearchParams();
const activeTab = searchParams.get('tab') ?? 'overview';

const handleTabChange = (value: string) => {
  setSearchParams({ tab: value }, { replace: true });
};

<Tabs value={activeTab} onValueChange={handleTabChange}>
```

**Pages affected:**
- `frontend/src/components/profile-hub/ProfileHub.tsx`
- `frontend/src/pages/DashboardV2.tsx` (or its tab shell component)

---

## File Inventory

### New Files
| File | Purpose |
|---|---|
| `frontend/src/components/shared/TaskSheet.tsx` | Universal task slide-in sheet |
| `frontend/src/components/shared/PODraftSheet.tsx` | PO draft form slide-in sheet |
| `backend/src/controllers/poController.js` | PO CRUD logic |
| `backend/src/routes/po.js` | PO API routes |

### Modified Files
| File | Change |
|---|---|
| `frontend/src/components/dashboard/v2/ExpertAnalytics.tsx` | Use `TaskSheet` instead of `TaskDetailDrawer` |
| `frontend/src/components/dashboard/v2/RecruiterAnalytics.tsx` | Use `TaskSheet` instead of `TaskDetailDrawer` |
| `frontend/src/components/profile-hub/ProfileHub.tsx` | URL tab sync |
| `frontend/src/components/profile-hub/POTab.tsx` | Read from `poDetails` collection |
| `frontend/src/components/profile-hub/AlertsTab.tsx` | Add `TaskSheet` on task click |
| `frontend/src/pages/CandidateDetailPage.tsx` | Add `TaskSheet` + "Create PO" action |
| `frontend/src/pages/DashboardV2.tsx` | URL tab sync |
| `frontend/src/pages/TasksToday.tsx` | Add `TaskSheet` on task row click |
| `backend/src/app.js` | Register `/api/po` router |

### Unchanged
- `TaskDetailDrawer.tsx` — kept for backward compat, deprecated in favour of `TaskSheet`
- `TaskDetailPage.tsx` — kept as full-page view, linked from `TaskSheet` footer
- All existing candidate/task/dashboard routes

---

## Error Handling

- Task fetch fails → error message inside sheet, retry button
- PO save fails → toast error, form stays open
- mailto: blocked by browser → show copyable text fallback
- Missing prefill fields → show empty inputs (not errors), user can fill manually

---

## Out of Scope
- Sending email directly from the app (no SMTP integration)
- PO approval workflow / sign-off
- Editing published POs (drafts only for now)
- Job description text storage
