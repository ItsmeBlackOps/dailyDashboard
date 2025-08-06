
import { Phone, Mail, MapPin, Building, Calendar, DollarSign, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  position: string;
  status: 'active' | 'inactive' | 'lead';
  lastContact: string;
  value: number;
  avatar?: string;
}

interface ContactDetailsProps {
  contact: Contact;
}

export function ContactDetails({ contact }: ContactDetailsProps) {
  const getStatusBadge = (status: string) => {
    const variants = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-gray-100 text-gray-800',
      lead: 'bg-blue-100 text-blue-800'
    };
    return variants[status as keyof typeof variants] || variants.active;
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex items-start gap-4">
        <Avatar className="h-16 w-16">
          <AvatarImage src={contact.avatar} alt={contact.name} />
          <AvatarFallback className="text-lg">
            {contact.name.split(' ').map(n => n[0]).join('')}
          </AvatarFallback>
        </Avatar>
        
        <div className="flex-1">
          <h2 className="text-2xl font-bold">{contact.name}</h2>
          <p className="text-muted-foreground flex items-center gap-2">
            <Building className="h-4 w-4" />
            {contact.position} at {contact.company}
          </p>
          <div className="mt-2">
            <Badge className={getStatusBadge(contact.status)}>
              {contact.status}
            </Badge>
          </div>
        </div>
      </div>

      <Separator />

      {/* Contact Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <p className="font-medium">{contact.email}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Phone</p>
                <p className="font-medium">{contact.phone}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <Building className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Company</p>
                <p className="font-medium">{contact.company}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <User className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Position</p>
                <p className="font-medium">{contact.position}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Deal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Deal Value</p>
                <p className="font-medium text-lg">${contact.value.toLocaleString()}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Last Contact</p>
                <p className="font-medium">
                  {new Date(contact.lastContact).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <User className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <Badge className={getStatusBadge(contact.status)}>
                  {contact.status}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-start gap-3 text-sm">
              <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
              <div>
                <p className="font-medium">Email sent</p>
                <p className="text-muted-foreground">Sent follow-up email about proposal</p>
                <p className="text-xs text-muted-foreground">2 days ago</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3 text-sm">
              <div className="w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
              <div>
                <p className="font-medium">Meeting scheduled</p>
                <p className="text-muted-foreground">Demo call scheduled for next week</p>
                <p className="text-xs text-muted-foreground">5 days ago</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3 text-sm">
              <div className="w-2 h-2 bg-orange-500 rounded-full mt-2"></div>
              <div>
                <p className="font-medium">Note added</p>
                <p className="text-muted-foreground">Initial contact made, interested in our services</p>
                <p className="text-xs text-muted-foreground">1 week ago</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
