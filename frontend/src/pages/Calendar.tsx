
import { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar as CalendarIcon, Plus, Clock, MapPin, Users, Trash2, Edit } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, startOfWeek, endOfWeek, addDays, startOfDay, isSameWeek } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface Event {
  id: string;
  title: string;
  date: Date;
  time: string;
  duration: string;
  type: 'meeting' | 'call' | 'demo' | 'follow-up';
  attendees: string[];
  location?: string;
  description?: string;
}

const Calendar = () => {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day'>('month');
  const [events, setEvents] = useState<Event[]>([]);
  const [isEventDialogOpen, setIsEventDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [eventForm, setEventForm] = useState({
    title: '',
    time: '',
    duration: '1 hour',
    type: 'meeting' as Event['type'],
    attendees: '',
    location: '',
    description: ''
  });
  const { toast } = useToast();

  // Load events from localStorage on component mount
  useEffect(() => {
    const savedEvents = localStorage.getItem('calendar-events');
    if (savedEvents) {
      const parsedEvents = JSON.parse(savedEvents).map((event: any) => ({
        ...event,
        date: new Date(event.date)
      }));
      setEvents(parsedEvents);
    }
  }, []);

  // Save events to localStorage whenever events change
  useEffect(() => {
    localStorage.setItem('calendar-events', JSON.stringify(events));
  }, [events]);

  const resetForm = () => {
    setEventForm({
      title: '',
      time: '',
      duration: '1 hour',
      type: 'meeting',
      attendees: '',
      location: '',
      description: ''
    });
    setEditingEvent(null);
  };

  const handleDateClick = (date: Date) => {
    setSelectedDate(date);
    resetForm();
    setIsEventDialogOpen(true);
  };

  const handleSaveEvent = () => {
    if (!eventForm.title || !eventForm.time) {
      toast({
        title: "Error",
        description: "Please fill in title and time",
        variant: "destructive"
      });
      return;
    }

    const newEvent: Event = {
      id: editingEvent?.id || Date.now().toString(),
      title: eventForm.title,
      date: selectedDate,
      time: eventForm.time,
      duration: eventForm.duration,
      type: eventForm.type,
      attendees: eventForm.attendees.split(',').map(a => a.trim()).filter(a => a),
      location: eventForm.location,
      description: eventForm.description
    };

    if (editingEvent) {
      setEvents(prev => prev.map(event => event.id === editingEvent.id ? newEvent : event));
      toast({
        title: "Success",
        description: "Event updated successfully"
      });
    } else {
      setEvents(prev => [...prev, newEvent]);
      toast({
        title: "Success",
        description: "Event added successfully"
      });
    }

    setIsEventDialogOpen(false);
    resetForm();
  };

  const handleEditEvent = (event: Event) => {
    setEditingEvent(event);
    setEventForm({
      title: event.title,
      time: event.time,
      duration: event.duration,
      type: event.type,
      attendees: event.attendees.join(', '),
      location: event.location || '',
      description: event.description || ''
    });
    setSelectedDate(event.date);
    setIsEventDialogOpen(true);
  };

  const handleDeleteEvent = (eventId: string) => {
    setEvents(prev => prev.filter(event => event.id !== eventId));
    toast({
      title: "Success",
      description: "Event deleted successfully"
    });
  };

  const getEventTypeColor = (type: string) => {
    switch (type) {
      case 'meeting': return 'bg-blue-500';
      case 'call': return 'bg-green-500';
      case 'demo': return 'bg-purple-500';
      case 'follow-up': return 'bg-orange-500';
      default: return 'bg-gray-500';
    }
  };

  const getEventTypeBadge = (type: string) => {
    switch (type) {
      case 'meeting': return 'default';
      case 'call': return 'secondary';
      case 'demo': return 'outline';
      case 'follow-up': return 'destructive';
      default: return 'default';
    }
  };

  const getEventsForDate = (date: Date) => {
    return events.filter(event => isSameDay(event.date, date));
  };

  const getTodayEvents = () => {
    return events.filter(event => isSameDay(event.date, new Date()));
  };

  const getUpcomingEvents = () => {
    const today = new Date();
    return events.filter(event => event.date > today).slice(0, 5);
  };

  const getWeekDays = () => {
    const weekStart = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  };

  const getWeekEvents = () => {
    return events.filter(event => isSameWeek(event.date, selectedDate));
  };

  const getDayEvents = () => {
    return events.filter(event => isSameDay(event.date, selectedDate));
  };

  const renderMonthView = () => {
    const monthStart = startOfMonth(selectedDate);
    const monthEnd = endOfMonth(selectedDate);
    const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

    return (
      <div className="grid grid-cols-7 gap-2">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="p-2 text-center font-medium text-muted-foreground">
            {day}
          </div>
        ))}
        {calendarDays.map(day => {
          const dayEvents = getEventsForDate(day);
          return (
            <div
              key={day.toISOString()}
              className={`p-2 min-h-[100px] border rounded-lg cursor-pointer hover:bg-muted/50 ${
                isToday(day) ? 'bg-primary/10 border-primary' : ''
              }`}
              onClick={() => handleDateClick(day)}
            >
              <div className={`text-sm font-medium ${isToday(day) ? 'text-primary' : ''}`}>
                {format(day, 'd')}
              </div>
              <div className="space-y-1 mt-1">
                {dayEvents.slice(0, 2).map(event => (
                  <div
                    key={event.id}
                    className={`text-xs p-1 rounded text-white truncate ${getEventTypeColor(event.type)}`}
                  >
                    {event.title}
                  </div>
                ))}
                {dayEvents.length > 2 && (
                  <div className="text-xs text-muted-foreground">
                    +{dayEvents.length - 2} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderWeekView = () => {
    const weekDays = getWeekDays();
    const weekEvents = getWeekEvents();

    return (
      <div className="grid grid-cols-7 gap-2">
        {weekDays.map(day => {
          const dayEvents = weekEvents.filter(event => isSameDay(event.date, day));
          return (
            <div key={day.toISOString()} className="min-h-[400px]">
              <div className={`p-2 text-center font-medium border-b ${
                isToday(day) ? 'bg-primary/10 text-primary' : ''
              }`}>
                <div>{format(day, 'EEE')}</div>
                <div className="text-lg">{format(day, 'd')}</div>
              </div>
              <div 
                className="p-2 space-y-1 cursor-pointer hover:bg-muted/50 min-h-[350px]"
                onClick={() => handleDateClick(day)}
              >
                {dayEvents.map(event => (
                  <div
                    key={event.id}
                    className={`text-xs p-2 rounded text-white ${getEventTypeColor(event.type)}`}
                  >
                    <div className="font-medium">{event.time}</div>
                    <div>{event.title}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderDayView = () => {
    const dayEvents = getDayEvents();
    const hours = Array.from({ length: 24 }, (_, i) => i);

    return (
      <div className="space-y-2">
        <div className="text-center p-4 border-b">
          <h3 className="text-lg font-medium">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</h3>
        </div>
        <div 
          className="p-4 cursor-pointer hover:bg-muted/50 border rounded"
          onClick={() => handleDateClick(selectedDate)}
        >
          <div className="text-sm text-muted-foreground mb-2">Click to add event</div>
          <div className="space-y-2">
            {dayEvents.map(event => (
              <div key={event.id} className="border-l-4 border-primary pl-3 py-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">{event.title}</h4>
                    <p className="text-sm text-muted-foreground">
                      {event.time} • {event.duration}
                    </p>
                    {event.location && (
                      <p className="text-sm text-muted-foreground flex items-center">
                        <MapPin className="h-3 w-3 mr-1" />
                        {event.location}
                      </p>
                    )}
                  </div>
                  <div className="flex space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditEvent(event);
                      }}
                    >
                      <Edit className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteEvent(event.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-2">Calendar</h1>
            <p className="text-muted-foreground">Manage your meetings and appointments</p>
          </div>
          <Button onClick={() => { resetForm(); setIsEventDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            New Event
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Calendar View */}
          <Card className="col-span-8">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center">
                  <CalendarIcon className="h-5 w-5 mr-2" />
                  {viewMode === 'month' && format(selectedDate, 'MMMM yyyy')}
                  {viewMode === 'week' && `Week of ${format(getWeekDays()[0], 'MMM d')}`}
                  {viewMode === 'day' && format(selectedDate, 'MMMM d, yyyy')}
                </CardTitle>
                <div className="flex space-x-2">
                  <Button
                    variant={viewMode === 'month' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode('month')}
                  >
                    Month
                  </Button>
                  <Button
                    variant={viewMode === 'week' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode('week')}
                  >
                    Week
                  </Button>
                  <Button
                    variant={viewMode === 'day' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode('day')}
                  >
                    Day
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {viewMode === 'month' && renderMonthView()}
              {viewMode === 'week' && renderWeekView()}
              {viewMode === 'day' && renderDayView()}
            </CardContent>
          </Card>

          {/* Sidebar */}
          <div className="col-span-4 space-y-6">
            {/* Today's Events */}
            <Card>
              <CardHeader>
                <CardTitle>Today's Events</CardTitle>
                <CardDescription>{format(new Date(), 'EEEE, MMMM d')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {getTodayEvents().length === 0 ? (
                  <p className="text-muted-foreground text-sm">No events scheduled for today</p>
                ) : (
                  getTodayEvents().map(event => (
                    <div key={event.id} className="border-l-4 border-primary pl-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-sm">{event.title}</h4>
                        <div className="flex space-x-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditEvent(event)}
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteEvent(event.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center text-xs text-muted-foreground space-x-3">
                        <div className="flex items-center">
                          <Clock className="h-3 w-3 mr-1" />
                          {event.time} ({event.duration})
                        </div>
                        {event.location && (
                          <div className="flex items-center">
                            <MapPin className="h-3 w-3 mr-1" />
                            {event.location}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center text-xs text-muted-foreground">
                        <Users className="h-3 w-3 mr-1" />
                        {event.attendees.join(', ') || 'No attendees'}
                      </div>
                      <Badge variant={getEventTypeBadge(event.type) as any}>
                        {event.type}
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Upcoming Events */}
            <Card>
              <CardHeader>
                <CardTitle>Upcoming Events</CardTitle>
                <CardDescription>Next 5 events</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {getUpcomingEvents().map(event => (
                  <div key={event.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-sm">{event.title}</h4>
                      <div className="flex space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditEvent(event)}
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteEvent(event.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(event.date, 'MMM d')} at {event.time}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {event.attendees.join(', ') || 'No attendees'}
                    </div>
                    <Badge variant={getEventTypeBadge(event.type) as any}>
                      {event.type}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Event Dialog */}
        <Dialog open={isEventDialogOpen} onOpenChange={setIsEventDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>{editingEvent ? 'Edit Event' : 'Add New Event'}</DialogTitle>
              <DialogDescription>
                {editingEvent ? 'Update your event details' : `Add a new event for ${format(selectedDate, 'MMMM d, yyyy')}`}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={eventForm.title}
                  onChange={(e) => setEventForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Event title"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="time">Time</Label>
                  <Input
                    id="time"
                    type="time"
                    value={eventForm.time}
                    onChange={(e) => setEventForm(prev => ({ ...prev, time: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="duration">Duration</Label>
                  <Select value={eventForm.duration} onValueChange={(value) => setEventForm(prev => ({ ...prev, duration: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select duration" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15 minutes">15 minutes</SelectItem>
                      <SelectItem value="30 minutes">30 minutes</SelectItem>
                      <SelectItem value="45 minutes">45 minutes</SelectItem>
                      <SelectItem value="1 hour">1 hour</SelectItem>
                      <SelectItem value="1.5 hours">1.5 hours</SelectItem>
                      <SelectItem value="2 hours">2 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="type">Type</Label>
                <Select value={eventForm.type} onValueChange={(value: Event['type']) => setEventForm(prev => ({ ...prev, type: value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meeting">Meeting</SelectItem>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="demo">Demo</SelectItem>
                    <SelectItem value="follow-up">Follow-up</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="attendees">Attendees</Label>
                <Input
                  id="attendees"
                  value={eventForm.attendees}
                  onChange={(e) => setEventForm(prev => ({ ...prev, attendees: e.target.value }))}
                  placeholder="Comma-separated names"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={eventForm.location}
                  onChange={(e) => setEventForm(prev => ({ ...prev, location: e.target.value }))}
                  placeholder="Event location"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={eventForm.description}
                  onChange={(e) => setEventForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Event description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEventDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveEvent}>
                {editingEvent ? 'Update Event' : 'Add Event'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

export default Calendar;
