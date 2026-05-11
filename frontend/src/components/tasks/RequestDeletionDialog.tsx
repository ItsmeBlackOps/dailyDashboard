import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Send } from 'lucide-react';

interface RequestDeletionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    task: {
        _id: string;
        'Candidate Name'?: string;
        subject?: string;
    } | null;
    onConfirm: (taskId: string, reason: string) => Promise<void>;
}

export const RequestDeletionDialog: React.FC<RequestDeletionDialogProps> = ({
    open,
    onOpenChange,
    task,
    onConfirm,
}) => {
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);

    // Reset form whenever the dialog re-opens for a fresh task.
    useEffect(() => {
        if (open) setReason('');
    }, [open, task?._id]);

    const candidateName = task?.['Candidate Name'] || 'Unknown Candidate';

    const handleSubmit = async () => {
        if (!task || !reason.trim()) return;
        setLoading(true);
        try {
            await onConfirm(task._id, reason.trim());
            onOpenChange(false);
            setReason('');
        } catch (error) {
            console.error('Request deletion failed', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-amber-600" />
                        Request Task Deletion
                    </DialogTitle>
                    <DialogDescription>
                        Submit a deletion request for the task assigned to
                        <span className="font-semibold text-foreground"> {candidateName}</span>.
                        An admin will review your reason and either approve (which deletes the
                        original email from the mailbox so you can resubmit) or reject it.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-2 py-2">
                    <Label htmlFor="deletion-reason">
                        Reason <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                        id="deletion-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why does this task need to be deleted? (e.g. wrong slot, duplicate, candidate cancelled)"
                        className="min-h-[100px] resize-none text-sm"
                        autoFocus
                    />
                </div>

                <DialogFooter className="sm:justify-between items-center">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        disabled={loading}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!reason.trim() || loading}
                    >
                        {loading ? 'Sending…' : (
                            <>
                                <Send className="mr-2 h-4 w-4" />
                                Submit Request
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
