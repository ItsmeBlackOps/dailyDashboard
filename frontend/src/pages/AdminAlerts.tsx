import { useState } from "react";
import { CheckCircle2, FileText, ShieldX } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdminAwaitingExpert } from "@/components/candidates/AdminAwaitingExpert";
import { TranscriptApprovalQueue } from "@/components/admin/TranscriptApprovalQueue";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const AdminAlertsPage = () => {
  const [role] = useState(() => localStorage.getItem("role") || "");
  const normalizedRole = role.trim().toLowerCase();
  const isAdmin = normalizedRole === "admin";
  const navigate = useNavigate();

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
        <Card className="max-w-md mx-auto mt-16">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <ShieldX className="h-12 w-12 text-muted-foreground" />
            <div>
              <p className="font-semibold text-lg">Admin Access Required</p>
              <p className="text-sm text-muted-foreground mt-1">
                This page is restricted to administrator accounts.
              </p>
            </div>
            <Button onClick={() => navigate("/")}>Go to Dashboard</Button>
          </CardContent>
        </Card>
      )}
    </DashboardLayout>
  );
};

export default AdminAlertsPage;
