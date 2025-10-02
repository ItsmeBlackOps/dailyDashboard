import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TopAgents } from '@/components/dashboard/TopAgents';
import { KpiOverview } from '@/components/dashboard/KpiOverview';
// import { BranchCandidates } from '@/components/dashboard/BranchCandidates';
import { DashboardFilters, type DashboardFilterState } from '@/components/dashboard/DashboardFilters';
import { computeDayRange } from '@/utils/dateRanges';

const CAN_USE_RECEIVED_DATE = ['admin', 'MM', 'MAM', 'mlead'];

const getStoredTab = () => {
  if (typeof window === 'undefined') return undefined;
  return localStorage.getItem('tab') ?? undefined;
};

const getStoredRole = () => {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('role') ?? '';
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

  useEffect(() => {
    setRole(getStoredRole());
  }, []);

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
          <p className="text-muted-foreground">Welcome back! Here's what's happening with your sales today.</p>
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
