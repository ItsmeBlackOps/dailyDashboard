import { useEffect, useState } from "react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdminAwaitingExpert } from "@/components/candidates/AdminAwaitingExpert";

import { useAuth } from "@/hooks/useAuth";
import { PERMISSIONS } from "@/config/permissions";

const AdminAlertsPage = () => {
  const { user, hasPermission } = useAuth();
  const role = user.role || '';
  const isAdmin = hasPermission(PERMISSIONS.VIEW_ADMIN_ALERTS);

  return (
    <DashboardLayout>
      {isAdmin ? (
        <AdminAwaitingExpert role={role} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Admin access required. Please sign in with an administrator account.
        </p>
      )}
    </DashboardLayout>
  );
};

export default AdminAlertsPage;
