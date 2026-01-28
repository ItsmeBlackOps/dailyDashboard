import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUserProfile } from '@/contexts/UserProfileContext';

const STORAGE_KEY = 'last_seen_changelog_id';

export function ChangelogDialog() {
    const { profile } = useUserProfile();
    const userRole = profile?.role;
    const [open, setOpen] = useState(false);
    const [update, setUpdate] = useState<ChangelogUpdate | null>(null);

    useEffect(() => {
        if (!userRole) return;

        // Find the latest update relevant to this user
        // We assume CHANGELOG is ordered (latest first? or we sort it).
        // Let's rely on the config being well-maintained or sort it here.
        // Sorting by ID implies semantic versioning or date. Let's just take the first match that is "new".

        // Check local storage for last seen ID
        const lastSeenId = localStorage.getItem(STORAGE_KEY);
        const normalizedRole = userRole.trim().toLowerCase();

        // Strategy: Identify the *latest* update index in the array.
        // If the latest update > lastSeenId (lexicographically or just different if we assume monotonic), show it.
        // Simple approach: Show the *first* (latest) update in the list that the user hasn't seen.
        // We assume CHANGELOG[0] is the newest.

        const latestUpdate = CHANGELOG.find(u => {
            // Check role visibility
            if (u.roles && !u.roles.includes(normalizedRole)) {
                return false;
            }
            return true;
        });

        if (!latestUpdate) return;

        // If we have a latest update, check if it's new
        if (latestUpdate.id !== lastSeenId) {
            setUpdate(latestUpdate);
            setOpen(true);
        }
    }, [userRole]);

    const handleClose = () => {
        if (update) {
            localStorage.setItem(STORAGE_KEY, update.id);
        }
        setOpen(false);
    };

    if (!update) return null;

    return (
        <Dialog open={open} onOpenChange={(val) => !val && handleClose()}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 bg-primary/10 rounded-full text-primary">
                            <Sparkles className="w-5 h-5" />
                        </div>
                        <DialogTitle className="text-xl">New Updates Available</DialogTitle>
                    </div>
                    <DialogDescription>
                        Here is what's new in version <span className="font-semibold text-foreground">{update.id}</span>
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="max-h-[60vh] pr-4">
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold">{update.title}</h3>
                        {/* Simple styling for markdown content */}
                        <div className="prose prose-sm dark:prose-invert text-muted-foreground">
                            {/* Note: ReactMarkdown requires installation. If not available, we trigger fallback logic or just render text with newlines.
                 To stay safe without adding deps, I'll allow simple rendering or assume react-markdown is widespread.
                 Actually, checking imports... BranchCandidates uses it? No.
                 Let's check package.json from previous steps. marked is there? "marked": "^16.4.0".
                 Ah, marked is in backend. Frontend? I don't recall seeing react-markdown.
                 Let's stick to safe whitespace rendering for now unless I verify frontent package.json.
                 I'll render logic to handle simple newlines. 
             */}
                            <div className="whitespace-pre-wrap">{update.content}</div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-4">
                            Released on {new Date(update.date).toLocaleDateString()}
                        </div>
                    </div>
                </ScrollArea>

                <DialogFooter>
                    <Button onClick={handleClose} className="w-full sm:w-auto">
                        Got it, thanks!
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
