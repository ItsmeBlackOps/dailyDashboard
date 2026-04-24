import { DashboardLayout } from '@/components/layout/DashboardLayout';
import ProfileHub from '@/components/profile-hub/ProfileHub';

export default function ProfileHubPage() {
  return (
    <DashboardLayout>
      <div className="p-4 md:p-6">
        <ProfileHub />
      </div>
    </DashboardLayout>
  );
}
