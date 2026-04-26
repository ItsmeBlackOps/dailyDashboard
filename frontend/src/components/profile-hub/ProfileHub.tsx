import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import OverviewTab from './OverviewTab';
import AnalyticsTab from './AnalyticsTab';
import ProfilesTab from './ProfilesTab';
import RecruitersWorkloadTab from './RecruitersWorkloadTab';
import AlertsAgingTab from './AlertsAgingTab';
import POTab from './POTab';

const MGMT_ROLES = ['admin', 'mam', 'mm', 'mlead'];

export default function ProfileHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const normalizedRole = (localStorage.getItem('role') ?? '').toLowerCase();
  const isMgmt = MGMT_ROLES.includes(normalizedRole);

  const tabs = [
    { value: 'overview',   label: 'Overview'              },
    { value: 'analytics',  label: 'Analytics'             },
    { value: 'profiles',   label: 'All Profiles'          },
    { value: 'recruiters', label: 'Recruiters & Workload' },
    { value: 'alerts',     label: 'Alerts & Aging'        },
    { value: 'po',         label: 'PO Placed'             },
  ];

  const VALID_TABS = tabs.map(t => t.value);
  const raw = searchParams.get('tab');
  const activeTab = raw && VALID_TABS.includes(raw) ? raw : 'overview';
  const setActiveTab = (tab: string, params?: Record<string, string>) =>
    setSearchParams(prev => {
      prev.set('tab', tab);
      if (params) Object.entries(params).forEach(([k, v]) => prev.set(k, v));
      return prev;
    }, { replace: true });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Profile Distribution Hub</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Vizva recruiter analytics &amp; candidate tracking</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="flex w-max gap-1 h-auto">
            {tabs.map(t => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs whitespace-nowrap">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="mt-4">
          <TabsContent value="overview" className="mt-0">
            <OverviewTab onNavigate={setActiveTab} />
          </TabsContent>
          <TabsContent value="analytics"  className="mt-0"><AnalyticsTab /></TabsContent>
          <TabsContent value="profiles"   className="mt-0"><ProfilesTab /></TabsContent>
          <TabsContent value="recruiters" className="mt-0">
            {isMgmt ? <RecruitersWorkloadTab /> : <RecruitersWorkloadTab />}
          </TabsContent>
          <TabsContent value="alerts"     className="mt-0"><AlertsAgingTab /></TabsContent>
          <TabsContent value="po"         className="mt-0"><POTab /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
