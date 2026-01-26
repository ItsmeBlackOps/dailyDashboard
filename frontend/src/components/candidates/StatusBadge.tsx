import React, { useState } from 'react';
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
    status: string;
    candidateId: string;
    canEdit: boolean;
    onUpdate: (id: string, newStatus: string) => Promise<void>;
}

const STATUS_OPTIONS = [
    'Active',
    'Hold',
    'Low Priority',
    'Backout',
    'Placement Offer'
];

export function StatusBadge({ status, candidateId, canEdit, onUpdate }: StatusBadgeProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const currentStatus = status || 'Active'; // Default

    const getColor = (s: string) => {
        switch (s) {
            case 'Active': return 'bg-green-500 hover:bg-green-600';
            case 'Hold': return 'bg-orange-500 hover:bg-orange-600';
            case 'Low Priority': return 'bg-gray-500 hover:bg-gray-600';
            case 'Backout': return 'bg-red-500 hover:bg-red-600';
            case 'Placement Offer': return 'bg-indigo-500 hover:bg-indigo-600';
            default: return 'bg-slate-500';
        }
    };

    const handleValueChange = async (val: string) => {
        if (val === currentStatus) return;
        setLoading(true);
        try {
            await onUpdate(candidateId, val);
            setIsOpen(false);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const badge = (
        <Badge
            className={cn(
                "text-white whitespace-nowrap transition-colors",
                getColor(currentStatus),
                canEdit ? "cursor-pointer" : "cursor-default"
            )}
        >
            {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            {currentStatus}
        </Badge>
    );

    if (!canEdit) {
        return badge;
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                {badge}
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2">
                <div className="space-y-2">
                    <h4 className="font-medium leading-none text-sm text-muted-foreground mb-2">Update Status</h4>
                    <Select onValueChange={handleValueChange} disabled={loading} value={currentStatus}>
                        <SelectTrigger className="w-full h-8">
                            <SelectValue placeholder="Select Status" />
                        </SelectTrigger>
                        <SelectContent>
                            {STATUS_OPTIONS.map(opt => (
                                <SelectItem key={opt} value={opt}>
                                    {opt}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </PopoverContent>
        </Popover>
    );
}
