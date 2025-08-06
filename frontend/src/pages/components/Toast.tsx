
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, AlertTriangle, Info, X, Mail, Download } from 'lucide-react';

export default function ComponentToast() {
  const { toast } = useToast();

  const showBasicToast = () => {
    toast({
      title: "Notification",
      description: "This is a basic toast notification.",
    });
  };

  const showSuccessToast = () => {
    toast({
      title: "Success!",
      description: "Your changes have been saved successfully.",
      variant: "default",
    });
  };

  const showErrorToast = () => {
    toast({
      title: "Error",
      description: "Something went wrong. Please try again.",
      variant: "destructive",
    });
  };

  const showToastWithAction = () => {
    toast({
      title: "Email sent",
      description: "Your message has been sent to the recipient.",
      action: (
        <Button
          variant="outline"
          size="sm"
          onClick={() => console.log("Undo clicked")}
        >
          Undo
        </Button>
      ),
    });
  };

  const showCustomToast = () => {
    toast({
      title: "New Message",
      description: "You have received a new message from John Doe.",
      action: (
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            Reply
          </Button>
          <Button variant="ghost" size="sm">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ),
    });
  };

  const showPersistentToast = () => {
    toast({
      title: "Download Complete",
      description: "Your file has been downloaded successfully.",
      duration: 10000, // 10 seconds
      action: (
        <Button variant="outline" size="sm">
          Open Folder
        </Button>
      ),
    });
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Toast</h1>
            <p className="text-muted-foreground">A succinct message that is displayed temporarily.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Basic Toast */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Toast</CardTitle>
              <CardDescription>Simple toast notifications with title and description.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 flex-wrap">
                <Button onClick={showBasicToast}>
                  Show Toast
                </Button>
                <Button variant="outline" onClick={showSuccessToast}>
                  Success Toast
                </Button>
                <Button variant="destructive" onClick={showErrorToast}>
                  Error Toast
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Toast with Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Toast with Actions</CardTitle>
              <CardDescription>Toast notifications that include action buttons.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 flex-wrap">
                <Button onClick={showToastWithAction}>
                  Toast with Action
                </Button>
                <Button variant="outline" onClick={showCustomToast}>
                  Custom Toast
                </Button>
                <Button variant="outline" onClick={showPersistentToast}>
                  Long Duration
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Toast Examples */}
          <Card>
            <CardHeader>
              <CardTitle>Common Toast Patterns</CardTitle>
              <CardDescription>Examples of common toast notification patterns.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <h4 className="font-medium">Information Toast</h4>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => toast({
                      title: "New Update Available",
                      description: "Version 2.1.0 is now available for download.",
                      action: (
                        <Button variant="outline" size="sm">
                          Update Now
                        </Button>
                      ),
                    })}
                  >
                    <Info className="mr-2 h-4 w-4" />
                    Show Info Toast
                  </Button>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium">Success Toast</h4>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => toast({
                      title: "Profile Updated",
                      description: "Your profile has been updated successfully.",
                    })}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Show Success Toast
                  </Button>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium">Warning Toast</h4>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => toast({
                      title: "Storage Almost Full",
                      description: "You're using 95% of your storage space.",
                      action: (
                        <Button variant="outline" size="sm">
                          Upgrade
                        </Button>
                      ),
                    })}
                  >
                    <AlertTriangle className="mr-2 h-4 w-4" />
                    Show Warning Toast
                  </Button>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium">Download Toast</h4>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => toast({
                      title: "Download Started",
                      description: "Your file is being downloaded...",
                      duration: 5000,
                      action: (
                        <Button variant="ghost" size="sm">
                          Cancel
                        </Button>
                      ),
                    })}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Show Download Toast
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Multiple Toasts */}
          <Card>
            <CardHeader>
              <CardTitle>Multiple Toasts</CardTitle>
              <CardDescription>Demonstrate multiple toast notifications.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => {
                  toast({
                    title: "First notification",
                    description: "This is the first toast.",
                  });
                  
                  setTimeout(() => {
                    toast({
                      title: "Second notification",
                      description: "This is the second toast.",
                    });
                  }, 1000);
                  
                  setTimeout(() => {
                    toast({
                      title: "Third notification",
                      description: "This is the third toast.",
                    });
                  }, 2000);
                }}
              >
                Show Multiple Toasts
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
