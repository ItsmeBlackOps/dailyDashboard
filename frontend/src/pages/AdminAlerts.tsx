import { useEffect, useState } from "react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdminAwaitingExpert } from "@/components/candidates/AdminAwaitingExpert";

const AdminAlertsPage = () => {
  const [role, setRole] = useState("");
  const normalizedRole = role.trim().toLowerCase();
  const isAdmin = normalizedRole === "admin";

  useEffect(() => {
    setRole(localStorage.getItem("role") || "");
  }, []);

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
