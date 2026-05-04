import { useEffect, useMemo, useState } from 'react';
import { usePostHog } from 'posthog-js/react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TopAgents } from '@/components/dashboard/TopAgents';
import { KpiOverview } from '@/components/dashboard/KpiOverview';
// import { BranchCandidates } from '@/components/dashboard/BranchCandidates';
import { DashboardFilters, type DashboardFilterState } from '@/components/dashboard/DashboardFilters';
import { computeDayRange } from '@/utils/dateRanges';

// C20 — lowercase canonical + accept new names. localStorage stores lowercase.
const CAN_USE_RECEIVED_DATE = ['admin', 'mm', 'mam', 'mlead', 'manager', 'assistantmanager', 'teamlead'];

const getStoredTab = () => {
  if (typeof window === 'undefined') return undefined;
  return localStorage.getItem('tab') ?? undefined;
};

const getStoredRole = () => {
  if (typeof window === 'undefined') return '';
  // C20 — normalize on read so case-sensitive comparators work.
  return (localStorage.getItem('role') ?? '').trim().toLowerCase();
};

const resolveInitialDateField = (role: string) => {
  const storedTab = getStoredTab();
  if (storedTab === 'receivedDateTime' && CAN_USE_RECEIVED_DATE.includes(role)) {
    return 'receivedDateTime' as const;
  }
  return 'Date of Interview' as const;
};

const Index = () => {
  const [role, setRole] = useState(() => getStoredRole());
  const allowReceivedDate = useMemo(() => CAN_USE_RECEIVED_DATE.includes(role), [role]);

  const [filters, setFilters] = useState<DashboardFilterState>(() => {
    const initialRole = getStoredRole();
    const dayRange = computeDayRange(new Date());

    return {
      range: 'day',
      dateField: resolveInitialDateField(initialRole),
      dayDate: dayRange.dayIso,
      start: dayRange.startIso,
      end: dayRange.endIso,
      upcoming: false,
    };
  });

  const posthog = usePostHog();

  useEffect(() => {
    setRole(getStoredRole());
  }, []);

  useEffect(() => {
    if (role && typeof window !== 'undefined') {
      posthog.capture('dashboard_viewed', {
        user_role: role,
        initial_tab: filters.dateField,
        is_mobile: window.innerWidth < 768,
      });
    }
  }, [role, posthog, filters.dateField]);

  useEffect(() => {
    const desiredField = resolveInitialDateField(role);
    let changed = false;
    setFilters((prev) => {
      if (prev.dateField === desiredField) return prev;
      changed = true;
      return { ...prev, dateField: desiredField };
    });
    if (changed && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('tab', desiredField);
      } catch {
        // Ignore storage failures
      }
    }
  }, [role]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">Dashboard Overview</h1>
          <p className="text-muted-foreground">Welcome back! Here's what's happening today.</p>
        </div>
        <div className="space-y-4">
          <DashboardFilters filters={filters} onChange={setFilters} allowReceivedDate={allowReceivedDate} />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <KpiOverview filters={filters} role={role} />
            <TopAgents filters={filters} role={role} />
          </div>
          {/* {role === 'MM' && <BranchCandidates role={role} />} */}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Index;
