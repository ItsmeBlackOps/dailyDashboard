import { PhoneMissed } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useNotifications } from '@/context/NotificationContext';

const ALERT_ROLES = ['recruiter', 'mlead', 'mam', 'mm', 'manager', 'admin'];

export function RecruiterCallAlertDialog() {
    const { callAlert, clearCallAlert } = useNotifications();
    const navigate = useNavigate();
    const role = (localStorage.getItem('role') || '').toLowerCase();

    if (!callAlert || !ALERT_ROLES.includes(role)) return null;

    return (
        <AlertDialog open onOpenChange={(open) => { if (!open) clearCallAlert(); }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <div className="flex items-center gap-2">
                        <PhoneMissed className="h-5 w-5 text-destructive" />
                        <AlertDialogTitle>Candidate Unreachable</AlertDialogTitle>
                    </div>
                    <AlertDialogDescription>
                        <strong>{callAlert.candidateName}</strong> has been unavailable for{' '}
                        <strong>{callAlert.attemptCount} consecutive call attempts</strong>.
                        Please follow up with the candidate or update the discussion.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={clearCallAlert}>Acknowledge</AlertDialogCancel>
                    <AlertDialogAction onClick={() => {
                        navigate(`/resume-understanding?discussionCandidateId=${callAlert.candidateId}`);
                        clearCallAlert();
                    }}>
                        View Discussion
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
