import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type ActivityType = 'call' | 'email' | 'meeting' | 'note';

interface Activity {
  id: string;
  type: ActivityType;
  user: {
    name: string;
    image?: string;
    initials: string;
  };
  target: string;
  content: string;
  time: string;
}

const activities: Activity[] = [
  {
    id: '1',
    type: 'call',
    user: {
      name: 'Alex Thompson',
      initials: 'AT',
    },
    target: 'Adobe Inc.',
    content: 'Had a call discussing renewal options for the enterprise plan.',
    time: '2 hours ago',
  },
  {
    id: '2',
    type: 'email',
    user: {
      name: 'Sarah Wilson',
      initials: 'SW',
    },
    target: 'John Doe',
    content: 'Sent follow-up email about the product demo yesterday.',
    time: '3 hours ago',
  },
  {
    id: '3',
    type: 'meeting',
    user: {
      name: 'Michael Chen',
      initials: 'MC',
    },
    target: 'Team Meeting',
    content: 'Scheduled a discovery meeting with the marketing team.',
    time: '5 hours ago',
  },
  {
    id: '4',
    type: 'note',
    user: {
      name: 'Emma Rodriguez',
      initials: 'ER',
    },
    target: 'Salesforce Opportunity',
    content: 'Added notes about budget constraints for Q3 proposal.',
    time: 'Yesterday',
  },
  {
    id: '5',
    type: 'call',
    user: {
      name: 'David Kim',
      initials: 'DK',
    },
    target: 'Microsoft Corp.',
    content: 'Followed up on pending support tickets for the cloud service.',
    time: 'Yesterday',
  },
];

function ActivityTypeIcon({ type }: { type: ActivityType }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-full px-2 py-1 text-xs font-normal',
        type === 'call' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
        type === 'email' && 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
        type === 'meeting' && 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
        type === 'note' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
      )}
    >
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </Badge>
  );
}

export function ActivityFeed() {
  return (
    <Card className="dashboard-card">
      <CardHeader className="mb-6 p-0">
        <CardTitle className="text-lg font-medium">Activity Feed</CardTitle>
      </CardHeader>
      <CardContent className="overflow-auto max-h-[400px] px-0 pt-4">
        <div className="space-y-5">
          {activities.map((activity) => (
            <div key={activity.id} className="flex gap-3">
              <Avatar className="h-8 w-8">
                <AvatarImage src={activity.user.image} alt={activity.user.name} />
                <AvatarFallback>{activity.user.initials}</AvatarFallback>
              </Avatar>
              <div className="space-y-1 border-b border-border pb-5 w-full">
                <div className="flex flex-wrap gap-2 items-center text-sm ">
                  <span className="font-medium">{activity.user.name}</span>
                  <ActivityTypeIcon type={activity.type} />
                  <span>with</span>
                  <span className="font-medium">{activity.target}</span>
                </div>
                <p className="text-sm text-muted-foreground">{activity.content}</p>
                <p className="text-xs text-muted-foreground">{activity.time}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
