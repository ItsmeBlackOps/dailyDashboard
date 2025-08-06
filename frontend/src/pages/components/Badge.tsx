
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bell, Mail, ShoppingCart, Star } from 'lucide-react';

export default function ComponentBadge() {
  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Badge</h1>
            <p className="text-muted-foreground">Small status descriptors for UI elements.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Default Badges */}
          <Card>
            <CardHeader>
              <CardTitle>Default Badges</CardTitle>
              <CardDescription>Basic badge variants with different styles.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Badge>Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="destructive">Destructive</Badge>
                <Badge variant="outline">Outline</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Number Badges */}
          <Card>
            <CardHeader>
              <CardTitle>Number Badges</CardTitle>
              <CardDescription>Badges displaying numerical values and counts.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                <div className="relative">
                  <Button variant="outline">
                    <Bell className="h-4 w-4" />
                    Notifications
                  </Button>
                  <Badge className="absolute -top-2 -right-2 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs">
                    3
                  </Badge>
                </div>
                
                <div className="relative">
                  <Button variant="outline">
                    <Mail className="h-4 w-4" />
                    Messages
                  </Button>
                  <Badge variant="destructive" className="absolute -top-2 -right-2 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs">
                    12
                  </Badge>
                </div>
                
                <div className="relative">
                  <Button variant="outline">
                    <ShoppingCart className="h-4 w-4" />
                    Cart
                  </Button>
                  <Badge variant="secondary" className="absolute -top-2 -right-2 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs">
                    5
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pill Badges */}
          <Card>
            <CardHeader>
              <CardTitle>Pill Badges</CardTitle>
              <CardDescription>Rounded pill-shaped badges for categories and tags.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Badge className="rounded-full">New</Badge>
                <Badge variant="secondary" className="rounded-full">Updated</Badge>
                <Badge variant="outline" className="rounded-full">Featured</Badge>
                <Badge variant="destructive" className="rounded-full">Limited</Badge>
                <Badge className="rounded-full bg-green-600">Available</Badge>
                <Badge className="rounded-full bg-blue-600">Popular</Badge>
                <Badge className="rounded-full bg-purple-600">Premium</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Color Variants */}
          <Card>
            <CardHeader>
              <CardTitle>Color Variants</CardTitle>
              <CardDescription>Custom colored badges for different use cases.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <h4 className="font-medium">Status Badges</h4>
                  <div className="flex flex-wrap gap-2">
                    <Badge className="bg-green-600 hover:bg-green-700">Active</Badge>
                    <Badge className="bg-yellow-600 hover:bg-yellow-700">Pending</Badge>
                    <Badge className="bg-red-600 hover:bg-red-700">Inactive</Badge>
                    <Badge className="bg-gray-600 hover:bg-gray-700">Draft</Badge>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <h4 className="font-medium">Priority Badges</h4>
                  <div className="flex flex-wrap gap-2">
                    <Badge className="bg-red-600 hover:bg-red-700">High</Badge>
                    <Badge className="bg-orange-600 hover:bg-orange-700">Medium</Badge>
                    <Badge className="bg-blue-600 hover:bg-blue-700">Low</Badge>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <h4 className="font-medium">Category Badges</h4>
                  <div className="flex flex-wrap gap-2">
                    <Badge className="bg-purple-600 hover:bg-purple-700">
                      <Star className="h-3 w-3 mr-1" />
                      Premium
                    </Badge>
                    <Badge className="bg-teal-600 hover:bg-teal-700">Technology</Badge>
                    <Badge className="bg-pink-600 hover:bg-pink-700">Design</Badge>
                    <Badge className="bg-indigo-600 hover:bg-indigo-700">Business</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
