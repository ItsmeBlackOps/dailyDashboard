
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  Star, 
  Calendar, 
  Clock,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  XCircle,
  Circle,
  Download,
  FileText,
  Image,
  Video
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ComponentListGroup() {
  const basicItems = [
    "First item",
    "Second item", 
    "Third item",
    "Fourth item",
    "Fifth item"
  ];

  const contacts = [
    {
      id: 1,
      name: "John Doe",
      email: "john@example.com",
      phone: "+1 (555) 123-4567",
      avatar: "/placeholder.svg",
      status: "online",
      role: "Product Manager"
    },
    {
      id: 2,
      name: "Jane Smith",
      email: "jane@example.com", 
      phone: "+1 (555) 987-6543",
      avatar: "/placeholder.svg",
      status: "offline",
      role: "Designer"
    },
    {
      id: 3,
      name: "Mike Johnson",
      email: "mike@example.com",
      phone: "+1 (555) 456-7890",
      avatar: "/placeholder.svg",
      status: "away",
      role: "Developer"
    },
    {
      id: 4,
      name: "Sarah Wilson",
      email: "sarah@example.com",
      phone: "+1 (555) 321-0987",
      avatar: "/placeholder.svg",
      status: "online",
      role: "Marketing Manager"
    }
  ];

  const notifications = [
    {
      id: 1,
      title: "New message received",
      description: "John sent you a message about the project",
      time: "2 minutes ago",
      type: "message",
      read: false
    },
    {
      id: 2,
      title: "Task completed",
      description: "Website redesign has been completed",
      time: "1 hour ago", 
      type: "success",
      read: false
    },
    {
      id: 3,
      title: "Payment failed",
      description: "Your payment method was declined",
      time: "3 hours ago",
      type: "error",
      read: true
    },
    {
      id: 4,
      title: "Reminder",
      description: "Team meeting at 3:00 PM today",
      time: "5 hours ago",
      type: "warning",
      read: true
    }
  ];

  const files = [
    {
      id: 1,
      name: "project-proposal.pdf",
      size: "2.4 MB",
      type: "pdf",
      modified: "2 hours ago",
      author: "John Doe"
    },
    {
      id: 2,
      name: "design-mockups.fig",
      size: "15.8 MB", 
      type: "design",
      modified: "1 day ago",
      author: "Jane Smith"
    },
    {
      id: 3,
      name: "presentation.pptx",
      size: "8.2 MB",
      type: "presentation", 
      modified: "3 days ago",
      author: "Mike Johnson"
    },
    {
      id: 4,
      name: "demo-video.mp4",
      size: "125 MB",
      type: "video",
      modified: "1 week ago",
      author: "Sarah Wilson"
    }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'away': return 'bg-yellow-500';
      case 'offline': return 'bg-gray-400';
      default: return 'bg-gray-400';
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'warning': return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case 'message': return <Mail className="h-4 w-4 text-blue-500" />;
      default: return <Circle className="h-4 w-4 text-gray-500" />;
    }
  };

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'pdf': return <FileText className="h-5 w-5 text-red-500" />;
      case 'design': return <Image className="h-5 w-5 text-purple-500" />;
      case 'presentation': return <FileText className="h-5 w-5 text-orange-500" />;
      case 'video': return <Video className="h-5 w-5 text-blue-500" />;
      default: return <FileText className="h-5 w-5 text-gray-500" />;
    }
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">List Group</h1>
            <p className="text-muted-foreground">Flexible component for displaying lists of content in various formats.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Basic List */}
          <Card>
            <CardHeader>
              <CardTitle>Basic List</CardTitle>
              <CardDescription>Simple list with basic items and hover effects.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg divide-y">
                {basicItems.map((item, index) => (
                  <div
                    key={index}
                    className="px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* List with Badges */}
          <Card>
            <CardHeader>
              <CardTitle>List with Badges</CardTitle>
              <CardDescription>List items with status badges and counts.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg divide-y">
                <div className="px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
                  <span>Inbox</span>
                  <Badge variant="default">14</Badge>
                </div>
                <div className="px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
                  <span>Drafts</span>
                  <Badge variant="secondary">3</Badge>
                </div>
                <div className="px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
                  <span>Sent</span>
                  <Badge variant="outline">127</Badge>
                </div>
                <div className="px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
                  <span>Spam</span>
                  <Badge variant="destructive">2</Badge>
                </div>
                <div className="px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
                  <span>Trash</span>
                  <Badge variant="secondary">0</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Contact List */}
          <Card>
            <CardHeader>
              <CardTitle>Contact List</CardTitle>
              <CardDescription>Rich contact list with avatars, status indicators, and detailed information.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg divide-y">
                {contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="px-4 py-4 hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center space-x-4">
                      <div className="relative">
                        <Avatar>
                          <AvatarImage src={contact.avatar} />
                          <AvatarFallback>
                            {contact.name.split(' ').map(n => n[0]).join('')}
                          </AvatarFallback>
                        </Avatar>
                        <div className={cn(
                          "absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background",
                          getStatusColor(contact.status)
                        )} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="font-medium truncate">{contact.name}</p>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <p className="text-sm text-muted-foreground">{contact.role}</p>
                        <div className="flex items-center space-x-4 mt-1 text-sm text-muted-foreground">
                          <div className="flex items-center space-x-1">
                            <Mail className="h-3 w-3" />
                            <span>{contact.email}</span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <Phone className="h-3 w-3" />
                            <span>{contact.phone}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Notification List */}
          <Card>
            <CardHeader>
              <CardTitle>Notification List</CardTitle>
              <CardDescription>List of notifications with icons, timestamps, and read status.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg divide-y">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={cn(
                      "px-4 py-4 hover:bg-muted/50 transition-colors cursor-pointer",
                      !notification.read && "bg-blue-50/50 border-l-4 border-l-blue-500"
                    )}
                  >
                    <div className="flex items-start space-x-3">
                      <div className="flex-shrink-0 mt-1">
                        {getNotificationIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={cn(
                            "text-sm",
                            !notification.read ? "font-semibold" : "font-medium"
                          )}>
                            {notification.title}
                          </p>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs text-muted-foreground">
                              {notification.time}
                            </span>
                            {!notification.read && (
                              <div className="w-2 h-2 bg-blue-500 rounded-full" />
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          {notification.description}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* File List */}
          <Card>
            <CardHeader>
              <CardTitle>File List</CardTitle>
              <CardDescription>File listing with icons, metadata, and action buttons.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg divide-y">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="px-4 py-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center space-x-4">
                      <div className="flex-shrink-0">
                        {getFileIcon(file.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="font-medium truncate">{file.name}</p>
                          <Button variant="ghost" size="sm">
                            <Download className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="flex items-center space-x-4 mt-1 text-sm text-muted-foreground">
                          <span>{file.size}</span>
                          <span>•</span>
                          <span>Modified {file.modified}</span>
                          <span>•</span>
                          <span>by {file.author}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Action List */}
          <Card>
            <CardHeader>
              <CardTitle>Action List</CardTitle>
              <CardDescription>List with clickable actions and hover states.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg divide-y">
                <button className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset">
                  <div className="flex items-center space-x-3">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">View Profile</p>
                      <p className="text-sm text-muted-foreground">See your public profile</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
                  </div>
                </button>
                
                <button className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset">
                  <div className="flex items-center space-x-3">
                    <Mail className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Messages</p>
                      <p className="text-sm text-muted-foreground">View your messages</p>
                    </div>
                    <div className="ml-auto flex items-center space-x-2">
                      <Badge variant="default" className="text-xs">3</Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </button>
                
                <button className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset">
                  <div className="flex items-center space-x-3">
                    <Calendar className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Calendar</p>
                      <p className="text-sm text-muted-foreground">Manage your schedule</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
                  </div>
                </button>
                
                <button className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset">
                  <div className="flex items-center space-x-3">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Locations</p>
                      <p className="text-sm text-muted-foreground">Manage saved locations</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
                  </div>
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
