import { useState } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useAuth, API_URL } from '@/hooks/useAuth';
import type { TaskSheetPrefill } from './TaskSheet';

interface PODraftSheetProps {
  open: boolean;
  onClose: () => void;
  prefill: TaskSheetPrefill | null;
}

interface POCount {
  total: string; ggr: string; lkn: string; ahm: string; lko: string; uk: string;
}

interface POForm {
  jobType: string;
  rate: string;
  signupDate: string;
  joiningDate: string;
  agreementPct: string;
  agreementMonths: string;
  upfrontAmount: string;
  poCount: POCount;
  interviewExpert: string;
}

const EMPTY_FORM: POForm = {
  jobType: '',
  rate: '',
  signupDate: '',
  joiningDate: '',
  agreementPct: '',
  agreementMonths: '',
  upfrontAmount: '',
  poCount: { total: '', ggr: '', lkn: '', ahm: '', lko: '', uk: '' },
  interviewExpert: '',
};

export function PODraftSheet({ open, onClose, prefill }: PODraftSheetProps) {
  const { authFetch } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState<POForm>(EMPTY_FORM);
  const [savedPoId, setSavedPoId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);

  const update = (field: keyof POForm, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const updateCount = (field: keyof POCount, value: string) =>
    setForm(prev => ({ ...prev, poCount: { ...prev.poCount, [field]: value } }));

  const buildPayload = () => ({
    candidateName:   prefill?.candidateName ?? '',
    emailId:         prefill?.emailId ?? '',
    endClient:       prefill?.endClient ?? '',
    position:        prefill?.position ?? '',
    vendor:          prefill?.vendor ?? '',
    branch:          prefill?.branch ?? '',
    recruiter:       prefill?.recruiter ?? '',
    candidateId:     prefill?.candidateId ?? null,
    sourceTaskId:    prefill?.taskId ?? null,
    jobType:         form.jobType,
    rate:            form.rate,
    signupDate:      form.signupDate || null,
    joiningDate:     form.joiningDate || null,
    agreementPct:    form.agreementPct    ? Number(form.agreementPct)    : null,
    agreementMonths: form.agreementMonths ? Number(form.agreementMonths) : null,
    upfrontAmount:   form.upfrontAmount   ? Number(form.upfrontAmount)   : null,
    poCount: {
      total: Number(form.poCount.total || 0),
      ggr:   Number(form.poCount.ggr   || 0),
      lkn:   Number(form.poCount.lkn   || 0),
      ahm:   Number(form.poCount.ahm   || 0),
      lko:   Number(form.poCount.lko   || 0),
      uk:    Number(form.poCount.uk    || 0),
    },
    interviewExpert: form.interviewExpert,
    isDraft: true,
  });

  const handleSave = async (): Promise<string | null> => {
    setSaving(true);
    try {
      const payload = savedPoId ? { ...buildPayload(), _id: savedPoId } : buildPayload();
      const res = await authFetch(`${API_URL}/api/po`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      const id = json.po._id?.toString() ?? savedPoId;
      setSavedPoId(id);
      toast({ title: 'Draft saved' });
      return id;
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateDraft = async () => {
    setGeneratingDraft(true);
    try {
      let poId = savedPoId;
      if (!poId) poId = await handleSave();
      if (!poId) return;

      const res = await authFetch(`${API_URL}/api/po/${poId}/draft-email`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      toast({
        title: 'Outlook draft created',
        description: json.webLink
          ? 'Draft is in your Outlook Drafts folder.'
          : 'Check your Outlook Drafts folder.',
      });

      if (json.webLink) {
        window.open(json.webLink, '_blank');
      }
    } catch (e: any) {
      toast({ title: 'Draft creation failed', description: e.message, variant: 'destructive' });
    } finally {
      setGeneratingDraft(false);
    }
  };

  const handleClose = () => {
    setForm(EMPTY_FORM);
    setSavedPoId(null);
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={open => !open && handleClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto flex flex-col gap-0 p-0" side="right">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="text-sm">Create PO Draft</SheetTitle>
          <SheetDescription className="text-xs">
            {prefill?.candidateName ?? 'New PO'} — auto-filled from task
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Auto-filled section */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-aurora-emerald mb-3">
              Auto-filled from task
            </div>
            <div className="grid grid-cols-2 gap-3 bg-aurora-emerald/5 rounded-lg p-3">
              {([
                ['Candidate', prefill?.candidateName],
                ['Email', prefill?.emailId],
                ['End Client', prefill?.endClient],
                ['Position', prefill?.position],
                ['Vendor', prefill?.vendor],
                ['Recruiter', prefill?.recruiter],
              ] as [string, string | undefined][]).map(([label, value]) => (
                <div key={label}>
                  <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
                  <div className="text-xs font-medium truncate">{value || '—'}</div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Manual fields */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-aurora-violet mb-3">
              Fill Manually
            </div>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Job Type</Label>
                <Select value={form.jobType} onValueChange={v => update('jobType', v)}>
                  <SelectTrigger className="h-8 text-xs mt-1">
                    <SelectValue placeholder="W2 / C2C / FTE" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="W2">W2</SelectItem>
                    <SelectItem value="C2C">C2C</SelectItem>
                    <SelectItem value="FTE">FTE</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Rate</Label>
                <Input className="h-8 text-xs mt-1" placeholder="e.g. $98,000 / Annum"
                  value={form.rate} onChange={e => update('rate', e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Signup Date</Label>
                  <Input type="date" className="h-8 text-xs mt-1"
                    value={form.signupDate} onChange={e => update('signupDate', e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Joining Date</Label>
                  <Input type="date" className="h-8 text-xs mt-1"
                    value={form.joiningDate} onChange={e => update('joiningDate', e.target.value)} />
                </div>
              </div>

              <div>
                <Label className="text-xs">Agreement</Label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  <Input className="h-8 text-xs" placeholder="% e.g. 14"
                    value={form.agreementPct} onChange={e => update('agreementPct', e.target.value)} />
                  <Input className="h-8 text-xs" placeholder="Months e.g. 5"
                    value={form.agreementMonths} onChange={e => update('agreementMonths', e.target.value)} />
                  <Input className="h-8 text-xs" placeholder="Upfront $"
                    value={form.upfrontAmount} onChange={e => update('upfrontAmount', e.target.value)} />
                </div>
              </div>

              <div>
                <Label className="text-xs">PO Count (branch-wise)</Label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {(['total', 'ggr', 'lkn', 'ahm', 'lko', 'uk'] as (keyof POCount)[]).map(k => (
                    <div key={k}>
                      <div className="text-[9px] uppercase text-muted-foreground mb-0.5">{k}</div>
                      <Input className="h-7 text-xs" placeholder="0"
                        value={form.poCount[k]} onChange={e => updateCount(k, e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs">Interview Support Expert</Label>
                <Input className="h-8 text-xs mt-1" placeholder="Expert name"
                  value={form.interviewExpert} onChange={e => update('interviewExpert', e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 flex gap-2 shrink-0">
          <Button size="sm" className="text-xs flex-1" onClick={handleSave} disabled={saving || generatingDraft}>
            {saving ? 'Saving…' : '💾 Save Draft'}
          </Button>
          <Button variant="outline" size="sm" className="text-xs flex-1"
            onClick={handleGenerateDraft} disabled={generatingDraft || saving}>
            {generatingDraft ? 'Creating…' : '✉️ Generate Outlook Draft'}
          </Button>
          <Button variant="ghost" size="sm" className="text-xs" onClick={handleClose}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
