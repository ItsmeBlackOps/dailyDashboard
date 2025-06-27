
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function ComponentCard() {
  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Card</h1>
            <p className="text-muted-foreground">A flexible container for grouping related content.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Basic Card</CardTitle>
              <CardDescription>A simple card with header and content.</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Card content goes here. This is a basic card example.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Card with Footer</CardTitle>
              <CardDescription>Card that includes footer actions.</CardDescription>
            </CardHeader>
            <CardContent>
              <p>This card demonstrates the use of a footer section.</p>
            </CardContent>
            <CardFooter>
              <Button variant="outline">Cancel</Button>
              <Button className="ml-2">Save</Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
