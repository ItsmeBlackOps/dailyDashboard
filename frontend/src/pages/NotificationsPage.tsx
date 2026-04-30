import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ArrowLeft, CheckCheck } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useNotifications } from '@/context/NotificationContext';

function timeAgo(ts: string | number | Date): string {
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { notifications, markAsRead, clearAll, openModal } = useNotifications();
  const [tab, setTab] = useState<'all' | 'unread'>('all');

  const list = useMemo(() => {
    const sorted = [...notifications].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    return tab === 'unread' ? sorted.filter((n) => !n.read) : sorted;
  }, [notifications, tab]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <DashboardLayout>
      <div className="px-4 md:px-6 py-4 space-y-4 max-w-3xl mx-auto">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs -ml-1"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>

        <div className="flex items-center gap-3 flex-wrap">
          <Bell className="h-5 w-5 text-aurora-violet" />
          <h1 className="text-lg font-bold">Notifications</h1>
          {unreadCount > 0 && (
            <Badge variant="outline" className="border-primary/30 text-primary">
              {unreadCount} unread
            </Badge>
          )}
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="ml-auto text-xs text-primary hover:text-primary"
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              Mark all read
            </Button>
          )}
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'all' | 'unread')}>
          <TabsList>
            <TabsTrigger value="all">All ({notifications.length})</TabsTrigger>
            <TabsTrigger value="unread">Unread ({unreadCount})</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="mt-3">
            {list.length === 0 ? (
              <EmptyState
                icon={<Bell className="h-6 w-6" />}
                title={tab === 'unread' ? 'You\'re all caught up' : 'No notifications yet'}
                description={
                  tab === 'unread'
                    ? "Nothing unread. Switch to 'All' to review past activity."
                    : "When recruiters request reviews, candidates update, or alerts fire — they'll show up here."
                }
              />
            ) : (
              <ScrollArea className="h-[60vh] rounded-md border">
                <ul className="divide-y">
                  {list.map((n) => (
                    <li
                      key={n.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (!n.read) markAsRead(n.id);
                        openModal(n);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          if (!n.read) markAsRead(n.id);
                          openModal(n);
                        }
                      }}
                      className={`p-3 hover:bg-muted/40 cursor-pointer transition-colors ${!n.read ? 'bg-muted/30' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        {!n.read && (
                          <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-sm font-medium truncate">{n.title}</p>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {timeAgo(n.timestamp)}
                            </span>
                          </div>
                          {n.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {n.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
