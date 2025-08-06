
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Home, 
  User, 
  Settings, 
  Bell, 
  Mail,
  Calendar,
  FileText,
  BarChart3,
  Shield,
  Download
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const NavigationTabs = ({ 
  orientation = 'horizontal',
  variant = 'default'
}: { 
  orientation?: 'horizontal' | 'vertical';
  variant?: 'default' | 'pills' | 'underline';
}) => {
  const [activeTab, setActiveTab] = useState('home');

  const tabs = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ];

  const getTabClassName = (tabId: string) => {
    const isActive = activeTab === tabId;
    
    if (variant === 'pills') {
      return cn(
        'px-4 py-2 rounded-full text-sm font-medium transition-colors',
        isActive 
          ? 'bg-primary text-primary-foreground' 
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      );
    }
    
    if (variant === 'underline') {
      return cn(
        'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
        isActive 
          ? 'border-primary text-primary' 
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground'
      );
    }
    
    return cn(
      'px-4 py-2 text-sm font-medium rounded-md transition-colors',
      isActive 
        ? 'bg-muted text-foreground' 
        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
    );
  };

  return (
    <div className={cn(
      'flex',
      orientation === 'vertical' ? 'flex-col space-y-1' : 'space-x-1'
    )}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={getTabClassName(tab.id)}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default function ComponentNavsTabs() {
  const [activeMainTab, setActiveMainTab] = useState('overview');

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Navs & Tabs</h1>
            <p className="text-muted-foreground">Navigation and tab components for organizing content into sections.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Basic Tabs */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Tabs</CardTitle>
              <CardDescription>Simple tab navigation with content panels.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="account" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="account">Account</TabsTrigger>
                  <TabsTrigger value="password">Password</TabsTrigger>
                  <TabsTrigger value="preferences">Preferences</TabsTrigger>
                  <TabsTrigger value="notifications">Notifications</TabsTrigger>
                </TabsList>
                
                <TabsContent value="account" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <h3 className="text-lg font-medium">Account Settings</h3>
                    <p className="text-muted-foreground">
                      Manage your account details and personal information.
                    </p>
                    <div className="grid grid-cols-2 gap-4 pt-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">First Name</label>
                        <div className="h-9 bg-muted rounded border px-3 py-2 text-sm">John</div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Last Name</label>
                        <div className="h-9 bg-muted rounded border px-3 py-2 text-sm">Doe</div>
                      </div>
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="password" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <h3 className="text-lg font-medium">Password Security</h3>
                    <p className="text-muted-foreground">
                      Update your password and security settings.
                    </p>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Current Password</label>
                        <div className="h-9 bg-muted rounded border px-3 py-2 text-sm">••••••••</div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">New Password</label>
                        <div className="h-9 bg-muted rounded border px-3 py-2 text-sm">••••••••</div>
                      </div>
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="preferences" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <h3 className="text-lg font-medium">User Preferences</h3>
                    <p className="text-muted-foreground">
                      Customize your application experience.
                    </p>
                    <div className="space-y-4 pt-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Dark Mode</span>
                        <div className="w-10 h-6 bg-muted rounded-full"></div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Email Notifications</span>
                        <div className="w-10 h-6 bg-primary rounded-full"></div>
                      </div>
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="notifications" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <h3 className="text-lg font-medium">Notification Settings</h3>
                    <p className="text-muted-foreground">
                      Configure how you receive notifications.
                    </p>
                    <div className="space-y-3 pt-4">
                      <div className="flex items-center space-x-3">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Email notifications enabled</span>
                      </div>
                      <div className="flex items-center space-x-3">
                        <Bell className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">Push notifications enabled</span>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Tabs with Icons */}
          <Card>
            <CardHeader>
              <CardTitle>Tabs with Icons</CardTitle>
              <CardDescription>Enhanced tabs with icon support and better visual hierarchy.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="dashboard" className="w-full">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="dashboard" className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Dashboard
                  </TabsTrigger>
                  <TabsTrigger value="documents" className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Documents
                  </TabsTrigger>
                  <TabsTrigger value="calendar" className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Calendar
                  </TabsTrigger>
                  <TabsTrigger value="security" className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Security
                  </TabsTrigger>
                  <TabsTrigger value="downloads" className="flex items-center gap-2">
                    <Download className="h-4 w-4" />
                    Downloads
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="dashboard" className="mt-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-muted p-4 rounded-lg text-center">
                      <BarChart3 className="h-8 w-8 mx-auto mb-2 text-primary" />
                      <h4 className="font-medium">Analytics</h4>
                      <p className="text-sm text-muted-foreground">View your performance metrics</p>
                    </div>
                    <div className="bg-muted p-4 rounded-lg text-center">
                      <User className="h-8 w-8 mx-auto mb-2 text-primary" />
                      <h4 className="font-medium">Users</h4>
                      <p className="text-sm text-muted-foreground">Manage user accounts</p>
                    </div>
                    <div className="bg-muted p-4 rounded-lg text-center">
                      <Settings className="h-8 w-8 mx-auto mb-2 text-primary" />
                      <h4 className="font-medium">Settings</h4>
                      <p className="text-sm text-muted-foreground">Configure your application</p>
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="documents" className="mt-6">
                  <div className="space-y-3">
                    {['Project Report.pdf', 'Meeting Notes.docx', 'Budget Analysis.xlsx'].map((doc, i) => (
                      <div key={i} className="flex items-center space-x-3 p-3 bg-muted rounded-lg">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <span className="flex-1 text-sm font-medium">{doc}</span>
                        <Button size="sm" variant="ghost">Download</Button>
                      </div>
                    ))}
                  </div>
                </TabsContent>
                
                <TabsContent value="calendar" className="mt-6">
                  <div className="text-center py-8">
                    <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <h4 className="font-medium mb-2">Calendar View</h4>
                    <p className="text-muted-foreground">Your calendar integration would appear here.</p>
                  </div>
                </TabsContent>
                
                <TabsContent value="security" className="mt-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center space-x-3">
                        <Shield className="h-5 w-5 text-green-600" />
                        <span className="text-sm font-medium">Two-Factor Authentication</span>
                      </div>
                      <Badge variant="secondary">Enabled</Badge>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center space-x-3">
                        <Shield className="h-5 w-5 text-yellow-600" />
                        <span className="text-sm font-medium">Login Alerts</span>
                      </div>
                      <Badge variant="outline">Configure</Badge>
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="downloads" className="mt-6">
                  <div className="text-center py-8">
                    <Download className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <h4 className="font-medium mb-2">No Downloads</h4>
                    <p className="text-muted-foreground">Your downloaded files will appear here.</p>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Navigation Styles */}
          <Card>
            <CardHeader>
              <CardTitle>Navigation Styles</CardTitle>
              <CardDescription>Different visual styles for tab navigation.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-8">
                <div className="space-y-4">
                  <h4 className="font-medium">Default Style</h4>
                  <NavigationTabs variant="default" />
                </div>
                
                <div className="space-y-4">
                  <h4 className="font-medium">Pills Style</h4>
                  <NavigationTabs variant="pills" />
                </div>
                
                <div className="space-y-4">
                  <h4 className="font-medium">Underline Style</h4>
                  <NavigationTabs variant="underline" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Vertical Tabs */}
          <Card>
            <CardHeader>
              <CardTitle>Vertical Navigation</CardTitle>
              <CardDescription>Vertical tab layout for sidebar-style navigation.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-6">
                <div className="w-48">
                  <NavigationTabs orientation="vertical" />
                </div>
                <div className="flex-1">
                  <Card>
                    <CardContent className="p-6">
                      <h3 className="text-lg font-medium mb-2">Content Area</h3>
                      <p className="text-muted-foreground mb-4">
                        This is where the content for the selected tab would be displayed. 
                        Vertical navigation is useful for sidebar layouts and settings pages.
                      </p>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 bg-muted rounded">
                          <h4 className="font-medium text-sm">Feature 1</h4>
                          <p className="text-xs text-muted-foreground">Description of feature</p>
                        </div>
                        <div className="p-3 bg-muted rounded">
                          <h4 className="font-medium text-sm">Feature 2</h4>
                          <p className="text-xs text-muted-foreground">Description of feature</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Segmented Control */}
          <Card>
            <CardHeader>
              <CardTitle>Segmented Control</CardTitle>
              <CardDescription>iOS-style segmented control for tab navigation.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="space-y-4">
                  <h4 className="font-medium">View Mode</h4>
                  <div className="inline-flex bg-muted rounded-lg p-1">
                    <Button variant="secondary" size="sm" className="rounded-md">
                      List
                    </Button>
                    <Button variant="ghost" size="sm" className="rounded-md">
                      Grid
                    </Button>
                    <Button variant="ghost" size="sm" className="rounded-md">
                      Card
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium">Time Range</h4>
                  <div className="inline-flex bg-muted rounded-lg p-1">
                    <Button variant="ghost" size="sm" className="rounded-md">
                      Day
                    </Button>
                    <Button variant="secondary" size="sm" className="rounded-md">
                      Week
                    </Button>
                    <Button variant="ghost" size="sm" className="rounded-md">
                      Month
                    </Button>
                    <Button variant="ghost" size="sm" className="rounded-md">
                      Year
                    </Button>
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
