
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Star, Settings, HelpCircle } from 'lucide-react';

export default function ComponentAccordion() {
  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Accordion</h1>
            <p className="text-muted-foreground">A vertically stacked set of interactive headings.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Basic Accordion */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Accordion</CardTitle>
              <CardDescription>Simple accordion with collapsible content sections.</CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="item-1">
                  <AccordionTrigger>Is it accessible?</AccordionTrigger>
                  <AccordionContent>
                    Yes. It adheres to the WAI-ARIA design pattern and uses semantic HTML elements.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-2">
                  <AccordionTrigger>Is it styled?</AccordionTrigger>
                  <AccordionContent>
                    Yes. It comes with default styles that match the design system but can be customized.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-3">
                  <AccordionTrigger>Is it animated?</AccordionTrigger>
                  <AccordionContent>
                    Yes. It uses CSS transitions for smooth open and close animations.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>

          {/* Multiple Open Panels */}
          <Card>
            <CardHeader>
              <CardTitle>Multiple Open Panels</CardTitle>
              <CardDescription>Accordion allowing multiple panels to be open simultaneously.</CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="multiple" className="w-full">
                <AccordionItem value="item-1">
                  <AccordionTrigger>Features</AccordionTrigger>
                  <AccordionContent>
                    This accordion supports multiple open panels, keyboard navigation, and screen reader support.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-2">
                  <AccordionTrigger>Customization</AccordionTrigger>
                  <AccordionContent>
                    You can customize colors, spacing, animations, and add custom icons or content.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-3">
                  <AccordionTrigger>Implementation</AccordionTrigger>
                  <AccordionContent>
                    Built with Radix UI primitives and styled with Tailwind CSS for maximum flexibility.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>

          {/* Accordion with Icons */}
          <Card>
            <CardHeader>
              <CardTitle>Accordion with Icons</CardTitle>
              <CardDescription>Enhanced accordion with custom icons for each section.</CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="item-1">
                  <AccordionTrigger>
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4" />
                      <span>Premium Features</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    Access advanced analytics, custom themes, priority support, and exclusive integrations.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-2">
                  <AccordionTrigger>
                    <div className="flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      <span>Configuration</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    Customize your dashboard, set preferences, manage integrations, and configure notifications.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-3">
                  <AccordionTrigger>
                    <div className="flex items-center gap-2">
                      <HelpCircle className="h-4 w-4" />
                      <span>Support</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    Get help through our documentation, community forums, or contact our support team directly.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>

          {/* Accordion Inside Card Layout */}
          <Card>
            <CardHeader>
              <CardTitle>Accordion in Card Layout</CardTitle>
              <CardDescription>Accordion component nested within a card for better organization.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                <Card className="border-dashed">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Frequently Asked Questions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Accordion type="single" collapsible>
                      <AccordionItem value="faq-1">
                        <AccordionTrigger>How do I get started?</AccordionTrigger>
                        <AccordionContent>
                          Simply sign up for an account and follow our onboarding guide to set up your first project.
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="faq-2">
                        <AccordionTrigger>What payment methods do you accept?</AccordionTrigger>
                        <AccordionContent>
                          We accept all major credit cards, PayPal, and bank transfers for enterprise accounts.
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="faq-3">
                        <AccordionTrigger>Can I cancel my subscription?</AccordionTrigger>
                        <AccordionContent>
                          Yes, you can cancel your subscription at any time from your account settings.
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
