import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePostHog } from 'posthog-js/react';
import { PERMISSIONS } from '@/config/permissions';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TopAgents } from '@/components/dashboard/TopAgents';
import { KpiOverview } from '@/components/dashboard/KpiOverview';
// import { BranchCandidates } from '@/components/dashboard/BranchCandidates';
import { DashboardFilters, type DashboardFilterState } from '@/components/dashboard/DashboardFilters';
import { computeDayRange } from '@/utils/dateRanges';



const getStoredTab = () => {
  if (typeof window === 'undefined') return undefined;
  return localStorage.getItem('tab') ?? undefined;
};

const resolveInitialDateField = (allowReceivedDate: boolean) => {
  const storedTab = getStoredTab();
  if (storedTab === 'receivedDateTime' && allowReceivedDate) {
    return 'receivedDateTime' as const;
  }
  return 'Date of Interview' as const;
};

const Index = () => {
  const { user, hasPermission } = useAuth();
  const role = user.role || '';
  const allowReceivedDate = hasPermission(PERMISSIONS.USE_RECEIVED_DATE_FILTER);

  const [filters, setFilters] = useState<DashboardFilterState>(() => {
    // Initial State might not have permissions loaded immediately if user just logged in?
    // But page reload re-fetches permissions from localStorage in useAuth.
    // So hasPermission should work.
    // However, during FIRST RENDER, useAuth effect might not have populated if async?
    // useAuth reads from localStorage SYNCHRONOUSLY. So it is fine.

    // permissions check inside initial state
    const allow = hasPermission(PERMISSIONS.USE_RECEIVED_DATE_FILTER);
    // Wait, hasPermission depends on user.permissions.

    const dayRange = computeDayRange(new Date());

    return {
      range: 'day',
      dateField: resolveInitialDateField(allow),
      dayDate: dayRange.dayIso,
      start: dayRange.startIso,
      end: dayRange.endIso,
      upcoming: false,
    };
  });

  const posthog = usePostHog();

  // Role effect removed as we depend on user.role from useAuth, which is stable or updates.

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
    const desiredField = resolveInitialDateField(allowReceivedDate);
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
  }, [allowReceivedDate]);

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
          {/* BranchCandidates handles its own permissions now */}
          {/* <BranchCandidates /> */}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Index;
