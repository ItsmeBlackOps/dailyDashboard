import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { parseJsonOrThrow } from '@/lib/fetchJson';

const VISA_TYPE_VALUES = ['OPT', 'L2', 'Green Card', 'STEM OPT', 'USC', 'H4-EAD', 'PR', 'CPT', 'H1B', 'Day 1 CPT', 'Asylum'];
const COMPANY_VALUES = ['SST', 'VCS', 'FED'];
const EAD_TYPES = ['OPT', 'STEM OPT', 'CPT', 'Day 1 CPT', 'H4-EAD', 'L2'];

export interface MarketingInfoModalProps {
  open: boolean;
  candidateId: string;
  initial: { visaType: string; company: string; eadStartDate: string | null; eadEndDate: string | null };
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function MarketingInfoModal({ open, candidateId, initial, onOpenChange, onSaved }: MarketingInfoModalProps) {
  const { authFetch } = useAuth();
  const [visaType, setVisaType] = useState(initial.visaType || '');
  const [company, setCompany] = useState(initial.company || '');
  const [eadStartDate, setEadStartDate] = useState(initial.eadStartDate || '');
  const [eadEndDate, setEadEndDate] = useState(initial.eadEndDate || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const needsEad = EAD_TYPES.includes(visaType);

  const save = async () => {
    setError('');
    if (!visaType) { setError('Visa Type is required.'); return; }
    if (!company) { setError('Company is required.'); return; }
    if (needsEad && (!eadStartDate || !eadEndDate)) { setError('EAD start and end dates are required for this visa type.'); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { visaType, company };
      if (needsEad) { body.eadStartDate = eadStartDate; body.eadEndDate = eadEndDate; }
      const res = await authFetch(`${API_URL}/api/candidates/${candidateId}/marketing-info`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      await parseJsonOrThrow(res);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Marketing info</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="mi-visa">Visa Type</Label>
            <Select value={visaType} onValueChange={setVisaType}>
              <SelectTrigger id="mi-visa"><SelectValue placeholder="Select visa type" /></SelectTrigger>
              <SelectContent>{VISA_TYPE_VALUES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {needsEad && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="mi-ead-start">EAD start</Label>
                <Input id="mi-ead-start" type="date" value={eadStartDate} onChange={(e) => setEadStartDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="mi-ead-end">EAD end</Label>
                <Input id="mi-ead-end" type="date" value={eadEndDate} onChange={(e) => setEadEndDate(e.target.value)} />
              </div>
            </div>
          )}
          <div>
            <Label htmlFor="mi-company">Company</Label>
            <Select value={company} onValueChange={setCompany}>
              <SelectTrigger id="mi-company"><SelectValue placeholder="Select company" /></SelectTrigger>
              <SelectContent>{COMPANY_VALUES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
