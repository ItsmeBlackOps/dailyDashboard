
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, Settings, User, Heart, Star, Download } from 'lucide-react';

export default function ComponentTooltips() {
  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Tooltips</h1>
            <p className="text-muted-foreground">A popup that displays information related to an element when the element receives keyboard focus or the mouse hovers over it.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <TooltipProvider>
          <div className="grid gap-6">
            {/* Basic Tooltips */}
            <Card>
              <CardHeader>
                <CardTitle>Basic Tooltips</CardTitle>
                <CardDescription>Simple tooltips with text content.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 flex-wrap">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline">Hover me</Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>This is a basic tooltip</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button>
                        <Info className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Information tooltip</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-blue-600 underline cursor-help">Tooltip Link</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>This link has helpful information</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </CardContent>
            </Card>

            {/* Positioned Tooltips */}
            <Card>
              <CardHeader>
                <CardTitle>Positioned Tooltips</CardTitle>
                <CardDescription>Tooltips with different positioning options.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 place-items-center min-h-[200px]">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline">Top</Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>Tooltip on top</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline">Right</Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p>Tooltip on right</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline">Bottom</Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>Tooltip on bottom</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline">Left</Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      <p>Tooltip on left</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </CardContent>
            </Card>

            {/* Rich Content Tooltips */}
            <Card>
              <CardHeader>
                <CardTitle>Rich Content Tooltips</CardTitle>
                <CardDescription>Tooltips with enhanced content including icons and formatting.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 flex-wrap">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline">
                        <User className="mr-2 h-4 w-4" />
                        User Info
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <div className="flex gap-2">
                        <User className="h-4 w-4 mt-0.5" />
                        <div>
                          <p className="font-semibold">John Doe</p>
                          <p className="text-xs text-muted-foreground">Software Engineer</p>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline">
                        <Settings className="mr-2 h-4 w-4" />
                        Settings
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <div className="space-y-1">
                        <p className="font-semibold">Application Settings</p>
                        <p className="text-xs">Configure your preferences, notifications, and account settings.</p>
                      </div>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline">
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="flex items-center gap-2">
                        <Download className="h-4 w-4" />
                        <span>Download file (PDF, 2.4 MB)</span>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </CardContent>
            </Card>

            {/* Interactive Elements with Tooltips */}
            <Card>
              <CardHeader>
                <CardTitle>Interactive Elements</CardTitle>
                <CardDescription>Tooltips on various interactive elements.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="flex gap-4 items-center">
                    <span className="text-sm font-medium">Icon Buttons:</span>
                    <div className="flex gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="icon" variant="outline">
                            <Heart className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Add to favorites</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="icon" variant="outline">
                            <Star className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Rate this item</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="icon" variant="outline">
                            <Settings className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Open settings</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>

                  <div className="flex gap-4 items-center">
                    <span className="text-sm font-medium">Help Text:</span>
                    <div className="flex gap-2 items-center">
                      <span>Password</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>Password must be at least 8 characters long and contain uppercase, lowercase, and special characters.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>

                  <div className="flex gap-4 items-center">
                    <span className="text-sm font-medium">Status Indicators:</span>
                    <div className="flex gap-4 items-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-2 cursor-help">
                            <div className="w-3 h-3 rounded-full bg-green-500"></div>
                            <span className="text-sm">Online</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>User is currently online and available</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-2 cursor-help">
                            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                            <span className="text-sm">Away</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>User is away from keyboard</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-2 cursor-help">
                            <div className="w-3 h-3 rounded-full bg-red-500"></div>
                            <span className="text-sm">Busy</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>User is busy and should not be disturbed</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TooltipProvider>
      </div>
    </DashboardLayout>
  );
}
