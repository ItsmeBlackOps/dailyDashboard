import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Search, Send, MessageSquare, Phone, Video } from 'lucide-react';

interface Message {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
  isOwn: boolean;
}

interface Conversation {
  id: string;
  name: string;
  avatar: string;
  lastMessage: string;
  timestamp: string;
  unread: number;
  status: 'online' | 'offline' | 'away';
}

const Messages = () => {
  const [selectedConversation, setSelectedConversation] = useState<string>('1');
  const [newMessage, setNewMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'John Smith',
      content: 'Hi there! I wanted to follow up on our discussion about the new project proposal.',
      timestamp: '10:30 AM',
      isOwn: false
    },
    {
      id: '2',
      sender: 'You',
      content: 'Thanks for reaching out! I\'ve reviewed the proposal and it looks great.',
      timestamp: '10:32 AM',
      isOwn: true
    },
    {
      id: '3',
      sender: 'John Smith',
      content: 'Thanks for the follow-up on the proposal',
      timestamp: '10:35 AM',
      isOwn: false
    }
  ]);

  const conversations: Conversation[] = [
    {
      id: '1',
      name: 'John Smith',
      avatar: '/placeholder.svg',
      lastMessage: 'Thanks for the follow-up on the proposal',
      timestamp: '2 min ago',
      unread: 2,
      status: 'online'
    },
    {
      id: '2',
      name: 'Sarah Johnson',
      avatar: '/placeholder.svg',
      lastMessage: 'Can we schedule a meeting for next week?',
      timestamp: '1 hour ago',
      unread: 0,
      status: 'away'
    },
    {
      id: '3',
      name: 'Mike Wilson',
      avatar: '/placeholder.svg',
      lastMessage: 'The contract has been signed',
      timestamp: '3 hours ago',
      unread: 1,
      status: 'offline'
    }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'away': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  const handleSendMessage = () => {
    if (newMessage.trim()) {
      const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const newMsg: Message = {
        id: Date.now().toString(),
        sender: 'You',
        content: newMessage.trim(),
        timestamp: currentTime,
        isOwn: true
      };
      
      setMessages(prev => [...prev, newMsg]);
      setNewMessage('');
      console.log('Message sent:', newMessage);
    }
  };

  const filteredConversations = conversations.filter(conv =>
    conv.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">Messages</h1>
          <p className="text-muted-foreground">Stay connected with your team and clients</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[600px]">
          {/* Conversations List */}
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>Conversations</CardTitle>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search conversations..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="space-y-0">
                {filteredConversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`p-4 cursor-pointer hover:bg-muted/50 border-b ${
                      selectedConversation === conv.id ? 'bg-muted' : ''
                    }`}
                    onClick={() => setSelectedConversation(conv.id)}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="relative">
                        <Avatar>
                          <AvatarImage src={conv.avatar} alt={conv.name} />
                          <AvatarFallback>{conv.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                        </Avatar>
                        <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-background ${getStatusColor(conv.status)}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="font-medium truncate">{conv.name}</p>
                          <span className="text-xs text-muted-foreground">{conv.timestamp}</span>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{conv.lastMessage}</p>
                      </div>
                      {conv.unread > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          {conv.unread}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Chat Area */}
          <Card className="col-span-8 flex flex-col">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
              <div className="flex items-center space-x-3">
                <Avatar>
                  <AvatarImage src="/placeholder.svg" alt="John Smith" />
                  <AvatarFallback>JS</AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle className="text-lg">John Smith</CardTitle>
                  <CardDescription>Online</CardDescription>
                </div>
              </div>
              <div className="flex space-x-2">
                <Button variant="outline" size="icon">
                  <Phone className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon">
                  <Video className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <Separator />
            
            {/* Messages */}
            <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.isOwn ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] p-3 rounded-lg ${
                      message.isOwn
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    <p className="text-sm">{message.content}</p>
                    <p className={`text-xs mt-1 ${
                      message.isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground'
                    }`}>
                      {message.timestamp}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>

            {/* Message Input */}
            <Separator />
            <div className="p-4">
              <div className="flex space-x-2">
                <Textarea
                  placeholder="Type your message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  className="flex-1 min-h-[60px] resize-none"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <Button onClick={handleSendMessage} className="self-end">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Messages;
