
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { useState } from 'react';

export default function ComponentAlerts() {
  const [dismissibleAlerts, setDismissibleAlerts] = useState([true, true, true]);

  const dismissAlert = (index: number) => {
    setDismissibleAlerts(prev => prev.map((alert, i) => i === index ? false : alert));
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Alerts</h1>
            <p className="text-muted-foreground">Provide contextual feedback messages for user actions.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Default Alerts */}
          <Card>
            <CardHeader>
              <CardTitle>Default Alerts</CardTitle>
              <CardDescription>Basic alert variants for different message types.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Information</AlertTitle>
                <AlertDescription>
                  This is an informational alert. It provides helpful context about the current state.
                </AlertDescription>
              </Alert>
              
              <Alert className="border-green-200 bg-green-50 text-green-900">
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>Success</AlertTitle>
                <AlertDescription>
                  Your action was completed successfully! All changes have been saved.
                </AlertDescription>
              </Alert>
              
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                  Something went wrong. Please check your input and try again.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Dismissible Alerts */}
          <Card>
            <CardHeader>
              <CardTitle>Dismissible Alerts</CardTitle>
              <CardDescription>Alerts that can be closed by the user.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {dismissibleAlerts[0] && (
                <Alert className="border-blue-200 bg-blue-50 text-blue-900">
                  <Info className="h-4 w-4" />
                  <AlertTitle>New Feature Available</AlertTitle>
                  <AlertDescription>
                    Check out our latest dashboard improvements in the settings panel.
                  </AlertDescription>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2 h-6 w-6 p-0"
                    onClick={() => dismissAlert(0)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </Alert>
              )}
              
              {dismissibleAlerts[1] && (
                <Alert className="border-yellow-200 bg-yellow-50 text-yellow-900">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>System Maintenance</AlertTitle>
                  <AlertDescription>
                    Scheduled maintenance will occur tonight from 2-4 AM EST.
                  </AlertDescription>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2 h-6 w-6 p-0"
                    onClick={() => dismissAlert(1)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </Alert>
              )}
              
              {dismissibleAlerts[2] && (
                <Alert className="border-purple-200 bg-purple-50 text-purple-900">
                  <CheckCircle className="h-4 w-4" />
                  <AlertTitle>Welcome!</AlertTitle>
                  <AlertDescription>
                    Thank you for joining our platform. Let's get started with your setup.
                  </AlertDescription>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2 h-6 w-6 p-0"
                    onClick={() => dismissAlert(2)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Solid Colored Alerts */}
          <Card>
            <CardHeader>
              <CardTitle>Solid Colored Alerts</CardTitle>
              <CardDescription>Alerts with solid background colors for higher emphasis.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="bg-blue-600 text-white border-blue-600">
                <Info className="h-4 w-4" />
                <AlertTitle>System Update</AlertTitle>
                <AlertDescription>
                  A new version is available. Restart the application to update.
                </AlertDescription>
              </Alert>
              
              <Alert className="bg-green-600 text-white border-green-600">
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>Backup Complete</AlertTitle>
                <AlertDescription>
                  Your data has been successfully backed up to the cloud.
                </AlertDescription>
              </Alert>
              
              <Alert className="bg-red-600 text-white border-red-600">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Critical Error</AlertTitle>
                <AlertDescription>
                  Unable to connect to the server. Please contact support if this persists.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
