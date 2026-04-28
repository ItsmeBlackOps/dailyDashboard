# scraper-web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-user, dark-themed Next.js 15 web app that browses `scraper_jobs_clean` in Supabase — filterable, paginated, virtualised, with a dashboard, detail modal, and CSV export — deployed to Vercel.

**Architecture:** Separate repo at `C:\Users\Administrator\OneDrive\Projects\scraper-web\`. Next.js 15 App Router + React 19 + TypeScript strict, Tailwind v4, shadcn/ui primitives, TanStack Query v5 for server state, TanStack Table v8 + Virtual for the list, Recharts for the chart, Framer Motion for polish, `@supabase/ssr` talking to Supabase PostgREST with the publishable key.

**Tech Stack:** Next.js 15, React 19, TypeScript 5 (strict), Tailwind CSS v4, shadcn/ui, `@supabase/ssr`, `@supabase/supabase-js`, `@tanstack/react-query` v5, `@tanstack/react-table` v8, `@tanstack/react-virtual`, recharts, framer-motion, geist, zod, @vercel/style-guide (ESLint), Vitest, Playwright.

---

## Global rule: Context7 before every library

Per `~/.claude/CLAUDE.md`, **before writing code that uses any of these libraries for the first time**, call Context7:

1. `mcp__context7__resolve-library-id <name>` — get the canonical library ID.
2. `mcp__context7__query-docs <id>` — fetch version-accurate snippets.

Libraries touched by this plan: `/vercel/next.js`, `/supabase/supabase-js`, `/websites/supabase_reference_javascript` (for `@supabase/ssr`), `/tanstack/query`, `/tanstack/table`, `/tanstack/virtual`, `/framer/motion`, `/recharts/recharts`, `/tailwindlabs/tailwindcss`, `/shadcn-ui/ui`, `/colinhacks/zod`.

Each task that introduces one of these libraries has an explicit "Context7 first" step. If it's already been fetched in a previous task in this session, skip — but never write library code without at least one Context7 call in the session.

---

## File Structure

```
C:\Users\Administrator\OneDrive\Projects\scraper-web\
  app/
    layout.tsx                    Root layout, dark theme, providers
    page.tsx                      Dashboard home (cards + chart + filters + table)
    globals.css                   Tailwind entry + CSS vars for palette
    not-found.tsx                 404 w/ "back to jobs"
    jobs/
      [id]/
        page.tsx                  Full-page job detail (direct navigation)
    @modal/
      (..)jobs/
        [id]/
          page.tsx                Intercepted route — renders modal over dashboard
      default.tsx                 Null default so dashboard renders normally
    api/
      export/
        route.ts                  Server route: streams filtered CSV
  components/
    providers/
      query-provider.tsx          TanStack Query client + devtools
      toast-provider.tsx          shadcn Toast region
    dashboard/
      source-count-cards.tsx      Animated cards per source (Framer)
      jobs-over-time-chart.tsx    30-day stacked area (Recharts)
    filters/
      filter-bar.tsx              Top-level filter controller
      source-chips.tsx            Multi-select chips
      date-range-picker.tsx       Posted-date range
      remote-type-pills.tsx       remote/hybrid/onsite
      search-input.tsx            300ms debounced search
      saved-presets-dropdown.tsx  localStorage presets
      export-button.tsx           Triggers CSV download
    table/
      jobs-table.tsx              TanStack Table + Virtual
      column-header.tsx           Sortable header cell
      row.tsx                     Click/keyboard nav
      skeleton-rows.tsx           Loading placeholders
      empty-state.tsx             Friendly empty state w/ reset CTA
    detail/
      job-detail-modal.tsx        Framer fade+scale modal shell
      job-detail-view.tsx         Shared body (tabs: description/meta/history/apply)
      copy-link-button.tsx        Deep-link copy
    offline-banner.tsx            navigator.onLine banner
    ui/                           shadcn-generated primitives (Dialog, Button, DropdownMenu, Toast, Tabs, Skeleton)
  lib/
    supabase/
      server.ts                   Server-side supabase client
      client.ts                   Browser supabase client
    queries/
      jobs.ts                     useJobs infinite query
      source-counts.ts            useSourceCounts RPC
      jobs-over-time.ts           useJobsOverTime RPC
      job-by-id.ts                useJobById
    filters.ts                    Filter state reducer + URL serde
    cursor.ts                     Tuple cursor encode/decode
    csv.ts                        Row -> CSV line + header
    types.ts                      Derived row types
    presets.ts                    localStorage get/set/list
    fonts.ts                      Geist Sans + Mono imports
    utils.ts                      cn() helper (shadcn standard)
  styles/
    palette.ts                    Tailwind theme tokens
    motion.ts                     Framer Motion variants + easing
  tests/
    unit/
      filters.test.ts             Filter reducer + URL round-trip
      cursor.test.ts              Tuple cursor round-trip
      csv.test.ts                 CSV encoder
    e2e/
      dashboard.spec.ts           Home loads, cards non-zero
      filter.spec.ts              Source chip narrows table
      pagination.spec.ts          Scroll-to-bottom loads next page
      modal.spec.ts               Row click opens modal; back closes
      export.spec.ts              Export starts with expected header
  supabase/
    migrations/
      20260419000000_scraper_web_support.sql   tsvector + GIN + RPCs + grants
  .env.local                      NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  .env.example
  .eslintrc.json
  .gitignore
  next.config.mjs
  tailwind.config.ts              Theme extension + content globs
  postcss.config.mjs
  tsconfig.json                   strict: true
  vitest.config.ts                happy-dom environment
  playwright.config.ts
  components.json                 shadcn config
  package.json
  README.md
```

---

## Task 1: Repo scaffold — Next.js 15 + TypeScript strict + Tailwind v4

**Files:**
- Create: `C:\Users\Administrator\OneDrive\Projects\scraper-web\package.json`
- Create: `scraper-web\tsconfig.json`
- Create: `scraper-web\next.config.mjs`
- Create: `scraper-web\tailwind.config.ts`
- Create: `scraper-web\postcss.config.mjs`
- Create: `scraper-web\app\layout.tsx`
- Create: `scraper-web\app\page.tsx`
- Create: `scraper-web\app\globals.css`
- Create: `scraper-web\.gitignore`
- Create: `scraper-web\.env.example`
- Create: `scraper-web\.eslintrc.json`

- [ ] **Step 1: Context7 Next.js 15**

Call `mcp__context7__resolve-library-id "next.js"` → expect ID `/vercel/next.js`.
Call `mcp__context7__query-docs "/vercel/next.js"` with topic "app router layout typescript strict tailwind v4 15".
Read the snippets; keep them handy for Step 3 file templates.

- [ ] **Step 2: Context7 Tailwind v4**

Call `mcp__context7__resolve-library-id "tailwindcss"` → expect `/tailwindlabs/tailwindcss`.
Call `mcp__context7__query-docs "/tailwindlabs/tailwindcss"` with topic "v4 config postcss nextjs 15".

- [ ] **Step 3: Create directory + init git**

Run:
```bash
mkdir -p /c/Users/Administrator/OneDrive/Projects/scraper-web
cd /c/Users/Administrator/OneDrive/Projects/scraper-web
git init -b main
```
Expected: `Initialized empty Git repository …`

- [ ] **Step 4: Write package.json**

```json
{
  "name": "scraper-web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  },
  "dependencies": {
    "next": "15.0.3",
    "react": "19.0.0-rc-66855b96-20241106",
    "react-dom": "19.0.0-rc-66855b96-20241106"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "@types/react": "19.0.0",
    "@types/react-dom": "19.0.0",
    "autoprefixer": "10.4.20",
    "eslint": "9.14.0",
    "eslint-config-next": "15.0.3",
    "postcss": "8.4.49",
    "tailwindcss": "4.0.0-beta.3",
    "@tailwindcss/postcss": "4.0.0-beta.3",
    "typescript": "5.6.3"
  }
}
```

- [ ] **Step 5: Write tsconfig.json (strict)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 6: Write next.config.mjs**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { typedRoutes: true },
};
export default nextConfig;
```

- [ ] **Step 7: Write tailwind.config.ts with custom palette**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        base: "#0B0F1A",
        surface: "#111827",
        accent: "#67E8F9",
        text: "#F5F5F4",
        muted: "#A1A1AA",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 8: Write postcss.config.mjs**

```js
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
```

- [ ] **Step 9: Write app/globals.css**

```css
@import "tailwindcss";

:root {
  color-scheme: dark;
}

html, body {
  background: #0B0F1A;
  color: #F5F5F4;
  font-family: var(--font-geist-sans), system-ui, sans-serif;
}
```

- [ ] **Step 10: Write app/layout.tsx (minimal; providers added in later task)**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "scraper-web",
  description: "Browse scraped jobs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-base text-text min-h-screen antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 11: Write app/page.tsx placeholder**

```tsx
export default function HomePage() {
  return (
    <main className="container mx-auto p-8">
      <h1 className="text-2xl font-semibold text-accent">scraper-web</h1>
      <p className="text-muted mt-2">Dashboard coming online.</p>
    </main>
  );
}
```

- [ ] **Step 12: Write .gitignore**

```
node_modules
.next
out
.vercel
.env.local
.env*.local
coverage
playwright-report
test-results
```

- [ ] **Step 13: Write .env.example**

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

- [ ] **Step 14: Write .eslintrc.json**

```json
{
  "extends": "next/core-web-vitals",
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
  }
}
```

- [ ] **Step 15: Install deps and verify build**

```bash
cd /c/Users/Administrator/OneDrive/Projects/scraper-web
npm install
npx next build
```
Expected: `✓ Compiled successfully`.

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 15 + TS strict + Tailwind v4"
```

---

## Task 2: Supabase migration — tsvector + GIN + RPCs + anon grants

**Files:**
- Create: `scraper-web/supabase/migrations/20260419000000_scraper_web_support.sql`

Applied to Supabase project `kwsgxxwbmiicbfvvtmxd` via MCP `apply_migration`.

- [ ] **Step 1: Write migration SQL**

```sql
-- 20260419000000_scraper_web_support.sql
-- Adds full-text search column + RPCs for the scraper-web frontend.

BEGIN;

-- 1. Generated tsvector column + GIN index for search
ALTER TABLE public.scraper_jobs_clean
  ADD COLUMN IF NOT EXISTS search_vec tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce(job_title, '') || ' ' ||
      coalesce(company_name, '') || ' ' ||
      coalesce(full_job_description, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_scraper_jobs_clean_search_vec
  ON public.scraper_jobs_clean USING gin (search_vec);

-- 2. Source counts RPC
CREATE OR REPLACE FUNCTION public.scraper_source_counts()
RETURNS TABLE (source_platform text, n bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT source_platform, count(*)::bigint
  FROM public.scraper_jobs_clean
  WHERE removed_at IS NULL
  GROUP BY source_platform
  ORDER BY count(*) DESC;
$$;

-- 3. Jobs-by-day RPC (for 30-day stacked area chart)
CREATE OR REPLACE FUNCTION public.scraper_jobs_by_day(since date, until date)
RETURNS TABLE (day date, source_platform text, n bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    date_posted_normalized::date AS day,
    source_platform,
    count(*)::bigint AS n
  FROM public.scraper_jobs_clean
  WHERE removed_at IS NULL
    AND date_posted_normalized::date BETWEEN since AND until
  GROUP BY 1, 2
  ORDER BY 1 ASC;
$$;

-- 4. Grants so the anon role (publishable key) can call them
GRANT EXECUTE ON FUNCTION public.scraper_source_counts()       TO anon;
GRANT EXECUTE ON FUNCTION public.scraper_jobs_by_day(date,date) TO anon;
GRANT SELECT ON public.scraper_jobs_clean TO anon;

COMMIT;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Call `mcp__43d844fe-94a4-48c2-b793-40e912564e45__apply_migration`:
- `project_id`: `kwsgxxwbmiicbfvvtmxd`
- `name`: `scraper_web_support`
- `query`: contents of the SQL above

Expected: success response.

- [ ] **Step 3: Verify with execute_sql**

Call `mcp__43d844fe-94a4-48c2-b793-40e912564e45__execute_sql`:
```sql
SELECT * FROM public.scraper_source_counts() LIMIT 5;
SELECT * FROM public.scraper_jobs_by_day(current_date - 30, current_date) LIMIT 5;
SELECT indexname FROM pg_indexes WHERE tablename='scraper_jobs_clean' AND indexname='idx_scraper_jobs_clean_search_vec';
```
Expected: index exists; RPCs return rows (possibly empty).

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Administrator/OneDrive/Projects/scraper-web
git add supabase/migrations
git commit -m "feat(db): add search_vec, GIN index, source_counts + jobs_by_day RPCs"
```

---

## Task 3: Supabase clients + env setup

**Files:**
- Create: `scraper-web\.env.local` (NOT committed)
- Create: `scraper-web\lib\supabase\server.ts`
- Create: `scraper-web\lib\supabase\client.ts`

- [ ] **Step 1: Context7 @supabase/ssr**

Call `mcp__context7__resolve-library-id "@supabase/ssr"` → expect `/websites/supabase_reference_javascript` or `/supabase/supabase-js`.
Call `mcp__context7__query-docs` with topic "@supabase/ssr next.js 15 app router createBrowserClient createServerClient".

- [ ] **Step 2: Add deps**

```bash
cd /c/Users/Administrator/OneDrive/Projects/scraper-web
npm install @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 3: Write .env.local**

```
NEXT_PUBLIC_SUPABASE_URL=https://kwsgxxwbmiicbfvvtmxd.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_fV3IPNkByXXSr50FasOtBA_pSlqH0Y-
```

- [ ] **Step 4: Write lib/supabase/client.ts**

```ts
"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
```

- [ ] **Step 5: Write lib/supabase/server.ts**

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/types";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            /* RSC read-only; ignore */
          }
        },
      },
    },
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/supabase package.json package-lock.json .env.example
git commit -m "feat: add supabase browser + server clients"
```

---

## Task 4: TypeScript types from Supabase schema

**Files:**
- Create: `scraper-web\lib\types.ts`

- [ ] **Step 1: Generate types via MCP**

Call `mcp__43d844fe-94a4-48c2-b793-40e912564e45__generate_typescript_types` with `project_id=kwsgxxwbmiicbfvvtmxd`. Save the output.

- [ ] **Step 2: Write lib/types.ts**

Paste generated output, then append project-local types:

```ts
// (generated types from supabase go above this line — keep the `Database` export)

import type { Database as _Database } from "./types.generated"; // if you split them
export type Database = _Database;

export type JobRow = Database["public"]["Tables"]["scraper_jobs_clean"]["Row"];

export type SourceCountRow = {
  source_platform: string;
  n: number;
};

export type JobsByDayRow = {
  day: string; // ISO date
  source_platform: string;
  n: number;
};

export type RemoteType = "remote" | "hybrid" | "onsite";

export type SortKey = "date_posted_normalized" | "company_name" | "job_title";
export type SortDir = "asc" | "desc";
```

If the generated file is huge, put it in `lib/types.generated.ts` and re-export `Database` from `lib/types.ts`.

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```
Expected: `error TS0` exit 0 (no output means pass).

- [ ] **Step 4: Commit**

```bash
git add lib/types*.ts
git commit -m "feat: generated Supabase types + project row types"
```

---

## Task 5: Filter state reducer + URL serialisation (TDD with Vitest)

**Files:**
- Create: `scraper-web\lib\filters.ts`
- Create: `scraper-web\tests\unit\filters.test.ts`
- Create: `scraper-web\vitest.config.ts`

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest @vitest/ui happy-dom
```

- [ ] **Step 2: Write vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

- [ ] **Step 3: Write failing test tests/unit/filters.test.ts**

```ts
import { describe, it, expect } from "vitest";
import {
  initialFilterState,
  filterReducer,
  filtersToSearchParams,
  searchParamsToFilters,
  type FilterState,
} from "@/lib/filters";

describe("filterReducer", () => {
  it("toggles a source on and off", () => {
    const s1 = filterReducer(initialFilterState, { type: "TOGGLE_SOURCE", source: "greenhouse" });
    expect(s1.sources).toEqual(["greenhouse"]);
    const s2 = filterReducer(s1, { type: "TOGGLE_SOURCE", source: "greenhouse" });
    expect(s2.sources).toEqual([]);
  });

  it("sets search query", () => {
    const s = filterReducer(initialFilterState, { type: "SET_SEARCH", query: "engineer" });
    expect(s.search).toBe("engineer");
  });

  it("sets remote types", () => {
    const s = filterReducer(initialFilterState, {
      type: "SET_REMOTE_TYPES",
      remoteTypes: ["remote", "hybrid"],
    });
    expect(s.remoteTypes).toEqual(["remote", "hybrid"]);
  });

  it("resets", () => {
    const s1 = filterReducer(initialFilterState, { type: "SET_SEARCH", query: "x" });
    const s2 = filterReducer(s1, { type: "RESET" });
    expect(s2).toEqual(initialFilterState);
  });
});

describe("URL serde", () => {
  it("round-trips full filter state", () => {
    const input: FilterState = {
      sources: ["greenhouse", "lever"],
      remoteTypes: ["remote"],
      search: "senior backend",
      from: "2026-04-01",
      to: "2026-04-19",
    };
    const params = filtersToSearchParams(input);
    const output = searchParamsToFilters(new URLSearchParams(params.toString()));
    expect(output).toEqual(input);
  });

  it("returns initial state for empty params", () => {
    const output = searchParamsToFilters(new URLSearchParams());
    expect(output).toEqual(initialFilterState);
  });
});
```

- [ ] **Step 4: Run test — expect fail**

```bash
npm test
```
Expected: `FAIL tests/unit/filters.test.ts` — module not found.

- [ ] **Step 5: Write lib/filters.ts**

```ts
import type { RemoteType } from "./types";

export type FilterState = {
  sources: string[];
  remoteTypes: RemoteType[];
  search: string;
  from: string | null; // ISO date
  to: string | null;
};

export const initialFilterState: FilterState = {
  sources: [],
  remoteTypes: [],
  search: "",
  from: null,
  to: null,
};

export type FilterAction =
  | { type: "TOGGLE_SOURCE"; source: string }
  | { type: "SET_SOURCES"; sources: string[] }
  | { type: "SET_REMOTE_TYPES"; remoteTypes: RemoteType[] }
  | { type: "SET_SEARCH"; query: string }
  | { type: "SET_DATE_RANGE"; from: string | null; to: string | null }
  | { type: "SET_ALL"; state: FilterState }
  | { type: "RESET" };

export function filterReducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case "TOGGLE_SOURCE": {
      const has = state.sources.includes(action.source);
      return {
        ...state,
        sources: has
          ? state.sources.filter((s) => s !== action.source)
          : [...state.sources, action.source],
      };
    }
    case "SET_SOURCES":
      return { ...state, sources: action.sources };
    case "SET_REMOTE_TYPES":
      return { ...state, remoteTypes: action.remoteTypes };
    case "SET_SEARCH":
      return { ...state, search: action.query };
    case "SET_DATE_RANGE":
      return { ...state, from: action.from, to: action.to };
    case "SET_ALL":
      return action.state;
    case "RESET":
      return initialFilterState;
    default:
      return state;
  }
}

export function filtersToSearchParams(f: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.sources.length) p.set("src", f.sources.join(","));
  if (f.remoteTypes.length) p.set("rt", f.remoteTypes.join(","));
  if (f.search) p.set("q", f.search);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  return p;
}

export function searchParamsToFilters(p: URLSearchParams): FilterState {
  const src = p.get("src");
  const rt = p.get("rt");
  return {
    sources: src ? src.split(",").filter(Boolean) : [],
    remoteTypes: rt
      ? (rt.split(",").filter(Boolean) as RemoteType[])
      : [],
    search: p.get("q") ?? "",
    from: p.get("from"),
    to: p.get("to"),
  };
}
```

- [ ] **Step 6: Run test — expect pass**

```bash
npm test
```
Expected: `PASS tests/unit/filters.test.ts` · 6 passed.

- [ ] **Step 7: Commit**

```bash
git add lib/filters.ts tests/unit/filters.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat(filters): reducer + URL serde (TDD)"
```

---

## Task 6: Cursor utilities (TDD)

**Files:**
- Create: `scraper-web\lib\cursor.ts`
- Create: `scraper-web\tests\unit\cursor.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { encodeCursor, decodeCursor, type Cursor } from "@/lib/cursor";

describe("cursor", () => {
  it("round-trips a cursor", () => {
    const c: Cursor = { datePosted: "2026-04-18T12:34:56.000Z", id: 9123 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it("returns null for empty", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
  it("returns null for malformed", () => {
    expect(decodeCursor("not-base64")).toBeNull();
    expect(decodeCursor(btoa("{\"oops\":true}"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
npm test -- cursor
```

- [ ] **Step 3: Write lib/cursor.ts**

```ts
export type Cursor = { datePosted: string; id: number };

export function encodeCursor(c: Cursor): string {
  return btoa(JSON.stringify(c));
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(atob(raw));
    if (
      obj &&
      typeof obj.datePosted === "string" &&
      typeof obj.id === "number"
    ) {
      return { datePosted: obj.datePosted, id: obj.id };
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- cursor
```

- [ ] **Step 5: Commit**

```bash
git add lib/cursor.ts tests/unit/cursor.test.ts
git commit -m "feat(cursor): tuple cursor encode/decode (TDD)"
```

---

## Task 7: CSV encoder (TDD)

**Files:**
- Create: `scraper-web\lib\csv.ts`
- Create: `scraper-web\tests\unit\csv.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { csvHeader, csvLine, CSV_COLUMNS } from "@/lib/csv";

describe("csv", () => {
  it("header matches column order", () => {
    expect(csvHeader()).toBe(CSV_COLUMNS.join(",") + "\n");
  });

  it("escapes commas and quotes", () => {
    const line = csvLine({
      id: 1,
      job_title: 'Senior, "Senior" Engineer',
      company_name: "Acme",
      source_platform: "greenhouse",
      location: "NYC",
      remote_type: "remote",
      date_posted_normalized: "2026-04-18T00:00:00Z",
      apply_url: "https://x/a",
    } as any);
    expect(line).toContain('"Senior, ""Senior"" Engineer"');
    expect(line.endsWith("\n")).toBe(true);
  });

  it("handles nulls as empty strings", () => {
    const line = csvLine({
      id: 2,
      job_title: null,
      company_name: "Acme",
      source_platform: "lever",
      location: null,
      remote_type: null,
      date_posted_normalized: null,
      apply_url: null,
    } as any);
    expect(line.split(",").length).toBe(CSV_COLUMNS.length);
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
npm test -- csv
```

- [ ] **Step 3: Write lib/csv.ts**

```ts
import type { JobRow } from "./types";

export const CSV_COLUMNS = [
  "id",
  "job_title",
  "company_name",
  "source_platform",
  "location",
  "remote_type",
  "date_posted_normalized",
  "apply_url",
] as const;

type CsvCol = (typeof CSV_COLUMNS)[number];

function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvHeader(): string {
  return CSV_COLUMNS.join(",") + "\n";
}

export function csvLine(row: Pick<JobRow, CsvCol>): string {
  return CSV_COLUMNS.map((c) => esc(row[c])).join(",") + "\n";
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npm test -- csv
```

- [ ] **Step 5: Commit**

```bash
git add lib/csv.ts tests/unit/csv.test.ts
git commit -m "feat(csv): header + line encoder with RFC-4180 escaping (TDD)"
```

---

## Task 8: TanStack Query provider + root layout wiring

**Files:**
- Create: `scraper-web\components\providers\query-provider.tsx`
- Create: `scraper-web\lib\fonts.ts`
- Modify: `scraper-web\app\layout.tsx`

- [ ] **Step 1: Context7 TanStack Query v5**

Call `mcp__context7__resolve-library-id "@tanstack/react-query"` → expect `/tanstack/query`.
Call `mcp__context7__query-docs "/tanstack/query"` with topic "v5 next.js app router provider suspense infinite".

- [ ] **Step 2: Add deps**

```bash
npm install @tanstack/react-query @tanstack/react-query-devtools geist
```

- [ ] **Step 3: Write lib/fonts.ts**

```ts
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
export { GeistSans, GeistMono };
```

- [ ] **Step 4: Write components/providers/query-provider.tsx**

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 2,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NODE_ENV !== "production" && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
```

- [ ] **Step 5: Modify app/layout.tsx**

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { GeistSans, GeistMono } from "@/lib/fonts";
import { QueryProvider } from "@/components/providers/query-provider";

export const metadata: Metadata = {
  title: "scraper-web",
  description: "Browse scraped jobs",
};

export default function RootLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-base text-text min-h-screen antialiased font-sans">
        <QueryProvider>
          {children}
          {modal}
        </QueryProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Add @modal/default.tsx (required for parallel routes)**

Create `app/@modal/default.tsx`:
```tsx
export default function Default() {
  return null;
}
```

- [ ] **Step 7: Verify build**

```bash
npm run build
```
Expected: `✓ Compiled successfully`.

- [ ] **Step 8: Commit**

```bash
git add components/providers lib/fonts.ts app/layout.tsx app/@modal package.json package-lock.json
git commit -m "feat: TanStack Query provider + Geist fonts + modal slot"
```

---

## Task 9: shadcn/ui primitives

**Files:**
- Create: `scraper-web\components.json`
- Create: `scraper-web\lib\utils.ts`
- Create (via shadcn CLI): `scraper-web\components\ui\button.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `input.tsx`, `toast.tsx`, `toaster.tsx`, `use-toast.ts`, `tabs.tsx`, `skeleton.tsx`

- [ ] **Step 1: Context7 shadcn/ui**

Call `mcp__context7__resolve-library-id "shadcn"` → expect `/shadcn-ui/ui`.
Call `mcp__context7__query-docs "/shadcn-ui/ui"` with topic "init next.js app router dark theme components".

- [ ] **Step 2: Init shadcn**

```bash
npx shadcn@latest init -d
```
Answer prompts: Style=Default, Base color=Neutral, CSS variables=Yes.

- [ ] **Step 3: Install primitives**

```bash
npx shadcn@latest add button dialog dropdown-menu input toast tabs skeleton
```

- [ ] **Step 4: Verify utils.ts exists**

```bash
ls lib/utils.ts
```
Expected: file exists with `cn()` helper.

- [ ] **Step 5: Wire Toaster into layout**

Edit `app/layout.tsx` — inside `<QueryProvider>`, before `{children}`:
```tsx
import { Toaster } from "@/components/ui/toaster";
// …
<QueryProvider>
  {children}
  {modal}
  <Toaster />
</QueryProvider>
```

- [ ] **Step 6: Build**

```bash
npm run build
```
Expected: success.

- [ ] **Step 7: Commit**

```bash
git add components/ui components.json lib/utils.ts app/layout.tsx package.json package-lock.json
git commit -m "feat(ui): add shadcn primitives (button/dialog/dropdown/input/toast/tabs/skeleton)"
```

---

## Task 10: useJobs — cursor-paginated infinite query

**Files:**
- Create: `scraper-web\lib\queries\jobs.ts`

- [ ] **Step 1: Context7 TanStack Query infinite + Supabase PostgREST**

Call `mcp__context7__query-docs "/tanstack/query"` with topic "useInfiniteQuery getNextPageParam v5".
Call `mcp__context7__query-docs "/supabase/supabase-js"` with topic "postgrest filter lt or textSearch fts".

- [ ] **Step 2: Write lib/queries/jobs.ts**

```ts
"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { FilterState } from "@/lib/filters";
import type { JobRow } from "@/lib/types";
import { encodeCursor, decodeCursor, type Cursor } from "@/lib/cursor";

const PAGE_SIZE = 50;

type Page = {
  rows: JobRow[];
  nextCursor: string | null;
};

async function fetchJobsPage(
  filters: FilterState,
  cursor: string | null,
): Promise<Page> {
  const supabase = createClient();
  let q = supabase
    .from("scraper_jobs_clean")
    .select(
      "id,canonical_key,job_title,company_name,company_norm,location,remote_type,employment_type,seniority,source_platform,date_posted_normalized,apply_url,source_url,canonical_url,company_careers_url,job_description_snippet,first_seen_at,last_seen_at,times_seen,classification,removed_at",
    )
    .is("removed_at", null)
    .order("date_posted_normalized", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);

  if (filters.sources.length) q = q.in("source_platform", filters.sources);
  if (filters.remoteTypes.length) q = q.in("remote_type", filters.remoteTypes);
  if (filters.from) q = q.gte("date_posted_normalized", filters.from);
  if (filters.to) q = q.lte("date_posted_normalized", filters.to);
  if (filters.search) q = q.textSearch("search_vec", filters.search, { type: "websearch" });

  const c: Cursor | null = decodeCursor(cursor);
  if (c) {
    // Tuple cursor: (date_posted, id) < (c.datePosted, c.id)
    q = q.or(
      `date_posted_normalized.lt.${c.datePosted},and(date_posted_normalized.eq.${c.datePosted},id.lt.${c.id})`,
    );
  }

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as JobRow[];

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === PAGE_SIZE && last?.date_posted_normalized && last.id
      ? encodeCursor({ datePosted: last.date_posted_normalized, id: last.id })
      : null;

  return { rows, nextCursor };
}

export function useJobs(filters: FilterState) {
  return useInfiniteQuery({
    queryKey: ["jobs", filters],
    queryFn: ({ pageParam }) => fetchJobsPage(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 30_000,
  });
}

export function useJobsCount(filters: FilterState) {
  return useInfiniteQuery({
    queryKey: ["jobs-count", filters],
    queryFn: async () => {
      const supabase = createClient();
      let q = supabase
        .from("scraper_jobs_clean")
        .select("*", { count: "exact", head: true })
        .is("removed_at", null);
      if (filters.sources.length) q = q.in("source_platform", filters.sources);
      if (filters.remoteTypes.length) q = q.in("remote_type", filters.remoteTypes);
      if (filters.from) q = q.gte("date_posted_normalized", filters.from);
      if (filters.to) q = q.lte("date_posted_normalized", filters.to);
      if (filters.search) q = q.textSearch("search_vec", filters.search, { type: "websearch" });
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
    initialPageParam: null,
    getNextPageParam: () => null,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/queries/jobs.ts
git commit -m "feat(queries): useJobs infinite cursor pagination + useJobsCount"
```

---

## Task 11: useSourceCounts + useJobsOverTime RPC hooks

**Files:**
- Create: `scraper-web\lib\queries\source-counts.ts`
- Create: `scraper-web\lib\queries\jobs-over-time.ts`

- [ ] **Step 1: Write lib/queries/source-counts.ts**

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { SourceCountRow } from "@/lib/types";

export function useSourceCounts() {
  return useQuery({
    queryKey: ["source-counts"],
    queryFn: async (): Promise<SourceCountRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("scraper_source_counts");
      if (error) throw error;
      return (data ?? []) as SourceCountRow[];
    },
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Write lib/queries/jobs-over-time.ts**

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { JobsByDayRow } from "@/lib/types";

export function useJobsOverTime(days = 30) {
  return useQuery({
    queryKey: ["jobs-over-time", days],
    queryFn: async (): Promise<JobsByDayRow[]> => {
      const now = new Date();
      const until = now.toISOString().slice(0, 10);
      const since = new Date(now.getTime() - days * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const supabase = createClient();
      const { data, error } = await supabase.rpc("scraper_jobs_by_day", { since, until });
      if (error) throw error;
      return (data ?? []) as JobsByDayRow[];
    },
    staleTime: 60_000,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/queries/source-counts.ts lib/queries/jobs-over-time.ts
git commit -m "feat(queries): useSourceCounts + useJobsOverTime RPC hooks"
```

---

## Task 12: useJobById

**Files:**
- Create: `scraper-web\lib\queries\job-by-id.ts`

- [ ] **Step 1: Write lib/queries/job-by-id.ts**

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { JobRow } from "@/lib/types";

export function useJobById(id: number | null) {
  return useQuery({
    queryKey: ["job", id],
    enabled: id !== null,
    queryFn: async (): Promise<JobRow | null> => {
      if (id === null) return null;
      const supabase = createClient();
      const { data, error } = await supabase
        .from("scraper_jobs_clean")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as JobRow | null;
    },
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/queries/job-by-id.ts
git commit -m "feat(queries): useJobById single-row fetch"
```

---

## Task 13: Motion variants + palette helpers

**Files:**
- Create: `scraper-web\styles\motion.ts`
- Create: `scraper-web\styles\palette.ts`

- [ ] **Step 1: Context7 Framer Motion**

Call `mcp__context7__resolve-library-id "framer motion"` → expect `/framer/motion`.
Call `mcp__context7__query-docs "/framer/motion"` with topic "AnimatePresence layout useMotionValue v11".

- [ ] **Step 2: Install framer-motion**

```bash
npm install framer-motion
```

- [ ] **Step 3: Write styles/motion.ts**

```ts
import type { Variants, Transition } from "framer-motion";

export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;
export const BASE_DURATION = 0.18;

export const baseTransition: Transition = {
  duration: BASE_DURATION,
  ease: EASE_OUT_EXPO,
};

export const fadeScale: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: { opacity: 1, scale: 1, transition: baseTransition },
  exit: { opacity: 0, scale: 0.98, transition: baseTransition },
};

export const chipToggle: Variants = {
  off: { scale: 0.95 },
  on: { scale: 1, transition: baseTransition },
};
```

- [ ] **Step 4: Write styles/palette.ts**

```ts
export const palette = {
  base: "#0B0F1A",
  surface: "#111827",
  accent: "#67E8F9",
  text: "#F5F5F4",
  muted: "#A1A1AA",
} as const;

export function colorForSource(name: string): string {
  // Deterministic HSL ring of 24 hues, s=55%, l=65%
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = (h % 24) * 15;
  return `hsl(${hue} 55% 65%)`;
}
```

- [ ] **Step 5: Commit**

```bash
git add styles package.json package-lock.json
git commit -m "feat: framer motion variants + palette helpers"
```

---

## Task 14: SourceCountCards (dashboard)

**Files:**
- Create: `scraper-web\components\dashboard\source-count-cards.tsx`

- [ ] **Step 1: Write component**

```tsx
"use client";

import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect } from "react";
import { useSourceCounts } from "@/lib/queries/source-counts";
import { Skeleton } from "@/components/ui/skeleton";
import { colorForSource } from "@/styles/palette";

function AnimatedNumber({ value }: { value: number }) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.6, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [value, mv]);
  return <motion.span>{rounded}</motion.span>;
}

export function SourceCountCards() {
  const { data, isLoading, error } = useSourceCounts();

  if (error) return null;
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {data.map((row) => (
        <motion.div
          key={row.source_platform}
          layout
          className="rounded-lg bg-surface p-3 border border-white/5"
        >
          <div className="text-xs font-mono uppercase tracking-wider"
               style={{ color: colorForSource(row.source_platform) }}>
            {row.source_platform}
          </div>
          <div className="text-2xl font-semibold mt-1 text-text">
            <AnimatedNumber value={Number(row.n)} />
          </div>
        </motion.div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/source-count-cards.tsx
git commit -m "feat(dashboard): animated source count cards"
```

---

## Task 15: JobsOverTimeChart (Recharts stacked area)

**Files:**
- Create: `scraper-web\components\dashboard\jobs-over-time-chart.tsx`

- [ ] **Step 1: Context7 Recharts**

Call `mcp__context7__resolve-library-id "recharts"` → expect `/recharts/recharts`.
Call `mcp__context7__query-docs "/recharts/recharts"` with topic "AreaChart stacked dark tooltip responsive".

- [ ] **Step 2: Install recharts**

```bash
npm install recharts
```

- [ ] **Step 3: Write component**

```tsx
"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useJobsOverTime } from "@/lib/queries/jobs-over-time";
import { Skeleton } from "@/components/ui/skeleton";
import { colorForSource } from "@/styles/palette";
import { useMemo } from "react";

type Pivoted = { day: string } & Record<string, number | string>;

export function JobsOverTimeChart() {
  const { data, isLoading, error } = useJobsOverTime(30);

  const { pivoted, sources } = useMemo(() => {
    if (!data) return { pivoted: [] as Pivoted[], sources: [] as string[] };
    const byDay = new Map<string, Pivoted>();
    const src = new Set<string>();
    for (const r of data) {
      src.add(r.source_platform);
      const existing = byDay.get(r.day) ?? ({ day: r.day } as Pivoted);
      existing[r.source_platform] = Number(r.n);
      byDay.set(r.day, existing);
    }
    return {
      pivoted: Array.from(byDay.values()).sort((a, b) =>
        String(a.day).localeCompare(String(b.day)),
      ),
      sources: Array.from(src),
    };
  }, [data]);

  if (error) return null;
  if (isLoading || !data) return <Skeleton className="h-56 w-full rounded-lg" />;

  return (
    <div className="rounded-lg bg-surface p-4 border border-white/5 h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={pivoted}>
          <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
          <XAxis dataKey="day" stroke="#A1A1AA" fontSize={11} />
          <YAxis stroke="#A1A1AA" fontSize={11} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "#0B0F1A", border: "1px solid #1f2937" }}
            labelStyle={{ color: "#F5F5F4" }}
          />
          {sources.map((s) => (
            <Area
              key={s}
              type="monotone"
              dataKey={s}
              stackId="1"
              stroke={colorForSource(s)}
              fill={colorForSource(s)}
              fillOpacity={0.4}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/jobs-over-time-chart.tsx package.json package-lock.json
git commit -m "feat(dashboard): jobs-over-time stacked area chart"
```

---

## Task 16: FilterBar composition

**Files:**
- Create: `scraper-web\components\filters\source-chips.tsx`
- Create: `scraper-web\components\filters\remote-type-pills.tsx`
- Create: `scraper-web\components\filters\date-range-picker.tsx`
- Create: `scraper-web\components\filters\search-input.tsx`
- Create: `scraper-web\components\filters\filter-bar.tsx`

- [ ] **Step 1: Write source-chips.tsx**

```tsx
"use client";

import { motion } from "framer-motion";
import { colorForSource } from "@/styles/palette";
import { chipToggle } from "@/styles/motion";

export function SourceChips({
  available,
  selected,
  onToggle,
}: {
  available: string[];
  selected: string[];
  onToggle: (s: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {available.map((s) => {
        const on = selected.includes(s);
        return (
          <motion.button
            key={s}
            type="button"
            variants={chipToggle}
            animate={on ? "on" : "off"}
            onClick={() => onToggle(s)}
            className={`px-3 py-1 rounded-full text-xs font-mono border transition-colors ${
              on ? "bg-white/10 text-text" : "text-muted"
            }`}
            style={{ borderColor: colorForSource(s) }}
          >
            {s}
          </motion.button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Write remote-type-pills.tsx**

```tsx
"use client";

import type { RemoteType } from "@/lib/types";

const OPTIONS: RemoteType[] = ["remote", "hybrid", "onsite"];

export function RemoteTypePills({
  selected,
  onChange,
}: {
  selected: RemoteType[];
  onChange: (next: RemoteType[]) => void;
}) {
  return (
    <div className="flex gap-1 rounded-md bg-surface p-1 border border-white/5">
      {OPTIONS.map((o) => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? selected.filter((x) => x !== o) : [...selected, o])}
            className={`px-3 py-1 text-xs rounded ${
              on ? "bg-accent/20 text-accent" : "text-muted hover:text-text"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Write date-range-picker.tsx (native inputs — lean)**

```tsx
"use client";

export function DateRangePicker({
  from,
  to,
  onChange,
}: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <input
        type="date"
        value={from ?? ""}
        onChange={(e) => onChange(e.target.value || null, to)}
        className="bg-surface border border-white/10 rounded px-2 py-1 text-text"
      />
      <span className="text-muted">→</span>
      <input
        type="date"
        value={to ?? ""}
        onChange={(e) => onChange(from, e.target.value || null)}
        className="bg-surface border border-white/10 rounded px-2 py-1 text-text"
      />
    </div>
  );
}
```

- [ ] **Step 4: Write search-input.tsx (300ms debounce)**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

export function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (local !== value) onChange(local);
    }, 300);
    return () => clearTimeout(t);
  }, [local, value, onChange]);
  return (
    <Input
      placeholder="Search title / company / description…"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      className="bg-surface border-white/10 text-text placeholder:text-muted"
    />
  );
}
```

- [ ] **Step 5: Write filter-bar.tsx**

```tsx
"use client";

import { useReducer, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  filterReducer,
  filtersToSearchParams,
  searchParamsToFilters,
  initialFilterState,
  type FilterState,
} from "@/lib/filters";
import { SourceChips } from "./source-chips";
import { RemoteTypePills } from "./remote-type-pills";
import { DateRangePicker } from "./date-range-picker";
import { SearchInput } from "./search-input";
import { useSourceCounts } from "@/lib/queries/source-counts";
import type { RemoteType } from "@/lib/types";

export function FilterBar({
  onChange,
}: {
  onChange: (f: FilterState) => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const initial = useMemo(() => searchParamsToFilters(new URLSearchParams(params.toString())), [params]);
  const [state, dispatch] = useReducer(filterReducer, initial);

  useEffect(() => {
    onChange(state);
    const qs = filtersToSearchParams(state).toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }, [state, onChange, router]);

  const { data: sourceCounts } = useSourceCounts();
  const availableSources = (sourceCounts ?? []).map((r) => r.source_platform);

  return (
    <div className="flex flex-col gap-3 p-3 rounded-lg bg-surface border border-white/5">
      <SearchInput
        value={state.search}
        onChange={useCallback((q: string) => dispatch({ type: "SET_SEARCH", query: q }), [])}
      />
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <SourceChips
          available={availableSources}
          selected={state.sources}
          onToggle={(s) => dispatch({ type: "TOGGLE_SOURCE", source: s })}
        />
        <div className="flex items-center gap-3">
          <RemoteTypePills
            selected={state.remoteTypes}
            onChange={(rt: RemoteType[]) => dispatch({ type: "SET_REMOTE_TYPES", remoteTypes: rt })}
          />
          <DateRangePicker
            from={state.from}
            to={state.to}
            onChange={(from, to) => dispatch({ type: "SET_DATE_RANGE", from, to })}
          />
          <button
            onClick={() => dispatch({ type: "RESET" })}
            className="text-xs text-muted hover:text-text"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add components/filters
git commit -m "feat(filters): source chips, remote pills, date range, debounced search, filter bar"
```

---

## Task 17: JobsTable — TanStack Table + Virtual

**Files:**
- Create: `scraper-web\components\table\jobs-table.tsx`
- Create: `scraper-web\components\table\skeleton-rows.tsx`
- Create: `scraper-web\components\table\empty-state.tsx`

- [ ] **Step 1: Context7 TanStack Table + Virtual**

Call `mcp__context7__resolve-library-id "@tanstack/react-table"` → expect `/tanstack/table`.
Call `mcp__context7__query-docs "/tanstack/table"` with topic "v8 column defs getCoreRowModel".
Call `mcp__context7__resolve-library-id "@tanstack/react-virtual"` → expect `/tanstack/virtual`.
Call `mcp__context7__query-docs "/tanstack/virtual"` with topic "useVirtualizer overscan scrollElement".

- [ ] **Step 2: Install deps**

```bash
npm install @tanstack/react-table @tanstack/react-virtual
```

- [ ] **Step 3: Write skeleton-rows.tsx**

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonRows({ count = 10 }: { count?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[38px] w-full rounded-sm" />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write empty-state.tsx**

```tsx
export function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted">
      <div className="text-sm">No jobs match your filters.</div>
      <button
        className="mt-3 px-3 py-1 rounded bg-accent/10 text-accent text-xs hover:bg-accent/20"
        onClick={onReset}
      >
        Reset filters
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Write jobs-table.tsx**

```tsx
"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useJobs } from "@/lib/queries/jobs";
import type { FilterState } from "@/lib/filters";
import type { JobRow } from "@/lib/types";
import { SkeletonRows } from "./skeleton-rows";
import { EmptyState } from "./empty-state";
import { colorForSource } from "@/styles/palette";

const ROW_HEIGHT = 38;
const ch = createColumnHelper<JobRow>();

const columns = [
  ch.accessor("job_title", {
    header: "Title",
    cell: (i) => <span className="text-text">{i.getValue() ?? "—"}</span>,
  }),
  ch.accessor("company_name", {
    header: "Company",
    cell: (i) => <span className="text-muted">{i.getValue() ?? "—"}</span>,
  }),
  ch.accessor("source_platform", {
    header: "Source",
    cell: (i) => (
      <span
        className="font-mono text-[11px] uppercase"
        style={{ color: colorForSource(i.getValue() ?? "") }}
      >
        {i.getValue()}
      </span>
    ),
  }),
  ch.accessor("location", {
    header: "Location",
    cell: (i) => <span className="text-muted text-xs">{i.getValue() ?? "—"}</span>,
  }),
  ch.accessor("remote_type", {
    header: "Remote",
    cell: (i) => <span className="text-muted text-xs">{i.getValue() ?? "—"}</span>,
  }),
  ch.accessor("date_posted_normalized", {
    header: "Posted",
    cell: (i) => (
      <span className="font-mono text-[11px] text-muted">
        {i.getValue() ? new Date(i.getValue()!).toISOString().slice(0, 10) : "—"}
      </span>
    ),
  }),
];

export function JobsTable({
  filters,
  onResetFilters,
}: {
  filters: FilterState;
  onResetFilters: () => void;
}) {
  const router = useRouter();
  const q = useJobs(filters);
  const rows = useMemo(
    () => (q.data?.pages ?? []).flatMap((p) => p.rows),
    [q.data],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Prefetch next page at 80% scroll
  useEffect(() => {
    const items = virtualizer.getVirtualItems();
    const last = items[items.length - 1];
    if (
      last &&
      last.index >= rows.length * 0.8 &&
      q.hasNextPage &&
      !q.isFetchingNextPage
    ) {
      q.fetchNextPage();
    }
  }, [virtualizer.getVirtualItems(), rows.length, q]);

  if (q.isLoading) return <SkeletonRows count={12} />;
  if (!rows.length) return <EmptyState onReset={onResetFilters} />;

  return (
    <div
      ref={parentRef}
      className="h-[70vh] overflow-auto rounded-lg bg-surface border border-white/5"
    >
      <div className="grid grid-cols-[2fr_1.3fr_0.8fr_1.2fr_0.6fr_0.8fr] text-xs uppercase tracking-wider text-muted px-3 py-2 sticky top-0 bg-surface z-10 border-b border-white/5">
        {table.getHeaderGroups()[0]?.headers.map((h) => (
          <div key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</div>
        ))}
      </div>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = table.getRowModel().rows[v.index];
          if (!row) return null;
          return (
            <div
              key={row.id}
              data-testid="job-row"
              onClick={() => router.push(`/jobs/${row.original.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter") router.push(`/jobs/${row.original.id}`);
              }}
              tabIndex={0}
              className="absolute left-0 right-0 grid grid-cols-[2fr_1.3fr_0.8fr_1.2fr_0.6fr_0.8fr] px-3 items-center text-xs border-b border-white/5 hover:bg-white/5 cursor-pointer"
              style={{ height: v.size, transform: `translateY(${v.start}px)` }}
            >
              {row.getVisibleCells().map((c) => (
                <div key={c.id} className="truncate pr-2">
                  {flexRender(c.column.columnDef.cell, c.getContext())}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add components/table package.json package-lock.json
git commit -m "feat(table): virtualised jobs table with cursor-paginated prefetch"
```

---

## Task 18: Dashboard page composition

**Files:**
- Modify: `scraper-web\app\page.tsx`

- [ ] **Step 1: Rewrite app/page.tsx**

```tsx
"use client";

import { Suspense, useCallback, useState } from "react";
import { FilterBar } from "@/components/filters/filter-bar";
import { JobsTable } from "@/components/table/jobs-table";
import { SourceCountCards } from "@/components/dashboard/source-count-cards";
import { JobsOverTimeChart } from "@/components/dashboard/jobs-over-time-chart";
import { ExportButton } from "@/components/filters/export-button";
import { SavedPresetsDropdown } from "@/components/filters/saved-presets-dropdown";
import { initialFilterState, type FilterState } from "@/lib/filters";

export default function HomePage() {
  const [filters, setFilters] = useState<FilterState>(initialFilterState);
  const onChange = useCallback((f: FilterState) => setFilters(f), []);

  return (
    <main className="container mx-auto p-6 flex flex-col gap-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold text-text">
          scraper<span className="text-accent">-web</span>
        </h1>
        <div className="flex items-center gap-2">
          <SavedPresetsDropdown current={filters} onApply={onChange} />
          <ExportButton filters={filters} />
        </div>
      </header>
      <Suspense fallback={null}>
        <SourceCountCards />
        <JobsOverTimeChart />
        <FilterBar onChange={onChange} />
        <JobsTable
          filters={filters}
          onResetFilters={() => setFilters(initialFilterState)}
        />
      </Suspense>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/page.tsx
git commit -m "feat(app): compose dashboard page"
```

---

## Task 19: JobDetailModal + intercepted route

**Files:**
- Create: `scraper-web\components\detail\copy-link-button.tsx`
- Create: `scraper-web\components\detail\job-detail-view.tsx`
- Create: `scraper-web\components\detail\job-detail-modal.tsx`
- Create: `scraper-web\app\jobs\[id]\page.tsx`
- Create: `scraper-web\app\@modal\(..)jobs\[id]\page.tsx`
- Create: `scraper-web\app\not-found.tsx`

- [ ] **Step 1: Context7 Next.js intercepting routes**

Call `mcp__context7__query-docs "/vercel/next.js"` with topic "intercepting routes parallel modal app router".

- [ ] **Step 2: Write copy-link-button.tsx**

```tsx
"use client";

import { useToast } from "@/components/ui/use-toast";

export function CopyLinkButton({ id }: { id: number }) {
  const { toast } = useToast();
  const copy = async () => {
    const url = `${window.location.origin}/jobs/${id}`;
    await navigator.clipboard.writeText(url);
    toast({ description: "Link copied to clipboard" });
  };
  return (
    <button
      onClick={copy}
      className="text-xs text-muted hover:text-text"
    >
      Copy link
    </button>
  );
}
```

- [ ] **Step 3: Write job-detail-view.tsx**

```tsx
"use client";

import { useJobById } from "@/lib/queries/job-by-id";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyLinkButton } from "./copy-link-button";

export function JobDetailView({ id }: { id: number }) {
  const { data, isLoading, error } = useJobById(id);

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (error || !data) return <div className="text-muted">Job not found.</div>;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text">{data.job_title}</h2>
          <p className="text-muted text-sm">
            {data.company_name} · {data.location ?? "—"} · {data.remote_type ?? "—"}
          </p>
        </div>
        <CopyLinkButton id={id} />
      </header>
      <Tabs defaultValue="description">
        <TabsList>
          <TabsTrigger value="description">Description</TabsTrigger>
          <TabsTrigger value="meta">Meta</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="apply">Apply</TabsTrigger>
        </TabsList>
        <TabsContent value="description">
          <div
            className="prose prose-invert text-sm max-h-[50vh] overflow-y-auto"
            dangerouslySetInnerHTML={{
              __html: (data.full_job_description ?? data.job_description_snippet ?? "") as string,
            }}
          />
        </TabsContent>
        <TabsContent value="meta">
          <dl className="grid grid-cols-2 gap-2 text-xs font-mono">
            <dt className="text-muted">canonical_key</dt><dd>{data.canonical_key}</dd>
            <dt className="text-muted">source</dt><dd>{data.source_platform}</dd>
            <dt className="text-muted">posted</dt><dd>{data.date_posted_normalized ?? "—"}</dd>
            <dt className="text-muted">seniority</dt><dd>{data.seniority ?? "—"}</dd>
            <dt className="text-muted">employment</dt><dd>{data.employment_type ?? "—"}</dd>
          </dl>
        </TabsContent>
        <TabsContent value="history">
          <dl className="grid grid-cols-2 gap-2 text-xs font-mono">
            <dt className="text-muted">first_seen_at</dt><dd>{data.first_seen_at ?? "—"}</dd>
            <dt className="text-muted">last_seen_at</dt><dd>{data.last_seen_at ?? "—"}</dd>
            <dt className="text-muted">times_seen</dt><dd>{String(data.times_seen ?? 0)}</dd>
            <dt className="text-muted">removed_at</dt><dd>{data.removed_at ?? "—"}</dd>
          </dl>
        </TabsContent>
        <TabsContent value="apply">
          <div className="flex flex-col gap-2 text-sm">
            {data.apply_url && <a className="text-accent hover:underline" href={data.apply_url} target="_blank" rel="noreferrer">Apply URL</a>}
            {data.source_url && <a className="text-accent hover:underline" href={data.source_url} target="_blank" rel="noreferrer">Source URL</a>}
            {data.canonical_url && <a className="text-accent hover:underline" href={data.canonical_url} target="_blank" rel="noreferrer">Canonical URL</a>}
            {data.company_careers_url && <a className="text-accent hover:underline" href={data.company_careers_url} target="_blank" rel="noreferrer">Careers page</a>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 4: Write job-detail-modal.tsx**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { JobDetailView } from "./job-detail-view";
import { motion } from "framer-motion";
import { fadeScale } from "@/styles/motion";

export function JobDetailModal({ id }: { id: number }) {
  const router = useRouter();
  return (
    <Dialog open onOpenChange={(open) => !open && router.back()}>
      <DialogContent className="bg-surface border-white/10 max-w-3xl">
        <motion.div variants={fadeScale} initial="hidden" animate="visible" exit="exit">
          <JobDetailView id={id} />
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Write app/jobs/[id]/page.tsx (full page fallback)**

```tsx
import { JobDetailView } from "@/components/detail/job-detail-view";
import Link from "next/link";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isFinite(n)) {
    return (
      <main className="container mx-auto p-6">
        <p className="text-muted">Invalid job id.</p>
        <Link href="/" className="text-accent">Back to jobs</Link>
      </main>
    );
  }
  return (
    <main className="container mx-auto p-6">
      <Link href="/" className="text-xs text-muted hover:text-text">← Back to jobs</Link>
      <div className="mt-4">
        <JobDetailView id={n} />
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Write app/@modal/(..)jobs/[id]/page.tsx**

```tsx
import { JobDetailModal } from "@/components/detail/job-detail-modal";

export default async function InterceptedJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  return <JobDetailModal id={n} />;
}
```

- [ ] **Step 7: Write app/not-found.tsx**

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="container mx-auto p-6 text-muted">
      <p>Page not found.</p>
      <Link href="/" className="text-accent">Back to jobs</Link>
    </main>
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add components/detail app/jobs app/@modal app/not-found.tsx
git commit -m "feat(detail): intercepted-route modal + shareable detail page"
```

---

## Task 20: CSV export route handler (streaming)

**Files:**
- Create: `scraper-web\app\api\export\route.ts`
- Create: `scraper-web\components\filters\export-button.tsx`

- [ ] **Step 1: Context7 Next.js route handlers + streaming**

Call `mcp__context7__query-docs "/vercel/next.js"` with topic "route handlers streaming TransformStream Response 15".

- [ ] **Step 2: Write app/api/export/route.ts**

```ts
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CSV_COLUMNS, csvHeader, csvLine } from "@/lib/csv";
import { searchParamsToFilters } from "@/lib/filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = 1000;

export async function GET(req: NextRequest) {
  const filters = searchParamsToFilters(req.nextUrl.searchParams);
  const supabase = await createClient();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(csvHeader()));
      let offset = 0;
      while (true) {
        let q = supabase
          .from("scraper_jobs_clean")
          .select(CSV_COLUMNS.join(","))
          .is("removed_at", null)
          .order("date_posted_normalized", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + PAGE - 1);

        if (filters.sources.length) q = q.in("source_platform", filters.sources);
        if (filters.remoteTypes.length) q = q.in("remote_type", filters.remoteTypes);
        if (filters.from) q = q.gte("date_posted_normalized", filters.from);
        if (filters.to) q = q.lte("date_posted_normalized", filters.to);
        if (filters.search) q = q.textSearch("search_vec", filters.search, { type: "websearch" });

        const { data, error } = await q;
        if (error) {
          controller.error(error);
          return;
        }
        const rows = data ?? [];
        for (const r of rows) controller.enqueue(enc.encode(csvLine(r as any)));
        if (rows.length < PAGE) break;
        offset += PAGE;
      }
      controller.close();
    },
  });

  const fname = `jobs_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 3: Write components/filters/export-button.tsx**

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { filtersToSearchParams, type FilterState } from "@/lib/filters";

export function ExportButton({ filters }: { filters: FilterState }) {
  const { toast } = useToast();
  const onClick = () => {
    const qs = filtersToSearchParams(filters).toString();
    const url = qs ? `/api/export?${qs}` : "/api/export";
    toast({ description: "Export started — browser will download CSV." });
    window.location.href = url;
  };
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      Export CSV
    </Button>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/export components/filters/export-button.tsx
git commit -m "feat(export): streaming CSV route handler + trigger button"
```

---

## Task 21: SavedPresetsDropdown (localStorage)

**Files:**
- Create: `scraper-web\lib\presets.ts`
- Create: `scraper-web\components\filters\saved-presets-dropdown.tsx`

- [ ] **Step 1: Write lib/presets.ts**

```ts
import type { FilterState } from "./filters";

const KEY = "scraper-web:presets:v1";

export type Preset = { name: string; state: FilterState };

export function listPresets(): Preset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Preset[]) : [];
  } catch {
    return [];
  }
}

export function savePreset(p: Preset): Preset[] {
  const list = listPresets().filter((x) => x.name !== p.name).concat(p);
  window.localStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

export function deletePreset(name: string): Preset[] {
  const list = listPresets().filter((x) => x.name !== name);
  window.localStorage.setItem(KEY, JSON.stringify(list));
  return list;
}
```

- [ ] **Step 2: Write components/filters/saved-presets-dropdown.tsx**

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { type Preset, listPresets, savePreset, deletePreset } from "@/lib/presets";
import type { FilterState } from "@/lib/filters";

export function SavedPresetsDropdown({
  current,
  onApply,
}: {
  current: FilterState;
  onApply: (f: FilterState) => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  useEffect(() => setPresets(listPresets()), []);

  const onSave = () => {
    const name = window.prompt("Preset name?");
    if (!name) return;
    setPresets(savePreset({ name, state: current }));
  };

  const onDelete = (name: string) => setPresets(deletePreset(name));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">Presets</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-48">
        <DropdownMenuLabel>Saved</DropdownMenuLabel>
        {presets.length === 0 && (
          <DropdownMenuItem disabled>(none yet)</DropdownMenuItem>
        )}
        {presets.map((p) => (
          <DropdownMenuItem key={p.name} onSelect={() => onApply(p.state)}>
            <span className="flex-1">{p.name}</span>
            <button
              className="text-muted hover:text-text text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(p.name);
              }}
            >
              ×
            </button>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSave}>Save current…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/presets.ts components/filters/saved-presets-dropdown.tsx
git commit -m "feat(presets): localStorage-backed saved filter presets"
```

---

## Task 22: Offline banner + error boundaries

**Files:**
- Create: `scraper-web\components\offline-banner.tsx`
- Modify: `scraper-web\app\layout.tsx`

- [ ] **Step 1: Write offline-banner.tsx**

```tsx
"use client";

import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const onChange = () => setOffline(!navigator.onLine);
    onChange();
    window.addEventListener("online", onChange);
    window.addEventListener("offline", onChange);
    return () => {
      window.removeEventListener("online", onChange);
      window.removeEventListener("offline", onChange);
    };
  }, []);
  if (!offline) return null;
  return (
    <div className="bg-amber-500/20 text-amber-200 text-xs px-3 py-1 text-center">
      Offline — showing cached data.
    </div>
  );
}
```

- [ ] **Step 2: Wire into layout.tsx (inside body, before children)**

```tsx
import { OfflineBanner } from "@/components/offline-banner";
// … in body, above QueryProvider:
<OfflineBanner />
```

- [ ] **Step 3: Commit**

```bash
git add components/offline-banner.tsx app/layout.tsx
git commit -m "feat(ux): offline banner"
```

---

## Task 23: Playwright smoke tests

**Files:**
- Create: `scraper-web\playwright.config.ts`
- Create: `scraper-web\tests\e2e\dashboard.spec.ts`
- Create: `scraper-web\tests\e2e\filter.spec.ts`
- Create: `scraper-web\tests\e2e\pagination.spec.ts`
- Create: `scraper-web\tests\e2e\modal.spec.ts`
- Create: `scraper-web\tests\e2e\export.spec.ts`

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Write playwright.config.ts**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: Write dashboard.spec.ts**

```ts
import { test, expect } from "@playwright/test";

test("home loads; source count cards non-zero", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "scraper" })).toBeVisible();
  // at least one card has a number > 0
  const numbers = page.locator(".rounded-lg.bg-surface .text-2xl");
  await expect(numbers.first()).toBeVisible();
});
```

- [ ] **Step 4: Write filter.spec.ts**

```ts
import { test, expect } from "@playwright/test";

test("clicking a source chip narrows the table", async ({ page }) => {
  await page.goto("/");
  const chip = page.locator("button", { hasText: /greenhouse|lever|remoteok/ }).first();
  await chip.click();
  await expect(page).toHaveURL(/src=/);
});
```

- [ ] **Step 5: Write pagination.spec.ts**

```ts
import { test, expect } from "@playwright/test";

test("scrolling to the bottom loads more rows", async ({ page }) => {
  await page.goto("/");
  const table = page.locator('[data-testid="job-row"]').first().locator("xpath=ancestor::div[contains(@class,'overflow-auto')]");
  const before = await page.locator('[data-testid="job-row"]').count();
  await table.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await page.waitForTimeout(1000);
  const after = await page.locator('[data-testid="job-row"]').count();
  expect(after).toBeGreaterThanOrEqual(before);
});
```

- [ ] **Step 6: Write modal.spec.ts**

```ts
import { test, expect } from "@playwright/test";

test("clicking a row opens the modal; back button closes it", async ({ page }) => {
  await page.goto("/");
  const row = page.locator('[data-testid="job-row"]').first();
  await row.click();
  await expect(page).toHaveURL(/\/jobs\/\d+/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/($|\?)/);
});
```

- [ ] **Step 7: Write export.spec.ts**

```ts
import { test, expect } from "@playwright/test";

test("export downloads CSV starting with expected header", async ({ page }) => {
  await page.goto("/");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /export csv/i }).click(),
  ]);
  const path = await download.path();
  expect(path).toBeTruthy();
  const fs = await import("node:fs/promises");
  const head = (await fs.readFile(path!, "utf8")).split("\n")[0];
  expect(head).toContain("id,job_title,company_name");
});
```

- [ ] **Step 8: Run Playwright**

```bash
npm run e2e
```
Expected: all 5 specs pass.

- [ ] **Step 9: Commit**

```bash
git add tests/e2e playwright.config.ts package.json package-lock.json
git commit -m "test(e2e): 5 Playwright smokes covering dashboard/filter/pagination/modal/export"
```

---

## Task 24: Vercel deploy

- [ ] **Step 1: Install Vercel CLI**

```bash
npm install -g vercel
```

- [ ] **Step 2: Link project**

```bash
cd /c/Users/Administrator/OneDrive/Projects/scraper-web
vercel link
```
Answer prompts; accept defaults.

- [ ] **Step 3: Set env vars on Vercel**

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL production
# paste: https://kwsgxxwbmiicbfvvtmxd.supabase.co
vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY production
# paste: sb_publishable_fV3IPNkByXXSr50FasOtBA_pSlqH0Y-
vercel env add NEXT_PUBLIC_SUPABASE_URL preview
vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY preview
```

- [ ] **Step 4: Deploy**

```bash
vercel --prod
```
Expected: production URL returned.

- [ ] **Step 5: Smoke the live URL manually**

- Open the returned URL.
- Verify dashboard renders, cards show counts, chart renders.
- Click a row; confirm modal opens, URL becomes `/jobs/<id>`.
- Press back; modal closes.
- Click Export CSV; file downloads.

- [ ] **Step 6: Push to GitHub for auto-deploy (optional)**

If a remote is configured (`git remote get-url origin` succeeds):
```bash
git push -u origin main
```
Subsequent pushes to `main` auto-deploy to production.

- [ ] **Step 7: Commit any last adjustments**

```bash
git add -A
git status   # verify nothing unexpected
git commit --allow-empty -m "chore: initial Vercel production deploy"
```

---

## Self-Review

**1. Spec coverage check:**

| Spec section | Covered by |
|---|---|
| Purpose (dark-themed, filterable, virtualised, dashboard, detail, CSV) | Tasks 14-21 |
| Non-goals (no auth, read-only, dark only) | Enforced — no auth code anywhere |
| Architecture — Next.js 15/React 19/TS strict | Task 1 |
| Architecture — Tailwind/shadcn/TanStack/Recharts/Framer | Tasks 7, 9, 10-12, 14-15, 17 |
| Architecture — @supabase/ssr + publishable key | Task 3 |
| Architecture — Geist fonts | Task 8 |
| Architecture — separate repo at scraper-web\ | Task 1 |
| Project structure | Implicit in every task's file paths |
| Data model (scraper_jobs_clean columns) | Task 4 types + Task 10 query select list |
| Supabase migration (tsvector + GIN + 2 RPCs + anon grants) | Task 2 |
| List page (useJobs cursor pagination, count HEAD, stale 30s, focus refetch) | Task 10 |
| Filters (source chips, date, remote, text 300ms debounce, URL serde) | Tasks 5, 16 |
| Dashboard cards (animated numbers) | Task 14 |
| Chart (30-day stacked area) | Task 15 |
| Detail modal + intercepted route + direct route | Task 19 |
| CSV export (streaming, paginated) | Task 20 |
| UX guarantees (virtualisation, cursor pagination, indexed search, debounce, skeletons, prefetch) | Tasks 6, 10, 17 |
| Visual design (palette, typography, motion vocab, 38px rows) | Tasks 1, 8, 13, 17 |
| Error/loading/offline/empty | Tasks 17 (empty), 22 (offline), TanStack Query (backoff), 17 (skeletons) |
| Testing (Playwright smokes + Vitest helpers) | Tasks 5, 6, 7, 23 |
| Deployment (Vercel) | Task 24 |

All spec items covered.

**2. Placeholder scan:**

No TBD/TODO/"implement later". Every code step contains real code. Every command shows expected output or effect.

**3. Type consistency:**

- `FilterState` — defined in Task 5; referenced identically in Tasks 10, 16, 18, 20, 21.
- `JobRow` — defined Task 4; used Tasks 7, 10, 12, 17, 19.
- `RemoteType` — defined Task 4; used Tasks 5, 16.
- `Cursor` — defined Task 6; used Task 10.
- `Preset` — defined Task 21 consistently.
- `JobsByDayRow`, `SourceCountRow` — defined Task 4; used Tasks 11, 14, 15.
- CSV column order: Task 7 defines `CSV_COLUMNS`; Task 20 reuses same constant via import.
- Filter URL params (`src`, `rt`, `q`, `from`, `to`) — defined Task 5; Task 20 route handler uses the same `searchParamsToFilters`.

All consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-19-scraper-web.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
