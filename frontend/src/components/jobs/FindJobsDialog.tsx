import { useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface FindJobsDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  candidateId: string;
  candidateName?: string;
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
];

export default function FindJobsDialog({
  open,
  onOpenChange,
  candidateId,
  candidateName,
}: FindJobsDialogProps) {
  const navigate = useNavigate();
  const { authFetch } = useAuth();
  const { toast } = useToast();

  const [keyword, setKeyword] = useState('');
  const [location, setLocation] = useState('');
  const [state, setState] = useState('any');
  const [remoteType, setRemoteType] = useState<'any' | 'remote' | 'hybrid' | 'onsite'>('any');
  const [maxResults, setMaxResults] = useState(50);
  const [includeCareerSites, setIncludeCareerSites] = useState(false);

  const searchMutation = useMutation({
    mutationFn: async () => {
      const filters: Record<string, unknown> = {
        keyword: keyword.trim() || undefined,
        location: location.trim() || undefined,
        state: state !== 'any' ? state : undefined,
        remote_type: remoteType !== 'any' ? remoteType : undefined,
        max_results: maxResults,
        include_career_sites: includeCareerSites,
      };
      const res = await authFetch(`${API_URL}/api/jobs/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId, filters }),
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
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Find Jobs</DialogTitle>
          <DialogDescription>
            {candidateName
              ? `Search job listings for ${candidateName}`
              : 'Search and match job listings for this candidate'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Keyword */}
          <div className="space-y-1.5">
            <Label htmlFor="fj-keyword">Search keyword</Label>
            <Input
              id="fj-keyword"
              placeholder="e.g. Senior Java Developer"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>

          {/* Location */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fj-location">City / location</Label>
              <Input
                id="fj-location"
                placeholder="e.g. New York"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fj-state">State</Label>
              <Select value={state} onValueChange={setState}>
                <SelectTrigger id="fj-state">
                  <SelectValue placeholder="Any state" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any state</SelectItem>
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Remote type */}
          <div className="space-y-1.5">
            <Label>Work mode</Label>
            <div className="flex gap-2">
              {(['any', 'remote', 'hybrid', 'onsite'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setRemoteType(v)}
                  className={`flex-1 py-1.5 rounded-lg text-[12px] border transition-colors capitalize ${
                    remoteType === v
                      ? 'bg-aurora-violet/20 text-aurora-violet border-aurora-violet/40 font-medium'
                      : 'bg-white/[0.03] text-muted-foreground border-white/[0.08] hover:border-white/20'
                  }`}
                >
                  {v === 'any' ? 'Any' : v}
                </button>
              ))}
            </div>
          </div>

          {/* Max results */}
          <div className="space-y-1.5">
            <Label htmlFor="fj-max">Max results</Label>
            <Input
              id="fj-max"
              type="number"
              min={10}
              max={200}
              value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value))}
            />
          </div>

          {/* Include career sites */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Include career site listings</div>
              <div className="text-xs text-muted-foreground">Search beyond standard ATS boards</div>
            </div>
            <Switch
              checked={includeCareerSites}
              onCheckedChange={setIncludeCareerSites}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={searchMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => searchMutation.mutate()}
            disabled={searchMutation.isPending}
            className="bg-gradient-to-r from-aurora-violet to-aurora-cyan text-white gap-1.5"
          >
            {searchMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {searchMutation.isPending ? 'Starting search…' : 'Search Jobs'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
