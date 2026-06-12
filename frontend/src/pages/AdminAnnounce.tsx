import { useState } from 'react';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';

// Admin-only: compose and fan out an announcement to an audience, optionally as
// a front-and-centre pop-up (shows up to 3× per user, then stops). Backed by
// POST /api/notifications/announce (admin-gated).
export default function AdminAnnounce() {
  const { authFetch, user } = useAuth();
  const isAdmin = (localStorage.getItem('role') || '').trim().toLowerCase() === 'admin';

  const [audience, setAudience] = useState('marketing');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [link, setLink] = useState('');
  const [actor, setActor] = useState('');
  const [popup, setPopup] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-muted-foreground">
        This page is available to admins only.
      </div>
    );
  }

  const send = async () => {
    setError('');
    setResult('');
    if (!title.trim() || !description.trim()) {
      setError('Title and message are required.');
      return;
    }
    setSending(true);
    try {
      const res = await authFetch(`${API_URL}/api/notifications/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audience,
          title: title.trim(),
          description: description.trim(),
          link: link.trim() || undefined,
          actor: actor.trim() || undefined,
          popup,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed to send.');
      setResult(`Sent to ${data.recipients} ${audience} user(s) — ${data.created} new notification(s).`);
      setTitle('');
      setDescription('');
      setLink('');
    } catch (e: any) {
      setError(e.message || 'Failed to send.');
    } finally {
      setSending(false);
    }
  };

  const input = 'w-full rounded-md border bg-background px-3 py-2 text-sm';

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Send announcement</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Notify a team. With <strong>pop-up</strong> on, it appears front-and-centre on their
        dashboard (up to 3 times each, then it stops) instead of only in the bell.
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Audience</label>
          <select className={input} value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="all">Everyone</option>
            <option value="technical">Technical team (experts + technical leads)</option>
            <option value="marketing">Marketing team</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Title</label>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Action required: …" />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Message</label>
          <textarea className={`${input} min-h-[120px]`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What you want them to know / do." />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Link (optional)</label>
            <input className={input} value={link} onChange={(e) => setLink(e.target.value)} placeholder="/meeting-detector" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">From (optional)</label>
            <input className={input} value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Harsh Patel | Technical Team | Manager" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={popup} onChange={(e) => setPopup(e.target.checked)} />
          Show as a pop-up (recommended for must-see announcements)
        </label>

        <div className="flex items-center gap-3">
          <Button onClick={send} disabled={sending}>
            {sending ? 'Sending…' : 'Send announcement'}
          </Button>
          {result && <span className="text-sm text-emerald-600">{result}</span>}
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>
      </div>
    </div>
  );
}
