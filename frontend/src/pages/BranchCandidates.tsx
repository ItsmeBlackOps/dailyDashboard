import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { BranchCandidates as BranchCandidatesCard } from '@/components/dashboard/BranchCandidates';

const BranchCandidatesPage = () => {
  const [role, setRole] = useState('');
  const normalizedRole = role.trim().toLowerCase();
  const canView = ['admin','mm', 'mam', 'mlead', 'lead', 'user', 'am', 'manager', 'recruiter'].includes(normalizedRole);
  useEffect(() => {
    setRole(localStorage.getItem('role') || '');
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {canView ? (
          <BranchCandidatesCard role={role} />
        ) : (
          <p className="text-sm text-muted-foreground">
            This view is restricted to managers, branch leadership roles, recruiters, and assigned team members.
          </p>
        )}
      </div>
    </DashboardLayout>
  );
};

export default BranchCandidatesPage;
