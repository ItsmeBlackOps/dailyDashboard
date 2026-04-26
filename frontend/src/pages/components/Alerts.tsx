
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
              
              <Alert className="border-aurora-emerald/30 bg-aurora-emerald/10 text-foreground">
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
                <Alert className="border-primary/30 bg-accent text-foreground">
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
                <Alert className="border-aurora-amber/30 bg-aurora-amber/10 text-foreground">
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
                <Alert className="border-aurora-violet/30 bg-aurora-violet/10 text-foreground">
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
              <Alert className="bg-primary text-primary-foreground border-primary">
                <Info className="h-4 w-4" />
                <AlertTitle>System Update</AlertTitle>
                <AlertDescription>
                  A new version is available. Restart the application to update.
                </AlertDescription>
              </Alert>
              
              <Alert className="bg-aurora-emerald text-white border-aurora-emerald">
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>Backup Complete</AlertTitle>
                <AlertDescription>
                  Your data has been successfully backed up to the cloud.
                </AlertDescription>
              </Alert>
              
              <Alert className="bg-destructive text-destructive-foreground border-destructive">
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
