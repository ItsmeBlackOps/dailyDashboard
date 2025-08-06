
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Download, Upload } from 'lucide-react';
import { useState } from 'react';

export default function ComponentSpinners() {
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const simulateLoading = (setter: React.Dispatch<React.SetStateAction<boolean>>, duration = 3000) => {
    setter(true);
    setTimeout(() => setter(false), duration);
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Spinners</h1>
            <p className="text-muted-foreground">Loading indicators to show ongoing processes.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Basic Spinners */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Spinners</CardTitle>
              <CardDescription>Simple loading indicators in different sizes.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-8 flex-wrap">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-xs text-muted-foreground">Small</span>
                </div>
                
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="text-xs text-muted-foreground">Medium</span>
                </div>
                
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <span className="text-xs text-muted-foreground">Large</span>
                </div>
                
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-12 w-12 animate-spin" />
                  <span className="text-xs text-muted-foreground">Extra Large</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Colored Spinners */}
          <Card>
            <CardHeader>
              <CardTitle>Colored Spinners</CardTitle>
              <CardDescription>Spinners with different colors for various contexts.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-8 flex-wrap">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Primary</span>
                </div>
                
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-6 w-6 animate-spin text-green-600" />
                  <span className="text-xs text-muted-foreground">Success</span>
                </div>
                
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-6 w-6 animate-spin text-yellow-600" />
                  <span className="text-xs text-muted-foreground">Warning</span>
                </div>
                
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-6 w-6 animate-spin text-red-600" />
                  <span className="text-xs text-muted-foreground">Danger</span>
                </div>
                
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                  <span className="text-xs text-muted-foreground">Info</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Different Spinner Icons */}
          <Card>
            <CardHeader>
              <CardTitle>Different Spinner Icons</CardTitle>
              <CardDescription>Various icons that can be used as loading indicators.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-8 flex-wrap">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="text-xs text-muted-foreground">Loader2</span>
                </div>
                
                <div className="flex flex-col items-center gap-2">
                  <RefreshCw className="h-6 w-6 animate-spin" />
                  <span className="text-xs text-muted-foreground">RefreshCw</span>
                </div>
                
                <div className="flex flex-col items-center gap-2">
                  <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-muted-foreground">Border Spinner</span>
                </div>
                
                <div className="flex flex-col items-center gap-2">
                  <div className="h-6 w-6 border-2 border-dashed border-primary rounded-full animate-spin" />
                  <span className="text-xs text-muted-foreground">Dashed Border</span>
                </div>
                
                <div className="flex flex-col items-center gap-2">
                  <div className="flex space-x-1">
                    <div className="h-2 w-2 bg-primary rounded-full animate-bounce" />
                    <div className="h-2 w-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <div className="h-2 w-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  </div>
                  <span className="text-xs text-muted-foreground">Dots</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Spinners in Buttons */}
          <Card>
            <CardHeader>
              <CardTitle>Spinners in Buttons</CardTitle>
              <CardDescription>Loading states for interactive elements.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 flex-wrap">
                <Button 
                  disabled={loading}
                  onClick={() => simulateLoading(setLoading)}
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {loading ? "Loading..." : "Load Data"}
                </Button>
                
                <Button 
                  variant="outline"
                  disabled={downloading}
                  onClick={() => simulateLoading(setDownloading)}
                >
                  {downloading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </>
                  )}
                </Button>
                
                <Button 
                  variant="secondary"
                  disabled={uploading}
                  onClick={() => simulateLoading(setUploading)}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload
                    </>
                  )}
                </Button>
                
                <Button size="icon" disabled={loading}>
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Loading Overlays */}
          <Card>
            <CardHeader>
              <CardTitle>Loading Overlays</CardTitle>
              <CardDescription>Full-width loading states for content areas.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Center Loading */}
                <div className="relative border rounded-lg p-8 min-h-[200px] bg-muted/20">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Loading content...</p>
                    </div>
                  </div>
                </div>
                
                {/* Loading with Backdrop */}
                <div className="relative border rounded-lg overflow-hidden">
                  <div className="p-6 space-y-4">
                    <h3 className="text-lg font-semibold">Content Area</h3>
                    <p className="text-muted-foreground">This content is currently loading...</p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="h-20 bg-muted rounded" />
                      <div className="h-20 bg-muted rounded" />
                      <div className="h-20 bg-muted rounded" />
                    </div>
                  </div>
                  
                  {/* Loading Overlay */}
                  <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-8 w-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm font-medium">Processing...</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Custom CSS Spinners */}
          <Card>
            <CardHeader>
              <CardTitle>Custom CSS Spinners</CardTitle>
              <CardDescription>Creative loading animations using CSS.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-8 flex-wrap">
                {/* Pulse Spinner */}
                <div className="flex flex-col items-center gap-2">
                  <div className="h-6 w-6 bg-primary rounded-full animate-pulse" />
                  <span className="text-xs text-muted-foreground">Pulse</span>
                </div>
                
                {/* Ping Spinner */}
                <div className="flex flex-col items-center gap-2">
                  <div className="relative h-6 w-6">
                    <div className="absolute h-6 w-6 bg-primary rounded-full animate-ping" />
                    <div className="absolute h-6 w-6 bg-primary rounded-full" />
                  </div>
                  <span className="text-xs text-muted-foreground">Ping</span>
                </div>
                
                {/* Gradient Spinner */}
                <div className="flex flex-col items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-gradient-to-r from-primary to-primary/30 animate-spin" 
                       style={{ background: 'conic-gradient(from 0deg, transparent, hsl(var(--primary)))' }} />
                  <span className="text-xs text-muted-foreground">Gradient</span>
                </div>
                
                {/* Square Spinner */}
                <div className="flex flex-col items-center gap-2">
                  <div className="h-6 w-6 border-2 border-primary border-t-transparent animate-spin" />
                  <span className="text-xs text-muted-foreground">Square</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
