import React, { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Trash2 } from 'lucide-react';

interface DeleteTaskDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    task: {
        _id: string;
        "Candidate Name"?: string;
        subject?: string;
    } | null;
    onConfirm: (taskId: string) => Promise<void>;
}

export const DeleteTaskDialog: React.FC<DeleteTaskDialogProps> = ({
    open,
    onOpenChange,
    task,
    onConfirm,
}) => {
    const [confirmationName, setConfirmationName] = useState('');
    const [loading, setLoading] = useState(false);

    const candidateName = task?.['Candidate Name'] || 'Unknown Candidate';

    const handleDelete = async () => {
        if (!task) return;
        setLoading(true);
        try {
            await onConfirm(task._id);
            onOpenChange(false);
        } catch (error) {
            console.error("Delete failed", error);
        } finally {
            setLoading(false);
            setConfirmationName('');
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-red-600 flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5" />
                        Delete Task
                    </DialogTitle>
                    <DialogDescription>
                        This action cannot be undone. This will permanently delete the task for
                        <span className="font-semibold text-foreground"> {candidateName} </span>
                        from the database.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-4">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="confirm-name">
                            Type <span className="font-mono font-bold">{candidateName}</span> to confirm:
                        </Label>
                        <Input
                            id="confirm-name"
                            value={confirmationName}
                            onChange={(e) => setConfirmationName(e.target.value)}
                            placeholder={candidateName}
                            className="border-red-200 focus-visible:ring-red-500"
                        />
                    </div>
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
                        variant="destructive"
                        onClick={handleDelete}
                        disabled={confirmationName !== candidateName || loading}
                    >
                        {loading ? 'Deleting...' : (
                            <>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete Task
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
