
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ImageIcon, FileText, User, Package, Calendar } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const ImagePlaceholder = ({ 
  width = "100%", 
  height = "200px", 
  text,
  className 
}: { 
  width?: string; 
  height?: string; 
  text?: string;
  className?: string;
}) => {
  return (
    <div 
      className={cn(
        "bg-muted border-2 border-dashed border-muted-foreground/25 rounded-lg flex flex-col items-center justify-center text-muted-foreground",
        className
      )}
      style={{ width, height }}
    >
      <ImageIcon className="h-8 w-8 mb-2" />
      <span className="text-sm font-medium">
        {text || `${typeof width === 'string' ? width : `${width}px`} × ${typeof height === 'string' ? height : `${height}px`}`}
      </span>
    </div>
  );
};

const TextPlaceholder = ({ 
  lines = 3, 
  className 
}: { 
  lines?: number; 
  className?: string;
}) => {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-4 bg-muted rounded",
            i === lines - 1 ? "w-3/4" : "w-full"
          )}
        />
      ))}
    </div>
  );
};

const CardPlaceholder = ({ showAvatar = false }: { showAvatar?: boolean }) => {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="space-y-4">
          {showAvatar && (
            <div className="flex items-center space-x-4">
              <Skeleton className="h-12 w-12 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-[150px]" />
                <Skeleton className="h-4 w-[100px]" />
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <div className="flex space-x-2">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default function ComponentPlaceholder() {
  const [showContent, setShowContent] = useState(false);
  const [loadingStates, setLoadingStates] = useState({
    cards: true,
    images: true,
    text: true
  });

  const toggleLoading = (type: keyof typeof loadingStates) => {
    setLoadingStates(prev => ({ ...prev, [type]: !prev[type] }));
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Placeholder</h1>
            <p className="text-muted-foreground">Placeholder components for loading states and empty content areas.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Image Placeholders */}
          <Card>
            <CardHeader>
              <CardTitle>Image Placeholders</CardTitle>
              <CardDescription>Placeholder components for missing or loading images.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <h4 className="font-medium">Small Image</h4>
                  <ImagePlaceholder width="150px" height="100px" />
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium">Medium Image</h4>
                  <ImagePlaceholder width="200px" height="150px" />
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium">Large Image</h4>
                  <ImagePlaceholder width="100%" height="200px" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Text Placeholders */}
          <Card>
            <CardHeader>
              <CardTitle>Text Placeholders</CardTitle>
              <CardDescription>Loading placeholders for text content using skeleton components.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="space-y-2">
                  <h4 className="font-medium">Paragraph Placeholder</h4>
                  <TextPlaceholder lines={4} />
                </div>
                
                <div className="space-y-2">
                  <h4 className="font-medium">Title and Content</h4>
                  <div className="space-y-3">
                    <Skeleton className="h-6 w-1/3" />
                    <TextPlaceholder lines={3} />
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium">List Items</h4>
                  <div className="space-y-2">
                    {Array.from({ length: 4 }, (_, i) => (
                      <div key={i} className="flex items-center space-x-3">
                        <Skeleton className="h-4 w-4 rounded" />
                        <Skeleton className="h-4 flex-1" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card Placeholders */}
          <Card>
            <CardHeader>
              <CardTitle>Card Placeholders</CardTitle>
              <CardDescription>Complete card loading states with various layouts.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h4 className="font-medium">Basic Card</h4>
                  <CardPlaceholder />
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium">Card with Avatar</h4>
                  <CardPlaceholder showAvatar />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Interactive Loading States */}
          <Card>
            <CardHeader>
              <CardTitle>Interactive Loading States</CardTitle>
              <CardDescription>Toggle between loading and loaded states to see the transitions.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="flex gap-2 flex-wrap">
                  <Button 
                    variant="outline" 
                    onClick={() => toggleLoading('cards')}
                  >
                    Toggle Cards {loadingStates.cards ? 'Loaded' : 'Loading'}
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => toggleLoading('images')}
                  >
                    Toggle Images {loadingStates.images ? 'Loaded' : 'Loading'}
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => toggleLoading('text')}
                  >
                    Toggle Text {loadingStates.text ? 'Loaded' : 'Loading'}
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Cards Section */}
                  <div className="space-y-4">
                    <h4 className="font-medium">Cards Section</h4>
                    {loadingStates.cards ? (
                      <div className="space-y-4">
                        <CardPlaceholder />
                        <CardPlaceholder showAvatar />
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <Card>
                          <CardContent className="p-6">
                            <div className="flex items-center space-x-4 mb-4">
                              <Avatar>
                                <AvatarFallback>JD</AvatarFallback>
                              </Avatar>
                              <div>
                                <h5 className="font-medium">John Doe</h5>
                                <p className="text-sm text-muted-foreground">Software Engineer</p>
                              </div>
                            </div>
                            <p className="text-sm">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
                            <div className="flex space-x-2 mt-4">
                              <Badge>React</Badge>
                              <Badge variant="secondary">TypeScript</Badge>
                            </div>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="p-6">
                            <h5 className="font-medium mb-2">Project Update</h5>
                            <p className="text-sm text-muted-foreground">The latest project milestone has been completed successfully. All team members contributed to this achievement.</p>
                            <div className="flex space-x-2 mt-4">
                              <Button size="sm">View</Button>
                              <Button size="sm" variant="outline">Edit</Button>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    )}
                  </div>

                  {/* Content Section */}
                  <div className="space-y-4">
                    <h4 className="font-medium">Content Section</h4>
                    <div className="space-y-4">
                      {loadingStates.images ? (
                        <ImagePlaceholder height="150px" text="Loading image..." />
                      ) : (
                        <div className="h-[150px] bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-medium">
                          Beautiful Gradient Image
                        </div>
                      )}
                      
                      {loadingStates.text ? (
                        <TextPlaceholder lines={5} />
                      ) : (
                        <div>
                          <h5 className="font-medium mb-2">Article Title</h5>
                          <p className="text-sm text-muted-foreground">
                            This is the actual content that loads after the placeholder. 
                            It demonstrates how the loading state transitions to the final content.
                            The user experience is much better with loading states that match 
                            the structure of the final content.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Empty State Placeholders */}
          <Card>
            <CardHeader>
              <CardTitle>Empty State Placeholders</CardTitle>
              <CardDescription>Placeholders for empty or no-data states.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="text-center p-8 border-2 border-dashed border-muted-foreground/25 rounded-lg">
                  <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h4 className="font-medium mb-2">No items found</h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    You don't have any items yet. Create your first item to get started.
                  </p>
                  <Button>Create Item</Button>
                </div>

                <div className="text-center p-8 border-2 border-dashed border-muted-foreground/25 rounded-lg">
                  <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h4 className="font-medium mb-2">No events scheduled</h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    Your calendar is empty. Schedule your first event to see it here.
                  </p>
                  <Button variant="outline">Add Event</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Avatar Placeholders */}
          <Card>
            <CardHeader>
              <CardTitle>Avatar Placeholders</CardTitle>
              <CardDescription>Loading states and placeholders for user avatars.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center space-x-4">
                <div className="space-y-2 text-center">
                  <Skeleton className="h-16 w-16 rounded-full mx-auto" />
                  <p className="text-xs text-muted-foreground">Loading</p>
                </div>
                <div className="space-y-2 text-center">
                  <Avatar className="h-16 w-16">
                    <AvatarFallback>
                      <User className="h-8 w-8" />
                    </AvatarFallback>
                  </Avatar>
                  <p className="text-xs text-muted-foreground">No Image</p>
                </div>
                <div className="space-y-2 text-center">
                  <Avatar className="h-16 w-16">
                    <AvatarFallback>JD</AvatarFallback>
                  </Avatar>
                  <p className="text-xs text-muted-foreground">Initials</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
