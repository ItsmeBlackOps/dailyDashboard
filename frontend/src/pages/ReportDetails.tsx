
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, Save, Play, Download } from 'lucide-react';
import { Link } from 'react-router-dom';

const ReportDetails = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          <Button variant="outline" size="icon" asChild>
            <Link to="/reports">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Report Details</h1>
            <p className="text-muted-foreground">Create or edit report configuration</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
                <CardDescription>Configure the basic report settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Report Name</Label>
                  <Input id="name" placeholder="Enter report name" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="type">Report Type</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sales">Sales Report</SelectItem>
                        <SelectItem value="leads">Lead Report</SelectItem>
                        <SelectItem value="pipeline">Pipeline Report</SelectItem>
                        <SelectItem value="activity">Activity Report</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="frequency">Frequency</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Select frequency" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="biweekly">Bi-weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="quarterly">Quarterly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" placeholder="Report description" rows={3} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Data Sources & Filters</CardTitle>
                <CardDescription>Configure what data to include in the report</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <Label>Data Sources</Label>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox id="deals" />
                      <Label htmlFor="deals">Deals</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="leads" />
                      <Label htmlFor="leads">Leads</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="contacts" />
                      <Label htmlFor="contacts">Contacts</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="activities" />
                      <Label htmlFor="activities">Activities</Label>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="dateFrom">Date From</Label>
                    <Input id="dateFrom" type="date" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dateTo">Date To</Label>
                    <Input id="dateTo" type="date" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="owner">Filter by Owner</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="All owners" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Owners</SelectItem>
                      <SelectItem value="john">John Smith</SelectItem>
                      <SelectItem value="sarah">Sarah Johnson</SelectItem>
                      <SelectItem value="mike">Mike Wilson</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Output Settings</CardTitle>
                <CardDescription>Configure how the report should be delivered</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="format">Output Format</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Select format" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pdf">PDF</SelectItem>
                        <SelectItem value="excel">Excel</SelectItem>
                        <SelectItem value="csv">CSV</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="delivery">Delivery Method</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Select delivery" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="download">Download Only</SelectItem>
                        <SelectItem value="both">Email & Download</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="recipients">Email Recipients</Label>
                  <Input id="recipients" placeholder="email1@example.com, email2@example.com" />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button className="w-full">
                  <Save className="mr-2 h-4 w-4" />
                  Save Report
                </Button>
                <Button variant="outline" className="w-full">
                  <Play className="mr-2 h-4 w-4" />
                  Run Now
                </Button>
                <Button variant="outline" className="w-full">
                  <Download className="mr-2 h-4 w-4" />
                  Download Sample
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Report Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <span>Draft</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Created:</span>
                    <span>Today</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last Run:</span>
                    <span>Never</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Next Run:</span>
                    <span>-</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Help</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Configure your report settings and save. You can run the report immediately or schedule it to run automatically.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ReportDetails;
