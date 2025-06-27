
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Menu, Settings, User, Mail, Bell, X } from 'lucide-react';

export default function ComponentOffcanvas() {
  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Offcanvas</h1>
            <p className="text-muted-foreground">Sliding panels that appear from the edge of the screen.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Basic Offcanvas */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Offcanvas</CardTitle>
              <CardDescription>Simple sliding panels from different sides.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 flex-wrap">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline">Left Sidebar</Button>
                  </SheetTrigger>
                  <SheetContent side="left">
                    <SheetHeader>
                      <SheetTitle>Left Panel</SheetTitle>
                      <SheetDescription>
                        This panel slides in from the left side of the screen.
                      </SheetDescription>
                    </SheetHeader>
                    <div className="py-4 space-y-4">
                      <p className="text-sm text-muted-foreground">
                        This is content inside the left offcanvas panel. You can put any content here including forms, navigation, or other components.
                      </p>
                      <div className="space-y-2">
                        <h4 className="font-medium">Navigation</h4>
                        <div className="space-y-1">
                          <Button variant="ghost" className="w-full justify-start">
                            <User className="mr-2 h-4 w-4" />
                            Profile
                          </Button>
                          <Button variant="ghost" className="w-full justify-start">
                            <Settings className="mr-2 h-4 w-4" />
                            Settings
                          </Button>
                          <Button variant="ghost" className="w-full justify-start">
                            <Bell className="mr-2 h-4 w-4" />
                            Notifications
                          </Button>
                        </div>
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>

                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline">Right Sidebar</Button>
                  </SheetTrigger>
                  <SheetContent side="right">
                    <SheetHeader>
                      <SheetTitle>Right Panel</SheetTitle>
                      <SheetDescription>
                        This panel slides in from the right side.
                      </SheetDescription>
                    </SheetHeader>
                    <div className="py-4 space-y-4">
                      <div className="space-y-2">
                        <h4 className="font-medium">Quick Actions</h4>
                        <div className="grid gap-2">
                          <Button size="sm" className="justify-start">
                            <Mail className="mr-2 h-4 w-4" />
                            Send Message
                          </Button>
                          <Button size="sm" variant="outline" className="justify-start">
                            <User className="mr-2 h-4 w-4" />
                            Add Contact
                          </Button>
                          <Button size="sm" variant="outline" className="justify-start">
                            <Settings className="mr-2 h-4 w-4" />
                            Configure
                          </Button>
                        </div>
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>

                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline">Top Panel</Button>
                  </SheetTrigger>
                  <SheetContent side="top" className="h-1/2">
                    <SheetHeader>
                      <SheetTitle>Top Panel</SheetTitle>
                      <SheetDescription>
                        This panel slides down from the top.
                      </SheetDescription>
                    </SheetHeader>
                    <div className="py-4">
                      <p className="text-sm text-muted-foreground">
                        Top panels are great for displaying notifications, announcements, or quick settings that need prominent placement.
                      </p>
                    </div>
                  </SheetContent>
                </Sheet>

                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline">Bottom Panel</Button>
                  </SheetTrigger>
                  <SheetContent side="bottom" className="h-1/3">
                    <SheetHeader>
                      <SheetTitle>Bottom Panel</SheetTitle>
                      <SheetDescription>
                        This panel slides up from the bottom.
                      </SheetDescription>
                    </SheetHeader>
                    <div className="py-4">
                      <p className="text-sm text-muted-foreground">
                        Bottom panels work well for mobile-style action sheets or secondary information.
                      </p>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </CardContent>
          </Card>

          {/* Offcanvas with Forms */}
          <Card>
            <CardHeader>
              <CardTitle>Offcanvas with Forms</CardTitle>
              <CardDescription>Forms and complex content in sliding panels.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 flex-wrap">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button>
                      <User className="mr-2 h-4 w-4" />
                      Edit Profile
                    </Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Edit Profile</SheetTitle>
                      <SheetDescription>
                        Make changes to your profile here. Click save when you're done.
                      </SheetDescription>
                    </SheetHeader>
                    <div className="py-4 space-y-4">
                      <div className="grid gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="name">Name</Label>
                          <Input id="name" defaultValue="John Doe" />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="email">Email</Label>
                          <Input id="email" type="email" defaultValue="john@example.com" />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="bio">Bio</Label>
                          <Textarea id="bio" placeholder="Tell us about yourself..." />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="location">Location</Label>
                          <Input id="location" placeholder="Your location" />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="website">Website</Label>
                          <Input id="website" placeholder="https://yourwebsite.com" />
                        </div>
                      </div>
                      <div className="flex gap-2 pt-4">
                        <Button>Save Changes</Button>
                        <Button variant="outline">Cancel</Button>
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>

                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline">
                      <Mail className="mr-2 h-4 w-4" />
                      Contact Form
                    </Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Contact Us</SheetTitle>
                      <SheetDescription>
                        Send us a message and we'll get back to you soon.
                      </SheetDescription>
                    </SheetHeader>
                    <div className="py-4 space-y-4">
                      <div className="grid gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="subject">Subject</Label>
                          <Input id="subject" placeholder="What's this about?" />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="message">Message</Label>
                          <Textarea 
                            id="message" 
                            placeholder="Your message..."
                            className="min-h-[120px]"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="priority">Priority</Label>
                          <select 
                            id="priority"
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex gap-2 pt-4">
                        <Button className="flex-1">Send Message</Button>
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>

                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline">
                      <Settings className="mr-2 h-4 w-4" />
                      Settings Panel
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="w-full sm:max-w-lg">
                    <SheetHeader>
                      <SheetTitle>Application Settings</SheetTitle>
                      <SheetDescription>
                        Configure your application preferences.
                      </SheetDescription>
                    </SheetHeader>
                    <div className="py-4 space-y-6">
                      <div className="space-y-4">
                        <h4 className="font-medium">Notifications</h4>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="email-notif">Email notifications</Label>
                            <input type="checkbox" id="email-notif" defaultChecked />
                          </div>
                          <div className="flex items-center justify-between">
                            <Label htmlFor="push-notif">Push notifications</Label>
                            <input type="checkbox" id="push-notif" />
                          </div>
                          <div className="flex items-center justify-between">
                            <Label htmlFor="sms-notif">SMS notifications</Label>
                            <input type="checkbox" id="sms-notif" />
                          </div>
                        </div>
                      </div>
                      
                      <div className="space-y-4">
                        <h4 className="font-medium">Appearance</h4>
                        <div className="grid gap-2">
                          <Label htmlFor="theme">Theme</Label>
                          <select 
                            id="theme"
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                          >
                            <option value="light">Light</option>
                            <option value="dark">Dark</option>
                            <option value="system">System</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex gap-2 pt-4">
                        <Button>Apply Settings</Button>
                        <Button variant="outline">Reset</Button>
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </CardContent>
          </Card>

          {/* Mobile Menu Example */}
          <Card>
            <CardHeader>
              <CardTitle>Mobile Menu</CardTitle>
              <CardDescription>Common mobile navigation pattern using offcanvas.</CardDescription>
            </CardHeader>
            <CardContent>
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline">
                    <Menu className="mr-2 h-4 w-4" />
                    Mobile Menu
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-80">
                  <SheetHeader>
                    <SheetTitle>Navigation Menu</SheetTitle>
                  </SheetHeader>
                  <div className="py-4 space-y-4">
                    <nav className="space-y-1">
                      <Button variant="ghost" className="w-full justify-start">
                        <User className="mr-2 h-4 w-4" />
                        Dashboard
                      </Button>
                      <Button variant="ghost" className="w-full justify-start">
                        <Mail className="mr-2 h-4 w-4" />
                        Messages
                      </Button>
                      <Button variant="ghost" className="w-full justify-start">
                        <Bell className="mr-2 h-4 w-4" />
                        Notifications
                      </Button>
                      <Button variant="ghost" className="w-full justify-start">
                        <Settings className="mr-2 h-4 w-4" />
                        Settings
                      </Button>
                    </nav>
                    
                    <div className="border-t pt-4">
                      <div className="flex items-center gap-3 p-2">
                        <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white text-sm font-bold">
                          JD
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">John Doe</p>
                          <p className="text-xs text-muted-foreground">john@example.com</p>
                        </div>
                      </div>
                      <Button variant="ghost" className="w-full justify-start mt-2">
                        Sign Out
                      </Button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
