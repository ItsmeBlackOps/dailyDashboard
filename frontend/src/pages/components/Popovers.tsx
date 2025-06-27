
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings, User, Calendar, MessageSquare } from 'lucide-react';

export default function ComponentPopovers() {
  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Popovers</h1>
            <p className="text-muted-foreground">Displays rich content in a portal, triggered by a button.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Basic Popover */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Popover</CardTitle>
              <CardDescription>Simple popover with text content.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline">Open Popover</Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80">
                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <h4 className="font-medium leading-none">Dimensions</h4>
                        <p className="text-sm text-muted-foreground">
                          Set the dimensions for the layer.
                        </p>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button>
                      <Settings className="mr-2 h-4 w-4" />
                      Settings
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80">
                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <h4 className="font-medium leading-none">Quick Settings</h4>
                        <p className="text-sm text-muted-foreground">
                          Adjust your preferences quickly.
                        </p>
                      </div>
                      <div className="grid gap-2">
                        <div className="grid grid-cols-3 items-center gap-4">
                          <Label htmlFor="width">Width</Label>
                          <Input id="width" defaultValue="100%" className="col-span-2 h-8" />
                        </div>
                        <div className="grid grid-cols-3 items-center gap-4">
                          <Label htmlFor="maxWidth">Max. width</Label>
                          <Input id="maxWidth" defaultValue="300px" className="col-span-2 h-8" />
                        </div>
                        <div className="grid grid-cols-3 items-center gap-4">
                          <Label htmlFor="height">Height</Label>
                          <Input id="height" defaultValue="25px" className="col-span-2 h-8" />
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </CardContent>
          </Card>

          {/* Positioned Popovers */}
          <Card>
            <CardHeader>
              <CardTitle>Positioned Popovers</CardTitle>
              <CardDescription>Popovers with different positioning.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 place-items-center min-h-[200px]">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline">Top</Button>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="w-64">
                    <p className="text-sm">This popover appears on top.</p>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline">Right</Button>
                  </PopoverTrigger>
                  <PopoverContent side="right" className="w-64">
                    <p className="text-sm">This popover appears on the right.</p>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline">Bottom</Button>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" className="w-64">
                    <p className="text-sm">This popover appears on the bottom.</p>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline">Left</Button>
                  </PopoverTrigger>
                  <PopoverContent side="left" className="w-64">
                    <p className="text-sm">This popover appears on the left.</p>
                  </PopoverContent>
                </Popover>
              </div>
            </CardContent>
          </Card>

          {/* Rich Content Popovers */}
          <Card>
            <CardHeader>
              <CardTitle>Rich Content Popovers</CardTitle>
              <CardDescription>Popovers with complex content including forms and actions.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 flex-wrap">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline">
                      <User className="mr-2 h-4 w-4" />
                      User Profile
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80">
                    <div className="flex gap-4">
                      <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center text-white font-bold">
                        JD
                      </div>
                      <div className="flex-1 space-y-1">
                        <h4 className="font-semibold">John Doe</h4>
                        <p className="text-sm text-muted-foreground">Software Engineer</p>
                        <p className="text-xs text-muted-foreground">john.doe@company.com</p>
                        <div className="flex gap-2 pt-2">
                          <Button size="sm">View Profile</Button>
                          <Button size="sm" variant="outline">Message</Button>
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline">
                      <Calendar className="mr-2 h-4 w-4" />
                      Quick Actions
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72">
                    <div className="grid gap-3">
                      <div className="space-y-2">
                        <h4 className="font-medium leading-none">Quick Actions</h4>
                        <p className="text-sm text-muted-foreground">
                          Perform common tasks quickly.
                        </p>
                      </div>
                      <div className="grid gap-2">
                        <Button size="sm" className="justify-start">
                          <Calendar className="mr-2 h-4 w-4" />
                          Schedule Meeting
                        </Button>
                        <Button size="sm" variant="outline" className="justify-start">
                          <MessageSquare className="mr-2 h-4 w-4" />
                          Send Message
                        </Button>
                        <Button size="sm" variant="outline" className="justify-start">
                          <User className="mr-2 h-4 w-4" />
                          Add Contact
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button>Contact Form</Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-96">
                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <h4 className="font-medium leading-none">Contact Us</h4>
                        <p className="text-sm text-muted-foreground">
                          Send us a quick message.
                        </p>
                      </div>
                      <div className="grid gap-3">
                        <div className="grid gap-2">
                          <Label htmlFor="name">Name</Label>
                          <Input id="name" placeholder="Your name" />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="email">Email</Label>
                          <Input id="email" type="email" placeholder="your@email.com" />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="message">Message</Label>
                          <textarea 
                            id="message" 
                            className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="Your message..."
                          />
                        </div>
                        <Button size="sm">Send Message</Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
