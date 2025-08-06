
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { GripVertical, User, Star, Calendar, Mail, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SortableItem {
  id: string;
  title: string;
  description?: string;
  icon?: React.ElementType;
  priority?: 'high' | 'medium' | 'low';
}

export default function ComponentSortable() {
  const [basicItems, setBasicItems] = useState<SortableItem[]>([
    { id: '1', title: 'First Item' },
    { id: '2', title: 'Second Item' },
    { id: '3', title: 'Third Item' },
    { id: '4', title: 'Fourth Item' },
    { id: '5', title: 'Fifth Item' },
  ]);

  const [taskItems, setTaskItems] = useState<SortableItem[]>([
    { id: '1', title: 'Review project proposal', description: 'Check the new project proposal from the client', icon: Calendar, priority: 'high' },
    { id: '2', title: 'Update user documentation', description: 'Update the user guide with new features', icon: User, priority: 'medium' },
    { id: '3', title: 'Fix bug in login system', description: 'Resolve authentication issues reported by users', icon: Settings, priority: 'high' },
    { id: '4', title: 'Send follow-up emails', description: 'Send follow-up emails to potential clients', icon: Mail, priority: 'low' },
    { id: '5', title: 'Code review session', description: 'Review pull requests from team members', icon: Star, priority: 'medium' },
  ]);

  const [draggedItem, setDraggedItem] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggedItem(itemId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetId: string, items: SortableItem[], setItems: React.Dispatch<React.SetStateAction<SortableItem[]>>) => {
    e.preventDefault();
    
    if (!draggedItem || draggedItem === targetId) return;

    const draggedIndex = items.findIndex(item => item.id === draggedItem);
    const targetIndex = items.findIndex(item => item.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const newItems = [...items];
    const [removed] = newItems.splice(draggedIndex, 1);
    newItems.splice(targetIndex, 0, removed);

    setItems(newItems);
    setDraggedItem(null);
  };

  const resetOrder = () => {
    setBasicItems([
      { id: '1', title: 'First Item' },
      { id: '2', title: 'Second Item' },
      { id: '3', title: 'Third Item' },
      { id: '4', title: 'Fourth Item' },
      { id: '5', title: 'Fifth Item' },
    ]);

    setTaskItems([
      { id: '1', title: 'Review project proposal', description: 'Check the new project proposal from the client', icon: Calendar, priority: 'high' },
      { id: '2', title: 'Update user documentation', description: 'Update the user guide with new features', icon: User, priority: 'medium' },
      { id: '3', title: 'Fix bug in login system', description: 'Resolve authentication issues reported by users', icon: Settings, priority: 'high' },
      { id: '4', title: 'Send follow-up emails', description: 'Send follow-up emails to potential clients', icon: Mail, priority: 'low' },
      { id: '5', title: 'Code review session', description: 'Review pull requests from team members', icon: Star, priority: 'medium' },
    ]);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-blue-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Sortable</h1>
            <p className="text-muted-foreground">Drag and drop to reorder list items.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={resetOrder}>Reset Order</Button>
            <Badge variant="outline">Components</Badge>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Basic Sortable List */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Sortable List</CardTitle>
              <CardDescription>Simple drag and drop reordering of list items.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {basicItems.map((item, index) => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, item.id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, item.id, basicItems, setBasicItems)}
                    className={cn(
                      'flex items-center gap-3 p-3 border rounded-lg cursor-move transition-all',
                      'hover:bg-muted/50 hover:border-primary/50',
                      draggedItem === item.id && 'opacity-50 scale-105'
                    )}
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                    <span className="bg-muted text-muted-foreground w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium">
                      {index + 1}
                    </span>
                    <span className="flex-1">{item.title}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Advanced Sortable List */}
          <Card>
            <CardHeader>
              <CardTitle>Task Priority List</CardTitle>
              <CardDescription>Sortable task list with icons, descriptions, and priority indicators.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {taskItems.map((item, index) => {
                  const Icon = item.icon || Calendar;
                  return (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, item.id)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, item.id, taskItems, setTaskItems)}
                      className={cn(
                        'flex items-start gap-3 p-4 border rounded-lg cursor-move transition-all',
                        'hover:bg-muted/50 hover:border-primary/50 hover:shadow-sm',
                        draggedItem === item.id && 'opacity-50 scale-[1.02] shadow-lg'
                      )}
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground mt-1 flex-shrink-0" />
                      
                      <div className="flex items-center gap-3 flex-1">
                        <div className="p-2 bg-muted rounded-md">
                          <Icon className="h-4 w-4" />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium truncate">{item.title}</h4>
                            {item.priority && (
                              <div className="flex items-center gap-1">
                                <div className={cn('w-2 h-2 rounded-full', getPriorityColor(item.priority))} />
                                <span className="text-xs text-muted-foreground capitalize">{item.priority}</span>
                              </div>
                            )}
                          </div>
                          {item.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2">{item.description}</p>
                          )}
                        </div>
                      </div>
                      
                      <span className="bg-muted text-muted-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0">
                        {index + 1}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Usage Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>How to Use</CardTitle>
            <CardDescription>Instructions for using the sortable components.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <div className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                  1
                </div>
                <div>
                  <p className="font-medium">Click and Drag</p>
                  <p className="text-muted-foreground">Click on any item and drag it to reorder the list.</p>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                  2
                </div>
                <div>
                  <p className="font-medium">Visual Feedback</p>
                  <p className="text-muted-foreground">Items will show visual feedback during drag operations with opacity and scaling.</p>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                  3
                </div>
                <div>
                  <p className="font-medium">Drop to Reorder</p>
                  <p className="text-muted-foreground">Drop the item at the desired position to reorder the list.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                  4
                </div>
                <div>
                  <p className="font-medium">Reset Order</p>
                  <p className="text-muted-foreground">Use the "Reset Order" button to restore the original order.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
