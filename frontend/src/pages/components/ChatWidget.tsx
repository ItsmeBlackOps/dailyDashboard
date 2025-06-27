
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  MessageCircle, 
  X, 
  Send, 
  Paperclip, 
  Smile,
  Phone,
  Video,
  MoreVertical,
  Minimize2,
  Maximize2
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'agent';
  timestamp: Date;
  avatar?: string;
  name?: string;
}

const ChatWidget = ({ 
  position = 'bottom-right',
  theme = 'light' 
}: { 
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  theme?: 'light' | 'dark';
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: 'Hello! How can I help you today?',
      sender: 'agent',
      timestamp: new Date(),
      name: 'Sarah',
      avatar: '/placeholder.svg'
    }
  ]);

  const positionClasses = {
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4'
  };

  const sendMessage = () => {
    if (!message.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      text: message,
      sender: 'user',
      timestamp: new Date(),
      name: 'You'
    };

    setMessages(prev => [...prev, newMessage]);
    setMessage('');

    // Simulate agent response
    setTimeout(() => {
      const agentMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: 'Thanks for your message! I\'ll get back to you shortly.',
        sender: 'agent',
        timestamp: new Date(),
        name: 'Sarah',
        avatar: '/placeholder.svg'
      };
      setMessages(prev => [...prev, agentMessage]);
    }, 1000);
  };

  return (
    <div className={cn('fixed z-50', positionClasses[position])}>
      {/* Chat Toggle Button */}
      {!isOpen && (
        <Button
          onClick={() => setIsOpen(true)}
          className="rounded-full w-14 h-14 shadow-lg"
          size="icon"
        >
          <MessageCircle className="h-6 w-6" />
        </Button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className={cn(
          'w-80 h-96 bg-background border rounded-lg shadow-xl flex flex-col',
          theme === 'dark' && 'dark',
          isMinimized && 'h-12'
        )}>
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b bg-primary text-primary-foreground rounded-t-lg">
            <div className="flex items-center gap-2">
              <Avatar className="w-8 h-8">
                <AvatarImage src="/placeholder.svg" />
                <AvatarFallback>S</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium text-sm">Sarah</p>
                <p className="text-xs opacity-90">Online</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/20"
                onClick={() => setIsMinimized(!isMinimized)}
              >
                {isMinimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/20"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Messages */}
              <ScrollArea className="flex-1 p-3">
                <div className="space-y-3">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        'flex gap-2',
                        msg.sender === 'user' ? 'justify-end' : 'justify-start'
                      )}
                    >
                      {msg.sender === 'agent' && (
                        <Avatar className="w-6 h-6">
                          <AvatarImage src={msg.avatar} />
                          <AvatarFallback>{msg.name?.[0]}</AvatarFallback>
                        </Avatar>
                      )}
                      <div
                        className={cn(
                          'max-w-[70%] p-2 rounded-lg text-sm',
                          msg.sender === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        )}
                      >
                        <p>{msg.text}</p>
                        <p className="text-xs opacity-70 mt-1">
                          {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Input */}
              <div className="p-3 border-t">
                <div className="flex gap-2">
                  <Input
                    placeholder="Type a message..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                    className="flex-1"
                  />
                  <Button size="icon" onClick={sendMessage}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default function ComponentChatWidget() {
  const [widgetPosition, setWidgetPosition] = useState<'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'>('bottom-right');

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Chat Widget</h1>
            <p className="text-muted-foreground">Floating chat widget components for customer support and communication.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Basic Chat Widget */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Chat Widget</CardTitle>
              <CardDescription>A floating chat widget with messaging functionality.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative h-64 bg-muted rounded-lg overflow-hidden">
                <p className="absolute top-4 left-4 text-sm text-muted-foreground">
                  Website content area (check bottom-right corner)
                </p>
                <ChatWidget position={widgetPosition} />
              </div>
            </CardContent>
          </Card>

          {/* Position Controls */}
          <Card>
            <CardHeader>
              <CardTitle>Widget Positioning</CardTitle>
              <CardDescription>Control where the chat widget appears on the screen.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex gap-2 flex-wrap">
                  <Button 
                    variant={widgetPosition === 'bottom-right' ? 'default' : 'outline'}
                    onClick={() => setWidgetPosition('bottom-right')}
                  >
                    Bottom Right
                  </Button>
                  <Button 
                    variant={widgetPosition === 'bottom-left' ? 'default' : 'outline'}
                    onClick={() => setWidgetPosition('bottom-left')}
                  >
                    Bottom Left
                  </Button>
                  <Button 
                    variant={widgetPosition === 'top-right' ? 'default' : 'outline'}
                    onClick={() => setWidgetPosition('top-right')}
                  >
                    Top Right
                  </Button>
                  <Button 
                    variant={widgetPosition === 'top-left' ? 'default' : 'outline'}
                    onClick={() => setWidgetPosition('top-left')}
                  >
                    Top Left
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Chat Interface Preview */}
          <Card>
            <CardHeader>
              <CardTitle>Chat Interface</CardTitle>
              <CardDescription>Full chat interface without floating positioning.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full max-w-md mx-auto bg-background border rounded-lg shadow-lg flex flex-col h-96">
                {/* Header */}
                <div className="flex items-center justify-between p-3 border-b bg-primary text-primary-foreground rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <Avatar className="w-8 h-8">
                      <AvatarImage src="/placeholder.svg" />
                      <AvatarFallback>S</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-sm">Support Team</p>
                      <p className="text-xs opacity-90">Typically replies in a few minutes</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/20"
                    >
                      <Phone className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/20"
                    >
                      <Video className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/20"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Messages */}
                <ScrollArea className="flex-1 p-3">
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <Avatar className="w-6 h-6">
                        <AvatarImage src="/placeholder.svg" />
                        <AvatarFallback>S</AvatarFallback>
                      </Avatar>
                      <div className="bg-muted p-2 rounded-lg text-sm max-w-[70%]">
                        <p>Hello! Welcome to our support chat. How can I help you today?</p>
                        <p className="text-xs opacity-70 mt-1">2:30 PM</p>
                      </div>
                    </div>

                    <div className="flex gap-2 justify-end">
                      <div className="bg-primary text-primary-foreground p-2 rounded-lg text-sm max-w-[70%]">
                        <p>Hi! I'm having trouble with my account settings.</p>
                        <p className="text-xs opacity-70 mt-1">2:31 PM</p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Avatar className="w-6 h-6">
                        <AvatarImage src="/placeholder.svg" />
                        <AvatarFallback>S</AvatarFallback>
                      </Avatar>
                      <div className="bg-muted p-2 rounded-lg text-sm max-w-[70%]">
                        <p>I'd be happy to help you with your account settings. Could you please tell me what specific issue you're experiencing?</p>
                        <p className="text-xs opacity-70 mt-1">2:32 PM</p>
                      </div>
                    </div>

                    <div className="flex gap-2 justify-end">
                      <div className="bg-primary text-primary-foreground p-2 rounded-lg text-sm max-w-[70%]">
                        <p>I can't seem to update my profile picture.</p>
                        <p className="text-xs opacity-70 mt-1">2:33 PM</p>
                      </div>
                    </div>
                  </div>
                </ScrollArea>

                {/* Input */}
                <div className="p-3 border-t">
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Paperclip className="h-4 w-4" />
                    </Button>
                    <Input
                      placeholder="Type your message..."
                      className="flex-1"
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Smile className="h-4 w-4" />
                    </Button>
                    <Button size="icon" className="h-8 w-8">
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Features Overview */}
          <Card>
            <CardHeader>
              <CardTitle>Chat Widget Features</CardTitle>
              <CardDescription>Key features and capabilities of the chat widget component.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-primary" />
                    Real-time Messaging
                  </h4>
                  <p className="text-sm text-muted-foreground">Send and receive messages in real-time with smooth animations.</p>
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2">
                    <Minimize2 className="h-4 w-4 text-primary" />
                    Minimize/Maximize
                  </h4>
                  <p className="text-sm text-muted-foreground">Users can minimize the chat while keeping it accessible.</p>
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2">
                    <Avatar className="h-4 w-4">
                      <AvatarFallback className="text-xs">A</AvatarFallback>
                    </Avatar>
                    Agent Profiles
                  </h4>
                  <p className="text-sm text-muted-foreground">Display agent information with avatars and status indicators.</p>
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2">
                    <Paperclip className="h-4 w-4 text-primary" />
                    File Attachments
                  </h4>
                  <p className="text-sm text-muted-foreground">Support for file uploads and media sharing.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
