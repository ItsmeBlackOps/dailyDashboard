
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GanttChart } from '@/components/gantt/GanttChart';
import { Plus, Download, Settings } from 'lucide-react';

export default function ComponentGantt() {
  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">DHTMLX Gantt</h1>
            <p className="text-muted-foreground">Advanced Gantt chart component for project management.</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="secondary">New</Badge>
            <Badge variant="outline">Components</Badge>
          </div>
        </div>

        <div className="flex gap-4 mb-6">
          <Button className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add Task
          </Button>
          <Button variant="outline" className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button variant="outline" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </Button>
        </div>

        <GanttChart />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Features</CardTitle>
              <CardDescription>Key capabilities of the Gantt component</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li>• Interactive task management</li>
                <li>• Drag & drop functionality</li>
                <li>• Task dependencies</li>
                <li>• Progress tracking</li>
                <li>• Multiple view modes</li>
                <li>• Export capabilities</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usage</CardTitle>
              <CardDescription>How to integrate the Gantt chart</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <h4 className="font-medium mb-1">Basic Implementation</h4>
                  <code className="text-xs bg-muted p-2 rounded block">
                    {'<GanttChart tasks={tasks} links={links} />'}
                  </code>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Custom Configuration</h4>
                  <p className="text-sm text-muted-foreground">
                    Pass custom task data and link configurations to customize the chart.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
