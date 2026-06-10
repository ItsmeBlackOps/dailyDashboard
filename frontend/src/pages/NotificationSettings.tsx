import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Bell } from 'lucide-react';

// PRT Phase 4 — user-facing toggle for EAD email alerts.
// In-app notifications always fire (regardless of this setting).
// Email is opt-in (default false) — backend respects user.preferences.eadEmailAlerts.

export default function NotificationSettings() {
  const { authFetch } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [eadEmailAlerts, setEadEmailAlerts] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await authFetch(`${API_URL}/api/users/me/preferences`);
        const json = await resp.json().catch(() => ({}));
        if (!cancelled && resp.ok && json.success && json.preferences) {
          setEadEmailAlerts(Boolean(json.preferences.eadEmailAlerts));
        }
      } catch (err) {
        if (!cancelled) {
          toast({
            title: 'Could not load preferences',
            description: err instanceof Error ? err.message : String(err),
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch, toast]);

  const handleToggle = async (next: boolean) => {
    setSaving(true);
    // Optimistic — revert on error.
    const previous = eadEmailAlerts;
    setEadEmailAlerts(next);
    try {
      const resp = await authFetch(`${API_URL}/api/users/me/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eadEmailAlerts: next }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.success) {
        throw new Error(json.error || 'Update failed');
      }
      toast({
        title: next ? 'EAD email alerts enabled' : 'EAD email alerts disabled',
      });
    } catch (err) {
      setEadEmailAlerts(previous);
      toast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="mx-auto max-w-2xl space-y-6 p-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bell className="h-5 w-5" /> Notification preferences
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose which alerts the platform may email you about. In-app notifications
            still fire regardless of this setting.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">EAD expiry alerts</CardTitle>
            <CardDescription>
              When a candidate you're responsible for has an EAD expiring within 30 days,
              we'll email you a daily reminder until it's renewed or removed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-40" />
            ) : (
              <div className="flex items-center justify-between rounded border p-3">
                <Label htmlFor="ead-email-alerts" className="flex-1 cursor-pointer">
                  Email me when candidate EAD is expiring (less than 30 days)
                </Label>
                <Switch
                  id="ead-email-alerts"
                  checked={eadEmailAlerts}
                  onCheckedChange={handleToggle}
                  disabled={saving}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
