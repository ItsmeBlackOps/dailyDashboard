# scraper-web — design spec

**Date:** 2026-04-19
**Sub-project:** C (from the scraper → Supabase → frontend line)
**Status:** approved design; ready for implementation plan

## Purpose

A single-user, dark-themed web app that browses the jobs collected
by the Python scraper and stored in Supabase. Provides filterable,
paginated, virtualised access to `scraper_jobs_clean` plus a small
dashboard (source counts, jobs-over-time chart), a shareable detail
view per job, and a CSV export of the current filter. Must stay
responsive at 100k+ rows.

## Non-goals

- User authentication / multi-tenancy (public URL, no auth)
- Writing to Supabase (frontend is read-only)
- Light mode / theme switcher
- Admin features (rerun scrapes, edit rows, etc.)
- Mobile-first design (desktop-first; mobile-responsive is best-effort)

## Architecture

| Concern | Choice |
|---|---|
| Framework | Next.js 15 App Router, React 19, TypeScript strict |
| Styling | Tailwind CSS |
| UI primitives | shadcn/ui (Dialog, DropdownMenu, Button, Toast) |
| Data table | TanStack Table v8 |
| Row virtualisation | TanStack Virtual |
| Server state | TanStack Query v5 |
| Charts | Recharts |
| Animation | Framer Motion |
| Supabase SDK | `@supabase/ssr` (uses publishable key) |
| Fonts | Geist Sans (body), Geist Mono (timestamps / IDs) |
| Hosting | Vercel (free tier sufficient) |
| Repo | Separate repo at `C:\Users\Administrator\OneDrive\Projects\scraper-web\` |

## Project structure

```
scraper-web/
  app/
    layout.tsx             Root layout; dark theme; TanStack Query + Toast providers
    page.tsx               Dashboard home (cards + chart + filter bar + table)
    jobs/[id]/page.tsx     Job detail route (also rendered as modal overlay)
    api/export/route.ts    Server route: streams filtered CSV
  components/
    dashboard/
      SourceCountCards.tsx Animated count cards (one per source)
      JobsOverTimeChart.tsx 30-day stacked area (Recharts)
    filters/
      FilterBar.tsx        Top-level controller
      SourceChips.tsx      Multi-select source chips
      DateRangePicker.tsx  Posted-date range
      RemoteTypePills.tsx  remote / hybrid / onsite
      SearchInput.tsx      Title + description search (300ms debounce)
      SavedPresetsDropdown.tsx localStorage-backed presets
    table/
      JobsTable.tsx        TanStack Table + Virtual integration
      ColumnHeader.tsx     Sortable header cell
      Row.tsx              Click handler + keyboard nav
    detail/
      JobDetailModal.tsx   Framer fade+scale; tabs: description/meta/history/apply
      CopyLinkButton.tsx   Copy deep-link to clipboard
    ui/                    shadcn-generated primitives
  lib/
    supabase/
      server.ts            Server-side client
      client.ts            Browser client
    queries.ts             useJobs, useSourceCounts, useJobsOverTime, useJobById
    filters.ts             Filter state reducer + URL serialisation
    csv.ts                 Row -> CSV line
    types.ts               Row types derived from Supabase schema
  styles/
    palette.ts             Tailwind theme tokens (custom palette)
    animations.ts          Framer Motion variants
  .env.local
  next.config.mjs
  tailwind.config.ts
  package.json
  tsconfig.json
```

## Data model the frontend consumes

Frontend reads only `public.scraper_jobs_clean` (already populated by
the Python scraper). Primary columns used by the UI:

- `id, canonical_key` (row identity, modal deep-link)
- `job_title, company_name, company_norm, location, remote_type, employment_type, seniority`
- `source_platform` (filterable chip)
- `date_posted_normalized` (sort + chart + date-range filter)
- `apply_url, source_url, canonical_url, company_careers_url`
- `job_description_snippet, full_job_description` (modal + search)
- `first_seen_at, last_seen_at, times_seen, classification` (metadata tab)
- `removed_at` (filter: `is.null`)

## New Supabase objects required

Migration name: `scraper_web_support`

1. Generated `tsvector` column + GIN index on `scraper_jobs_clean` for
   fast full-text search over
   `coalesce(job_title,'') || ' ' || coalesce(company_name,'') || ' ' || coalesce(full_job_description,'')`.
2. Postgres function `scraper_source_counts()` returning
   `(source_platform text, n int)` — one RPC instead of 24 GETs.
3. Postgres function `scraper_jobs_by_day(since date, until date)` returning
   `(day date, source_platform text, n int)` — feeds the chart.
4. Both functions `SECURITY DEFINER` and granted to the `anon` role so
   the publishable key can invoke them. Tables already have RLS off.

## Data flow

### List page
- `useJobs(filters, cursor)` issues a Supabase REST GET with `select`,
  `order=date_posted_normalized.desc,id.desc`, `limit=50`, and cursor filter
  `lt=("2026-04-18T...", 9123)` (tuple cursor on ordered key).
- Total-count HEAD request (`count=exact, head=true`) runs once per
  filter change, not per page.
- TanStack Query caches 30 s stale; refetches on window focus.

### Filters
- Source chips — `source_platform=in.(greenhouse,lever,...)`
- Date range — `date_posted_normalized=gte.X&lte.Y`
- Remote type — `remote_type=in.(...)`
- Text search — `search_vec=fts(websearch).<query>` (300 ms debounce)
- Filter state serialises to URL query string (`?src=...&q=...`) so
  pages are shareable / bookmarkable.

### Dashboard cards
- One `scraper_source_counts()` RPC on load; cached 60 s.
- Numbers animate from previous value via Framer `useMotionValue`.

### Chart
- `scraper_jobs_by_day(now() - '30 days'::interval, now())` on load.
- Recharts AreaStack, one stack per source, dark-theme axes.

### Detail modal / route
- Clicking a row pushes `/jobs/[id]` via Next router (modal intercepted
  route so back-button closes it).
- Direct visit to `/jobs/[id]` shows a full page with the same tabs.
- Query: single GET `scraper_jobs_clean?id=eq.<id>&select=*`.

### CSV export
- `app/api/export/route.ts` accepts the filter JSON, creates a
  server-side supabase client, and streams rows in 1 000-row pages into
  a `TransformStream` emitting CSV lines. Response headers set
  `Content-Disposition: attachment; filename="jobs_YYYY-MM-DD.csv"`.
- Progress toast on the client via `fetch` progress events.

## Big-data UX guarantees

- **Row virtualisation.** TanStack Virtual keeps the DOM at ~20 rendered
  rows regardless of table size.
- **Cursor pagination.** Never offset/limit; tuple cursor on
  `(date_posted_normalized, id)` so pagination stays O(log n).
- **Indexed search.** tsvector GIN index keeps text search fast.
- **Count via HEAD.** `count=exact, head=true` avoids fetching rows.
- **Debounced search.** 300 ms on keystroke; immediate on chip toggles.
- **Skeleton rows.** No layout shift while loading.
- **Prefetch next page.** When the viewport reaches 80 % scroll depth.

## Visual design

- **Palette**
  - Base: `#0B0F1A`
  - Surface: `#111827`
  - Cyan accent: `#67E8F9`
  - Warm text: `#F5F5F4`
  - Muted text: `#A1A1AA`
  - Per-source chip hues: mutated HSL ring of 24 colours, 55 % saturation,
    65 % lightness; generated deterministically from the source name.
- **Typography.** Geist Sans 14 px body, 12 px table, Geist Mono for
  timestamps and IDs.
- **Motion vocabulary.** Framer Motion with easing `[0.16, 1, 0.3, 1]`,
  180 ms base duration. Modals fade+scale from 0.98 to 1. Count cards
  animate from previous value. Filter chips scale 0.95 → 1 on toggle.
- **Density.** 38 px table row height (compact, table-first).

## Error handling & loading

- Any Supabase 5xx → Toast with retry button; TanStack Query handles
  exponential backoff automatically.
- Empty filter result → friendly empty-state with "reset filters" CTA.
- Offline (`navigator.onLine === false`) → persistent banner "showing
  cached data".
- Chart or RPC failure → silent collapse of that panel; table stays
  working.
- Unknown route / bad `/jobs/[id]` → Next.js `not-found.tsx` with a
  "back to jobs" button.

## Testing

- **Playwright smokes** (run in CI on push to main):
  1. Home loads; source count cards non-zero.
  2. Clicking a source chip narrows the table.
  3. Scrolling to the bottom loads the next page.
  4. Clicking a row opens the modal; back button closes it.
  5. Clicking export downloads a CSV that starts with the expected header.
- **Vitest** for pure helpers: filter reducer, CSV encoder, cursor
  encoder/decoder.
- No broader matrix — this is a single-user browser.

## Deployment

- `vercel link` once; subsequent pushes to `main` auto-deploy.
- Env vars set in Vercel dashboard:
  - `NEXT_PUBLIC_SUPABASE_URL=https://kwsgxxwbmiicbfvvtmxd.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`
- `preview` builds for PRs; `production` on `main` merges.

## Out of scope (future work)

- Auth / per-user saved presets (Supabase Auth + RLS policies)
- Company/person detail pages
- Notification preferences ("notify me when Lever posts a PM role")
- Admin actions (rerun, mark removed, edit)
- Mobile-optimised layout beyond basic responsiveness

## Required Context7 references during implementation

Per the global `~/.claude/CLAUDE.md` rule, the implementation plan must
invoke Context7 before writing against any of these:

- `/vercel/next.js` — App Router, Route Handlers, streaming responses
- `/websites/supabase_reference_javascript` — `@supabase/ssr`, PostgREST
  `.textSearch`, `.rpc`, `.range`
- `/tanstack/query` — v5 hooks, suspense-style, infinite queries
- `/tanstack/table` — v8 column defs
- `/tanstack/virtual` — virtualised rows in a scrollable container
- `/framer/motion` — layout animations, AnimatePresence
- `/recharts/recharts` — AreaStack, dark-theme styling
- `/tailwindlabs/tailwindcss` — v4 config syntax
- `/shadcn-ui/ui` — Dialog, DropdownMenu, Toast
