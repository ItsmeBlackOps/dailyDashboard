import { useEffect, useState } from "react";
import { CheckCircle2, FileText } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdminAwaitingExpert } from "@/components/candidates/AdminAwaitingExpert";
import { TranscriptApprovalQueue } from "@/components/admin/TranscriptApprovalQueue";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Admin Approval</h1>
            <p className="text-sm text-muted-foreground">
              Review and action candidate assignment and transcript access approvals.
            </p>
          </div>
          <Tabs defaultValue="candidate-assignment" className="space-y-4">
            <TabsList className="grid w-full max-w-[540px] grid-cols-2">
              <TabsTrigger value="candidate-assignment" className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Candidate Assignment
              </TabsTrigger>
              <TabsTrigger value="transcript-approval" className="gap-2">
                <FileText className="h-4 w-4" />
                Transcript Approval
              </TabsTrigger>
            </TabsList>
            <TabsContent value="candidate-assignment" className="space-y-4">
              <AdminAwaitingExpert role={role} />
            </TabsContent>
            <TabsContent value="transcript-approval" className="space-y-4">
              <TranscriptApprovalQueue />
            </TabsContent>
          </Tabs>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Admin access required. Please sign in with an administrator account.
        </p>
      )}
    </DashboardLayout>
  );
};

export default AdminAlertsPage;
