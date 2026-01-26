
import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@/context/NotificationContext';
import { ArrowRight, User } from 'lucide-react';

export function NotificationDetailModal() {
    const { selectedNotification, isModalOpen, closeModal } = useNotifications();
    const navigate = useNavigate();

    if (!selectedNotification) return null;

    const { title, description, changeDetails, actor, batchData, type, candidateId, timestamp } = selectedNotification;

    const handleAction = () => {
        if (candidateId) {
            navigate(`/candidate/${candidateId}`);
        }
        closeModal();
    };

    const isBulk = type === 'batch' && (batchData?.length || 0) > 0;

    return (
        <Dialog open={isModalOpen} onOpenChange={(open) => !open && closeModal()}>
            <DialogContent className="sm:max-w-md md:max-w-lg lg:max-w-xl">
                <DialogHeader>
                    <div className="flex items-center gap-2">
                        <DialogTitle>{title}</DialogTitle>
                        <Badge variant={type === 'batch' ? 'secondary' : 'outline'}>{type}</Badge>
                    </div>
                    <DialogDescription className="pt-2">
                        {description}
                    </DialogDescription>
                </DialogHeader>

                {/* Actor Info */}
                {actor && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 p-2 rounded-md">
                        <User className="w-4 h-4" />
                        <span>Updated by <span className="font-medium text-foreground">{actor.name}</span> ({actor.role})</span>
                    </div>
                )}

                {/* Single Update Details */}
                {changeDetails && !isBulk && (
                    <div className="py-4 space-y-4">
                        <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-center text-sm">
                            <div className="p-3 bg-red-50 dark:bg-red-950/20 rounded-md border border-red-100 dark:border-red-900/50">
                                <div className="text-xs text-muted-foreground uppercase mb-1">Old Value</div>
                                <div className="font-medium">{String(changeDetails.oldValue?.status || changeDetails.oldValue || 'N/A')}</div>
                            </div>
                            <ArrowRight className="w-4 h-4 text-muted-foreground" />
                            <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-md border border-green-100 dark:border-green-900/50">
                                <div className="text-xs text-muted-foreground uppercase mb-1">New Value</div>
                                <div className="font-medium">{String(changeDetails.newValue?.status || changeDetails.newValue || 'N/A')}</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Bulk Update Details */}
                {isBulk && batchData && (
                    <div className="py-2">
                        <h4 className="text-sm font-medium mb-2">Affected Candidates ({batchData.length})</h4>
                        <ScrollArea className="h-[200px] w-full border rounded-md p-2">
                            <div className="space-y-1">
                                {batchData.map((item: any, idx: number) => (
                                    <div key={idx} className="flex justify-between items-center p-2 hover:bg-muted/50 rounded-sm text-sm">
                                        <span className="font-medium">{item.name || item.candidateName}</span>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            {item.oldValue && (
                                                <>
                                                    <span>{item.oldValue}</span>
                                                    <ArrowRight className="w-3 h-3" />
                                                </>
                                            )}
                                            <Badge variant="outline" className="text-xs h-5">{item.status || item.newValue}</Badge>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>
                )}

                <div className="text-xs text-muted-foreground text-right pt-2 border-t">
                    {new Date(timestamp).toLocaleString()}
                </div>

                <DialogFooter className="sm:justify-end gap-2">
                    <Button variant="secondary" onClick={closeModal}>
                        Close
                    </Button>
                    {!isBulk && candidateId && (
                        <Button onClick={handleAction}>
                            View Candidate
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
