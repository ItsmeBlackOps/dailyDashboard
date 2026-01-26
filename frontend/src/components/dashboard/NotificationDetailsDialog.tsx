
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';

interface BatchItem {
    id: string;
    name: string;
    status?: string;
    expert?: string;
}

interface NotificationDetailsDialogProps {
    isOpen: boolean;
    onClose: () => void;
    notification: any; // Using any to avoid complex type drift, but ideally NotificationEvent
}

export function NotificationDetailsDialog({
    isOpen,
    onClose,
    notification,
}: NotificationDetailsDialogProps) {
    if (!notification || !notification.batchData) return null;

    const items = notification.batchData as BatchItem[];

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{notification.title}</DialogTitle>
                    <DialogDescription>{notification.description}</DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-auto mt-4 border rounded-md">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Candidate</TableHead>
                                {items[0]?.status && <TableHead>Status</TableHead>}
                                {items[0]?.expert && <TableHead>Expert</TableHead>}
                                <TableHead className="text-right">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.map((item) => (
                                <TableRow key={item.id}>
                                    <TableCell className="font-medium">{item.name}</TableCell>
                                    {item.status && (
                                        <TableCell>
                                            <Badge variant="outline">{item.status}</Badge>
                                        </TableCell>
                                    )}
                                    {item.expert && <TableCell>{item.expert}</TableCell>}
                                    <TableCell className="text-right">
                                        <Link
                                            to={`/candidate/${item.id}`}
                                            className="inline-flex items-center text-primary hover:underline"
                                            onClick={onClose}
                                        >
                                            View
                                            <ExternalLink className="ml-1 h-3 w-3" />
                                        </Link>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                <div className="flex justify-end mt-4">
                    <Button onClick={onClose}>Close</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
