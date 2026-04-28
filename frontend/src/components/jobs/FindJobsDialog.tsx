import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface FindJobsDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  candidateId: string;
  candidateName?: string;
}

export default function FindJobsDialog({
  open,
  onOpenChange,
  candidateId,
  candidateName,
}: FindJobsDialogProps) {
  const navigate = useNavigate();
  const { authFetch } = useAuth();
  const { toast } = useToast();

  const searchMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`${API_URL}/api/jobs/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId, filters: {} }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Search failed' }));
        throw new Error(err.error || 'Search failed');
      }
      return res.json() as Promise<{ success: boolean; sessionId: string }>;
    },
    onSuccess: (data) => {
      toast({
        title: 'Searching jobs…',
        description: "You'll get a notification when results are ready.",
      });
      onOpenChange(false);
      navigate(`/jobs/${data.sessionId}`);
    },
    onError: (err: Error) => {
      toast({ title: 'Search failed', description: err.message, variant: 'destructive' });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>
            Find Jobs{candidateName ? ` for ${candidateName}` : ''}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground space-y-2 pt-1">
              <p>
                We'll automatically scan{' '}
                <span className="font-medium text-foreground">
                  {candidateName ?? 'this candidate'}
                </span>
                's resume to derive matching job titles, years of experience,
                and skill fingerprint.
              </p>
              <p>
                Then we'll search <span className="font-medium text-foreground">LinkedIn</span> for
                the top&nbsp;<span className="font-medium text-foreground">100 remote matches</span>{' '}
                per title and merge the results into one deduplicated list.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="pt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={searchMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => searchMutation.mutate()}
            disabled={searchMutation.isPending}
            className="flex-1 bg-gradient-to-r from-aurora-violet to-aurora-cyan text-white gap-1.5"
          >
            {searchMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {searchMutation.isPending ? 'Starting search…' : 'Start Job Search'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
