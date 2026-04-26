import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AlertsTab from './AlertsTab';
import AgingTab from './AgingTab';

const MGMT_ROLES = ['admin', 'mam', 'mm', 'mlead'];

export default function AlertsAgingTab() {
  const role = (localStorage.getItem('role') || '').toLowerCase();
  const isMgmt = MGMT_ROLES.includes(role);

  if (!isMgmt) return <AlertsTab />;

  return (
    <Tabs defaultValue="alerts">
      <TabsList className="h-auto">
        <TabsTrigger value="alerts" className="text-xs">Active Alerts</TabsTrigger>
        <TabsTrigger value="aging" className="text-xs">Aging Buckets</TabsTrigger>
      </TabsList>
      <TabsContent value="alerts" className="mt-4">
        <AlertsTab />
      </TabsContent>
      <TabsContent value="aging" className="mt-4">
        <AgingTab />
      </TabsContent>
    </Tabs>
  );
}
