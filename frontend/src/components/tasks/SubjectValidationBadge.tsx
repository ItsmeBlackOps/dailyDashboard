import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import moment from 'moment-timezone';

interface Task {
    subject?: string;
    "Candidate Name"?: string;
    "Technology"?: string;
    "Date of Interview"?: string;
    "Start Time Of Interview"?: string;
    status?: string;
    assignedExpert?: string;
    [key: string]: any;
}

interface ValidationResult {
    isValid: boolean;
    errors: string[];
}

const ALLOWED_ROUNDS = [
    "1st Round", "2nd Round", "3rd Round", "4th Round", "Screening",
    "On Demand or AI Interview", "5th Round", "Technical Round",
    "Coding Round", "Final Round", "Loop Round"
];

// Normalize round helper similar to backend
const normalizeRoundValue = (roundValue: any) => {
    const raw = (roundValue ?? '').toString().replace(/\u00A0/g, ' ').trim();
    if (!raw) return 'Unknown';
    return raw.replace(/\s+/g, ' ');
};

export const SubjectValidationBadge: React.FC<{ task: Task }> = ({ task }) => {
    const validationResult = useMemo((): ValidationResult => {
        const errors: string[] = [];

        // 1. Missing Fields Check
        const candidateName = task["Candidate Name"]?.trim();
        const technology = task["Technology"]?.trim();
        const dateOfInterview = task["Date of Interview"]?.trim();
        const startTime = task["Start Time Of Interview"]?.trim();

        if (!candidateName) errors.push("Missing 'Candidate Name'");
        if (!technology) errors.push("Missing 'Technology'");
        if (!dateOfInterview) errors.push("Missing 'Date of Interview'");
        if (!startTime) errors.push("Missing 'Start Time Of Interview'");

        // 2. Round Check
        // We check against 'actualRound' if available, or 'Interview Round' key
        const actualRound = task["actualRound"] || task["Interview Round"];
        const normalizedRound = normalizeRoundValue(actualRound);

        // Only check round validitiy if we have a round value
        if (actualRound && !ALLOWED_ROUNDS.includes(normalizedRound)) {
            // Only flag if it doesn't match EXACTLY one of the allowed strings
            // The user request said: "Verifies currentRound is in the ALLOWED_ROUNDS list"
            errors.push(`Invalid Round: '${normalizedRound}'`);
        }

        // 3. Formula Check
        // Formula: Interview Support - ${Candidate Name} - ${Technology} - ${FormattedDate} at ${StartTime} EST
        if (candidateName && technology && dateOfInterview && startTime) {
            // Parse Date: 01/26/2026 -> Jan 26, 2026
            // Input format expectation is MM/DD/YYYY based on typical task data
            const dateMoment = moment(dateOfInterview, ['MM/DD/YYYY', 'YYYY-MM-DD'], true);

            if (!dateMoment.isValid()) {
                errors.push("Invalid 'Date of Interview' format (Expected MM/DD/YYYY)");
            } else {
                const formattedDate = dateMoment.format('MMM D, YYYY'); // Feb 4, 2026
                // Note: The user example is "Jan 26, 2026". Moment 'MMM DD, YYYY' produces "Jan 26, 2026".

                // Construct Expected Subject
                const expectedSubject = `Interview Support - ${candidateName} - ${technology} - ${formattedDate} at ${startTime} EST`;

                const actualSubject = (task.subject || '').trim();

                if (actualSubject !== expectedSubject) {
                    errors.push(`Subject Mismatch.`);
                    errors.push(`Expected: ${expectedSubject}`);
                }
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }, [task]);

    if (validationResult.isValid) {
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="inline-flex items-center justify-center ml-2 bg-white rounded-full p-0.5 shadow-sm border border-green-200 cursor-help transition-transform hover:scale-110">
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                        </span>
                    </TooltipTrigger>
                    <TooltipContent className="bg-green-50 text-green-700 border-green-200">
                        <p className="font-medium">Subject Format Valid</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="inline-flex items-center justify-center ml-2 bg-white rounded-full p-0.5 shadow-sm border border-red-200 cursor-help transition-transform hover:scale-110">
                        <AlertCircle className="h-4 w-4 text-red-600" />
                    </span>
                </TooltipTrigger>
                <TooltipContent className="bg-destructive text-destructive-foreground border-destructive/50 max-w-sm shadow-md">
                    <p className="font-semibold mb-1 border-b border-white/20 pb-1">Validation Errors</p>
                    <ul className="list-disc pl-4 space-y-1">
                        {validationResult.errors.map((err, i) => (
                            <li key={i} className="text-xs break-words">{err}</li>
                        ))}
                    </ul>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};
