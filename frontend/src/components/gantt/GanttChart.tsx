
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Task {
  id: string;
  text: string;
  start_date: string;
  duration: number;
  progress: number;
  parent?: string;
}

interface GanttChartProps {
  tasks?: Task[];
  links?: any[];
}

export function GanttChart({ tasks = [], links = [] }: GanttChartProps) {
  const defaultTasks: Task[] = [
    {
      id: "1",
      text: "Project Planning",
      start_date: "2024-01-15",
      duration: 5,
      progress: 0.8
    },
    {
      id: "2",
      text: "Requirements Analysis",
      start_date: "2024-01-22",
      duration: 3,
      progress: 1,
      parent: "1"
    },
    {
      id: "3",
      text: "System Design",
      start_date: "2024-01-25",
      duration: 4,
      progress: 0.6,
      parent: "1"
    },
    {
      id: "4",
      text: "Development Phase",
      start_date: "2024-02-01",
      duration: 15,
      progress: 0.3
    },
    {
      id: "5",
      text: "Frontend Development",
      start_date: "2024-02-01",
      duration: 8,
      progress: 0.5,
      parent: "4"
    },
    {
      id: "6",
      text: "Backend Development",
      start_date: "2024-02-05",
      duration: 10,
      progress: 0.2,
      parent: "4"
    },
    {
      id: "7",
      text: "Testing",
      start_date: "2024-02-20",
      duration: 5,
      progress: 0
    },
    {
      id: "8",
      text: "Deployment",
      start_date: "2024-02-27",
      duration: 2,
      progress: 0
    }
  ];

  const tasksToDisplay = tasks.length > 0 ? tasks : defaultTasks;

  const calculateDaysBetween = (date1: string, date2: string) => {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = Math.abs(d2.getTime() - d1.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getEarliestDate = () => {
    const dates = tasksToDisplay.map(task => new Date(task.start_date));
    return new Date(Math.min(...dates.map(d => d.getTime())));
  };

  const getLatestDate = () => {
    const dates = tasksToDisplay.map(task => {
      const startDate = new Date(task.start_date);
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + task.duration);
      return endDate;
    });
    return new Date(Math.max(...dates.map(d => d.getTime())));
  };

  const earliestDate = getEarliestDate();
  const latestDate = getLatestDate();
  const totalDays = calculateDaysBetween(earliestDate.toISOString().split('T')[0], latestDate.toISOString().split('T')[0]);

  const getTaskPosition = (task: Task) => {
    const taskStart = new Date(task.start_date);
    const daysFromStart = calculateDaysBetween(earliestDate.toISOString().split('T')[0], taskStart.toISOString().split('T')[0]);
    const leftPercent = (daysFromStart / totalDays) * 100;
    const widthPercent = (task.duration / totalDays) * 100;
    return { left: leftPercent, width: widthPercent };
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Gantt Chart</CardTitle>
        <CardDescription>
          Interactive timeline view of project tasks and dependencies
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="w-full border border-border rounded-lg overflow-hidden">
          {/* Timeline Header */}
          <div className="bg-muted p-4 border-b">
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-4 font-semibold">Task Name</div>
              <div className="col-span-2 font-semibold">Start Date</div>
              <div className="col-span-2 font-semibold">Duration</div>
              <div className="col-span-2 font-semibold">Progress</div>
              <div className="col-span-2 font-semibold">Timeline</div>
            </div>
          </div>

          {/* Tasks */}
          <div className="space-y-2 p-4">
            {tasksToDisplay.map((task, index) => {
              const position = getTaskPosition(task);
              const isSubtask = !!task.parent;
              
              return (
                <div key={task.id} className="grid grid-cols-12 gap-4 items-center py-2 hover:bg-muted/50 rounded">
                  <div className={`col-span-4 ${isSubtask ? 'pl-6 text-sm' : 'font-medium'}`}>
                    {task.text}
                  </div>
                  <div className="col-span-2 text-sm text-muted-foreground">
                    {task.start_date}
                  </div>
                  <div className="col-span-2 text-sm">
                    {task.duration} days
                  </div>
                  <div className="col-span-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-full h-2">
                        <div 
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{ width: `${task.progress * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {Math.round(task.progress * 100)}%
                      </span>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="relative h-6 bg-muted/30 rounded">
                      <div
                        className={`absolute top-0 h-full rounded ${
                          isSubtask ? 'bg-blue-400' : 'bg-primary'
                        }`}
                        style={{
                          left: `${position.left}%`,
                          width: `${position.width}%`,
                          minWidth: '20px'
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Timeline Scale */}
          <div className="border-t bg-muted/30 p-4">
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-10"></div>
              <div className="col-span-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{earliestDate.toLocaleDateString()}</span>
                  <span>{latestDate.toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
