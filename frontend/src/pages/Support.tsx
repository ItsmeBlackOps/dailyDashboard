
import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LifeBuoy, MessageSquare, Phone, Mail, Clock, CheckCircle, AlertCircle, Search, BookOpen, Video, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface SupportTicket {
  id: string;
  subject: string;
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  created: string;
  lastUpdate: string;
  description: string;
}

interface FAQ {
  id: string;
  question: string;
  answer: string;
  category: string;
}

const Support = () => {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [ticketForm, setTicketForm] = useState({
    subject: '',
    category: '',
    priority: '',
    description: ''
  });

  const tickets: SupportTicket[] = [
    {
      id: 'TKT-001',
      subject: 'Unable to export data to CSV',
      status: 'in-progress',
      priority: 'medium',
      created: '2024-01-15',
      lastUpdate: '2024-01-16',
      description: 'Getting an error when trying to export contact data to CSV format.'
    },
    {
      id: 'TKT-002',
      subject: 'Calendar sync not working',
      status: 'resolved',
      priority: 'high',
      created: '2024-01-10',
      lastUpdate: '2024-01-12',
      description: 'Google Calendar integration stopped syncing events.'
    },
    {
      id: 'TKT-003',
      subject: 'Question about billing',
      status: 'closed',
      priority: 'low',
      created: '2024-01-05',
      lastUpdate: '2024-01-05',
      description: 'Need clarification on the billing cycle and charges.'
    }
  ];

  const faqs: FAQ[] = [
    {
      id: '1',
      question: 'How do I import contacts from a CSV file?',
      answer: 'Go to the Contacts page, click the "Import" button, select your CSV file, and map the columns to the appropriate fields. Make sure your CSV follows our template format.',
      category: 'contacts'
    },
    {
      id: '2',
      question: 'Can I customize the dashboard widgets?',
      answer: 'Yes! You can customize your dashboard by clicking the "Customize" button on the dashboard. You can add, remove, and rearrange widgets to suit your needs.',
      category: 'dashboard'
    },
    {
      id: '3',
      question: 'How do I set up email notifications?',
      answer: 'Navigate to Settings > Notifications to configure your email notification preferences. You can choose which events trigger notifications and set your preferred frequency.',
      category: 'notifications'
    },
    {
      id: '4',
      question: 'What are the different user roles available?',
      answer: 'We offer Admin, Manager, and User roles. Admins have full access, Managers can manage their team and data, and Users have access to their assigned contacts and tasks.',
      category: 'users'
    },
    {
      id: '5',
      question: 'How do I integrate with third-party tools?',
      answer: 'Go to Settings > Integrations to connect with popular tools like Slack, Google Calendar, and Mailchimp. Each integration has specific setup instructions.',
      category: 'integrations'
    }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'destructive';
      case 'in-progress': return 'default';
      case 'resolved': return 'secondary';
      case 'closed': return 'outline';
      default: return 'default';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const handleSubmitTicket = () => {
    if (!ticketForm.subject || !ticketForm.category || !ticketForm.description) {
      toast({
        title: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Support ticket created",
      description: "We'll get back to you within 24 hours.",
    });

    setTicketForm({
      subject: '',
      category: '',
      priority: '',
      description: ''
    });
  };

  const filteredFAQs = faqs.filter(faq =>
    faq.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">Support Center</h1>
          <p className="text-muted-foreground">Get help when you need it - we're here to assist you</p>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 text-blue-600" />
              <h3 className="font-medium">Live Chat</h3>
              <p className="text-sm text-muted-foreground">Chat with our support team</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <Phone className="h-8 w-8 mx-auto mb-2 text-green-600" />
              <h3 className="font-medium">Phone Support</h3>
              <p className="text-sm text-muted-foreground">Call us at (555) 123-4567</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <Mail className="h-8 w-8 mx-auto mb-2 text-purple-600" />
              <h3 className="font-medium">Email Support</h3>
              <p className="text-sm text-muted-foreground">support@pulsecrm.com</p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-6 text-center">
              <BookOpen className="h-8 w-8 mx-auto mb-2 text-orange-600" />
              <h3 className="font-medium">Documentation</h3>
              <p className="text-sm text-muted-foreground">Browse our help docs</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="faq" className="space-y-6">
          <TabsList className="grid w-full lg:w-[600px] grid-cols-4">
            <TabsTrigger value="faq">FAQ</TabsTrigger>
            <TabsTrigger value="tickets">Support Tickets</TabsTrigger>
            <TabsTrigger value="new-ticket">New Ticket</TabsTrigger>
            <TabsTrigger value="resources">Resources</TabsTrigger>
          </TabsList>

          <TabsContent value="faq" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Frequently Asked Questions</CardTitle>
                <CardDescription>Find quick answers to common questions</CardDescription>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search FAQs..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="w-full">
                  {filteredFAQs.map((faq) => (
                    <AccordionItem key={faq.id} value={faq.id}>
                      <AccordionTrigger className="text-left">
                        {faq.question}
                      </AccordionTrigger>
                      <AccordionContent className="text-muted-foreground">
                        {faq.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tickets" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Your Support Tickets</CardTitle>
                <CardDescription>Track the status of your support requests</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {tickets.map((ticket) => (
                    <div key={ticket.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <Badge variant={getStatusColor(ticket.status)}>
                            {ticket.status}
                          </Badge>
                          <div className={`w-2 h-2 rounded-full ${getPriorityColor(ticket.priority)}`} />
                          <span className="font-medium">{ticket.subject}</span>
                        </div>
                        <span className="text-sm text-muted-foreground">#{ticket.id}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{ticket.description}</p>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Created: {ticket.created}</span>
                        <span>Last updated: {ticket.lastUpdate}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="new-ticket" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <LifeBuoy className="h-5 w-5 mr-2" />
                  Create Support Ticket
                </CardTitle>
                <CardDescription>Describe your issue and we'll help you resolve it</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="subject">Subject *</Label>
                    <Input
                      id="subject"
                      placeholder="Brief description of your issue"
                      value={ticketForm.subject}
                      onChange={(e) => setTicketForm({...ticketForm, subject: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="category">Category *</Label>
                    <Select value={ticketForm.category} onValueChange={(value) => setTicketForm({...ticketForm, category: value})}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="technical">Technical Issue</SelectItem>
                        <SelectItem value="billing">Billing Question</SelectItem>
                        <SelectItem value="feature">Feature Request</SelectItem>
                        <SelectItem value="integration">Integration Support</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="priority">Priority</Label>
                    <Select value={ticketForm.priority} onValueChange={(value) => setTicketForm({...ticketForm, priority: value})}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select priority" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description *</Label>
                  <Textarea
                    id="description"
                    placeholder="Please provide detailed information about your issue..."
                    value={ticketForm.description}
                    onChange={(e) => setTicketForm({...ticketForm, description: e.target.value})}
                    className="min-h-[120px]"
                  />
                </div>
                <Button onClick={handleSubmitTicket}>Create Ticket</Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="resources" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <BookOpen className="h-8 w-8 text-blue-600 mb-2" />
                  <CardTitle>User Guide</CardTitle>
                  <CardDescription>Complete guide to using PulseCRM</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full">Read Documentation</Button>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <Video className="h-8 w-8 text-green-600 mb-2" />
                  <CardTitle>Video Tutorials</CardTitle>
                  <CardDescription>Watch step-by-step video guides</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full">Watch Videos</Button>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <Users className="h-8 w-8 text-purple-600 mb-2" />
                  <CardTitle>Community Forum</CardTitle>
                  <CardDescription>Connect with other users</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" className="w-full">Join Community</Button>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>System Status</CardTitle>
                <CardDescription>Current status of our services</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <span>API Services</span>
                    </div>
                    <Badge variant="secondary">Operational</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <span>Database</span>
                    </div>
                    <Badge variant="secondary">Operational</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <AlertCircle className="h-5 w-5 text-yellow-600" />
                      <span>Email Service</span>
                    </div>
                    <Badge variant="outline">Maintenance</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Support;
