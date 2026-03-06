import { useState } from 'react';
import { PhoneMissed, Loader2, Phone, Mail } from 'lucide-react';
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useNotifications } from '@/context/NotificationContext';

const ALERT_ROLES = ['recruiter', 'mlead', 'mam', 'mm', 'manager', 'admin'];

export function RecruiterCallAlertDialog() {
    const { pendingCallAlerts, respondToCallAlert } = useNotifications();
    const [responseText, setResponseText] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const role = (localStorage.getItem('role') || '').toLowerCase();

    // Show alerts only for relevant roles
    if (!ALERT_ROLES.includes(role) || pendingCallAlerts.length === 0) return null;

    // Show the first pending alert (one at a time)
    const currentAlert = pendingCallAlerts[0];

    const handleSubmit = async () => {
        if (!responseText.trim() || submitting) return;
        setSubmitting(true);
        const success = await respondToCallAlert(currentAlert.id, responseText.trim());
        setSubmitting(false);
        if (success) {
            setResponseText('');
        }
    };

    return (
        <AlertDialog open>
            <AlertDialogContent
                className="sm:max-w-md"
                onPointerDownOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
            >
                <AlertDialogHeader>
                    <div className="flex items-center gap-2">
                        <PhoneMissed className="h-5 w-5 text-destructive" />
                        <AlertDialogTitle>Candidate Unreachable</AlertDialogTitle>
                    </div>
                    <AlertDialogDescription asChild>
                        <div className="space-y-2">
                            <p>
                                <strong>{currentAlert.candidateName}</strong> has been unavailable for{' '}
                                <strong>{currentAlert.attemptCount} consecutive call attempts</strong>.
                            </p>
                            {(currentAlert.candidatePhone || currentAlert.candidateEmail) && (
                                <div className="rounded-md border bg-muted/50 px-3 py-2 space-y-1 text-sm">
                                    {currentAlert.candidatePhone && (
                                        <div className="flex items-center gap-2">
                                            <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                            <span>{currentAlert.candidatePhone}</span>
                                        </div>
                                    )}
                                    {currentAlert.candidateEmail && (
                                        <div className="flex items-center gap-2">
                                            <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                            <span>{currentAlert.candidateEmail}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                            <p>
                                Please provide your response before continuing. This will be logged in the activity tab.
                            </p>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="flex flex-col gap-3 mt-2">
                    <Textarea
                        value={responseText}
                        onChange={(e) => setResponseText(e.target.value)}
                        placeholder="Enter your response (required)..."
                        className="min-h-[80px] resize-none text-sm"
                        autoFocus
                    />
                    {pendingCallAlerts.length > 1 && (
                        <p className="text-xs text-muted-foreground">
                            {pendingCallAlerts.length - 1} more alert{pendingCallAlerts.length - 1 > 1 ? 's' : ''} pending
                        </p>
                    )}
                    <Button
                        onClick={handleSubmit}
                        disabled={!responseText.trim() || submitting}
                        className="w-full"
                    >
                        {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Submit Response
                    </Button>
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
}
