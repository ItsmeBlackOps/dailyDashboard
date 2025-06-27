
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  X,
  AlertTriangle,
  CheckCircle,
  Info,
  Plus,
  Edit,
  Trash2,
  Download,
  Upload,
  Settings
} from 'lucide-react';
import { useState } from 'react';

const ConfirmationModal = ({ 
  title, 
  description, 
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "default"
}: {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
}) => {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant === "destructive" ? "destructive" : "outline"}>
          {variant === "destructive" ? (
            <>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Item
            </>
          ) : (
            <>
              <CheckCircle className="mr-2 h-4 w-4" />
              Confirm Action
            </>
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {variant === "destructive" ? (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            ) : (
              <Info className="h-5 w-5 text-primary" />
            )}
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelText}</AlertDialogCancel>
          <AlertDialogAction 
            className={variant === "destructive" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default function ComponentModals() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: ''
  });

  const handleFormSubmit = () => {
    console.log('Form submitted:', formData);
    setIsFormOpen(false);
    setFormData({ name: '', email: '', message: '' });
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Modals</h1>
            <p className="text-muted-foreground">Modal dialog components for displaying overlay content and user interactions.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Basic Modals */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Modals</CardTitle>
              <CardDescription>Simple modal dialogs with different content types.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 flex-wrap">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline">
                      <Info className="mr-2 h-4 w-4" />
                      Information Modal
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Information</DialogTitle>
                      <DialogDescription>
                        This is a basic information modal. It can be used to display important information to users.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <p className="text-sm text-muted-foreground">
                        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor 
                        incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud 
                        exercitation ullamco laboris.
                      </p>
                    </div>
                    <DialogFooter>
                      <Button type="button">Got it</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog>
                  <DialogTrigger asChild>
                    <Button>
                      <Settings className="mr-2 h-4 w-4" />
                      Settings Modal
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                      <DialogTitle>Settings</DialogTitle>
                      <DialogDescription>
                        Make changes to your profile here. Click save when you're done.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="name" className="text-right">
                          Name
                        </Label>
                        <Input id="name" defaultValue="John Doe" className="col-span-3" />
                      </div>
                      <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="username" className="text-right">
                          Username
                        </Label>
                        <Input id="username" defaultValue="@johndoe" className="col-span-3" />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="submit">Save changes</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="secondary">
                      <Upload className="mr-2 h-4 w-4" />
                      Upload Modal
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Upload Files</DialogTitle>
                      <DialogDescription>
                        Select files to upload to your account.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                        <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground mb-2">
                          Drag and drop files here, or click to select files
                        </p>
                        <Button variant="outline" size="sm">
                          Browse Files
                        </Button>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline">Cancel</Button>
                      <Button>Upload</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>

          {/* Confirmation Modals */}
          <Card>
            <CardHeader>
              <CardTitle>Confirmation Modals</CardTitle>
              <CardDescription>Alert dialogs for confirmations and destructive actions.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 flex-wrap">
                <ConfirmationModal
                  title="Confirm Action"
                  description="Are you sure you want to proceed with this action? This cannot be undone."
                  confirmText="Yes, Continue"
                  cancelText="Cancel"
                />

                <ConfirmationModal
                  title="Delete Item"
                  description="This action cannot be undone. This will permanently delete the item and remove all associated data."
                  confirmText="Yes, Delete"
                  cancelText="Cancel"
                  variant="destructive"
                />

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline">
                      <Download className="mr-2 h-4 w-4" />
                      Download Confirmation
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Download File</AlertDialogTitle>
                      <AlertDialogDescription>
                        You are about to download a 150MB file. This may take some time depending on your internet connection.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction>Start Download</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>

          {/* Form Modal */}
          <Card>
            <CardHeader>
              <CardTitle>Form Modal</CardTitle>
              <CardDescription>Modal with form inputs and validation.</CardDescription>
            </CardHeader>
            <CardContent>
              <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Contact Form
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>Contact Us</DialogTitle>
                    <DialogDescription>
                      Send us a message and we'll get back to you as soon as possible.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="contact-name">Name</Label>
                      <Input 
                        id="contact-name" 
                        placeholder="Your full name"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contact-email">Email</Label>
                      <Input 
                        id="contact-email" 
                        type="email" 
                        placeholder="your.email@example.com"
                        value={formData.email}
                        onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contact-message">Message</Label>
                      <Textarea 
                        id="contact-message" 
                        placeholder="Type your message here..."
                        className="min-h-[100px]"
                        value={formData.message}
                        onChange={(e) => setFormData(prev => ({ ...prev, message: e.target.value }))}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsFormOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleFormSubmit}>
                      Send Message
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* Large Content Modal */}
          <Card>
            <CardHeader>
              <CardTitle>Large Content Modal</CardTitle>
              <CardDescription>Modal with scrollable content for longer text or lists.</CardDescription>
            </CardHeader>
            <CardContent>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Edit className="mr-2 h-4 w-4" />
                    Terms & Conditions
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
                  <DialogHeader>
                    <DialogTitle>Terms and Conditions</DialogTitle>
                    <DialogDescription>
                      Please read our terms and conditions carefully.
                    </DialogDescription>
                  </DialogHeader>
                  <ScrollArea className="max-h-[400px] pr-4">
                    <div className="space-y-4 text-sm">
                      <div>
                        <h4 className="font-semibold mb-2">1. Acceptance of Terms</h4>
                        <p className="text-muted-foreground">
                          By accessing and using this website, you accept and agree to be bound by the terms 
                          and provision of this agreement. If you do not agree to abide by the above, 
                          please do not use this service.
                        </p>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-2">2. Use License</h4>
                        <p className="text-muted-foreground">
                          Permission is granted to temporarily download one copy of the materials on our 
                          website for personal, non-commercial transitory viewing only. This is the grant 
                          of a license, not a transfer of title.
                        </p>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-2">3. Disclaimer</h4>
                        <p className="text-muted-foreground">
                          The materials on our website are provided on an 'as is' basis. We make no warranties, 
                          expressed or implied, and hereby disclaim and negate all other warranties including 
                          without limitation, implied warranties or conditions of merchantability.
                        </p>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-2">4. Limitations</h4>
                        <p className="text-muted-foreground">
                          In no event shall our company or its suppliers be liable for any damages (including, 
                          without limitation, damages for loss of data or profit, or due to business interruption) 
                          arising out of the use or inability to use the materials on our website.
                        </p>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-2">5. Privacy Policy</h4>
                        <p className="text-muted-foreground">
                          Your privacy is important to us. Our Privacy Policy explains how we collect, use, 
                          and protect your information when you use our service. By using our service, 
                          you agree to the collection and use of information in accordance with this policy.
                        </p>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-2">6. Changes to Terms</h4>
                        <p className="text-muted-foreground">
                          We reserve the right to revise these terms of service at any time without notice. 
                          By using this website, you are agreeing to be bound by the then current version 
                          of these terms of service.
                        </p>
                      </div>
                    </div>
                  </ScrollArea>
                  <DialogFooter>
                    <Button variant="outline">Decline</Button>
                    <Button>Accept Terms</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* Modal Sizes */}
          <Card>
            <CardHeader>
              <CardTitle>Modal Sizes</CardTitle>
              <CardDescription>Different modal sizes for various content types.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 flex-wrap">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">Small Modal</Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[300px]">
                    <DialogHeader>
                      <DialogTitle>Small Modal</DialogTitle>
                      <DialogDescription>
                        This is a compact modal for simple confirmations.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button size="sm">OK</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline">Medium Modal</Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                      <DialogTitle>Medium Modal</DialogTitle>
                      <DialogDescription>
                        This is the default modal size, suitable for most content.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <p className="text-sm text-muted-foreground">
                        Medium modals work well for forms, settings, and detailed information.
                      </p>
                    </div>
                    <DialogFooter>
                      <Button>Continue</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline">Large Modal</Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[700px]">
                    <DialogHeader>
                      <DialogTitle>Large Modal</DialogTitle>
                      <DialogDescription>
                        This modal provides more space for complex content and layouts.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <h4 className="font-medium">Left Column</h4>
                          <p className="text-sm text-muted-foreground">
                            Large modals can accommodate complex layouts with multiple columns.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <h4 className="font-medium">Right Column</h4>
                          <p className="text-sm text-muted-foreground">
                            This makes them perfect for detailed forms or data displays.
                          </p>
                        </div>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline">Cancel</Button>
                      <Button>Save</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
