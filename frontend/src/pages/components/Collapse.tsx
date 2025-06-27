
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown } from 'lucide-react';

export default function ComponentCollapse() {
  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Collapse</h1>
            <p className="text-muted-foreground">Toggle the visibility of content.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Basic Collapse</CardTitle>
            <CardDescription>Simple collapsible content section.</CardDescription>
          </CardHeader>
          <CardContent>
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="flex items-center gap-2">
                  Toggle Content
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4 p-4 border rounded">
                This content can be toggled by clicking the button above.
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
