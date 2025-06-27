
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useState, useEffect } from 'react';
import { CheckCircle, Circle, Download, Upload, Wifi, Battery } from 'lucide-react';

export default function ComponentProgress() {
  const [progress, setProgress] = useState(13);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setProgress(66), 500);
    return () => clearTimeout(timer);
  }, []);

  const startDownload = () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    const interval = setInterval(() => {
      setDownloadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsDownloading(false);
          return 100;
        }
        return prev + 10;
      });
    }, 200);
  };

  const startUpload = () => {
    setIsUploading(true);
    setUploadProgress(0);
    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsUploading(false);
          return 100;
        }
        return prev + 5;
      });
    }, 150);
  };

  const skills = [
    { name: "React", level: 90, color: "bg-blue-500" },
    { name: "TypeScript", level: 85, color: "bg-green-500" },
    { name: "Node.js", level: 75, color: "bg-yellow-500" },
    { name: "Python", level: 70, color: "bg-purple-500" },
    { name: "Design", level: 60, color: "bg-pink-500" },
  ];

  const projects = [
    {
      name: "Website Redesign",
      progress: 75,
      status: "In Progress",
      deadline: "Dec 15",
      color: "bg-blue-500",
    },
    {
      name: "Mobile App",
      progress: 45,
      status: "Development",
      deadline: "Jan 30",
      color: "bg-green-500",
    },
    {
      name: "API Integration",
      progress: 90,
      status: "Testing",
      deadline: "Nov 28",
      color: "bg-purple-500",
    },
    {
      name: "Documentation",
      progress: 25,
      status: "Planning",
      deadline: "Feb 15",
      color: "bg-orange-500",
    },
  ];

  const steps = [
    { name: "Account Setup", completed: true },
    { name: "Profile Information", completed: true },
    { name: "Preferences", completed: true },
    { name: "Payment Details", completed: false },
    { name: "Verification", completed: false },
  ];

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Progress</h1>
            <p className="text-muted-foreground">Progress bars and indicators for showing completion status.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Basic Progress */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Progress</CardTitle>
              <CardDescription>Simple progress bars with different values and states.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">Progress</span>
                    <span className="text-sm text-muted-foreground">{progress}%</span>
                  </div>
                  <Progress value={progress} className="w-full" />
                </div>

                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">Completed</span>
                    <span className="text-sm text-muted-foreground">100%</span>
                  </div>
                  <Progress value={100} className="w-full" />
                </div>

                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">Starting</span>
                    <span className="text-sm text-muted-foreground">10%</span>
                  </div>
                  <Progress value={10} className="w-full" />
                </div>

                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">No Progress</span>
                    <span className="text-sm text-muted-foreground">0%</span>
                  </div>
                  <Progress value={0} className="w-full" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Colored Progress Bars */}
          <Card>
            <CardHeader>
              <CardTitle>Skills Progress</CardTitle>
              <CardDescription>Progress bars with custom colors showing skill levels.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {skills.map((skill) => (
                  <div key={skill.name}>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm font-medium">{skill.name}</span>
                      <span className="text-sm text-muted-foreground">{skill.level}%</span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${skill.color} transition-all duration-500 ease-out`}
                        style={{ width: `${skill.level}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Interactive Progress */}
          <Card>
            <CardHeader>
              <CardTitle>Interactive Progress</CardTitle>
              <CardDescription>Progress bars that can be triggered by user actions.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <Download className="h-4 w-4" />
                      <span className="text-sm font-medium">Download Progress</span>
                    </div>
                    <span className="text-sm text-muted-foreground">{downloadProgress}%</span>
                  </div>
                  <Progress value={downloadProgress} className="w-full mb-2" />
                  <Button 
                    onClick={startDownload} 
                    disabled={isDownloading}
                    size="sm"
                  >
                    {isDownloading ? 'Downloading...' : 'Start Download'}
                  </Button>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <Upload className="h-4 w-4" />
                      <span className="text-sm font-medium">Upload Progress</span>
                    </div>
                    <span className="text-sm text-muted-foreground">{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} className="w-full mb-2" />
                  <Button 
                    onClick={startUpload} 
                    disabled={isUploading}
                    variant="outline"
                    size="sm"
                  >
                    {isUploading ? 'Uploading...' : 'Start Upload'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Project Progress */}
          <Card>
            <CardHeader>
              <CardTitle>Project Progress</CardTitle>
              <CardDescription>Detailed progress tracking for multiple projects.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {projects.map((project) => (
                  <div key={project.name} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="font-medium">{project.name}</h4>
                        <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                          <span>{project.status}</span>
                          <span>•</span>
                          <span>Due {project.deadline}</span>
                        </div>
                      </div>
                      <Badge variant="outline">{project.progress}%</Badge>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${project.color} transition-all duration-700 ease-out`}
                        style={{ width: `${project.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Step Progress */}
          <Card>
            <CardHeader>
              <CardTitle>Step Progress</CardTitle>
              <CardDescription>Multi-step progress indicator showing completion status.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {steps.map((step, index) => (
                  <div key={step.name} className="flex items-center space-x-4">
                    <div className="flex-shrink-0">
                      {step.completed ? (
                        <CheckCircle className="h-6 w-6 text-green-500" />
                      ) : (
                        <Circle className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`font-medium ${step.completed ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {step.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Step {index + 1} of {steps.length}
                      </p>
                    </div>
                    <div className="flex-shrink-0">
                      {step.completed && (
                        <Badge variant="secondary">Complete</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium">Overall Progress</span>
                  <span className="text-sm text-muted-foreground">
                    {Math.round((steps.filter(s => s.completed).length / steps.length) * 100)}%
                  </span>
                </div>
                <Progress 
                  value={(steps.filter(s => s.completed).length / steps.length) * 100} 
                  className="w-full" 
                />
              </div>
            </CardContent>
          </Card>

          {/* System Status */}
          <Card>
            <CardHeader>
              <CardTitle>System Status</CardTitle>
              <CardDescription>Progress indicators for system resources and connectivity.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Wifi className="h-4 w-4" />
                    <span className="text-sm font-medium">Network Speed</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span>Download</span>
                      <span>85 Mbps</span>
                    </div>
                    <Progress value={85} className="h-2" />
                    <div className="flex justify-between text-xs">
                      <span>Upload</span>
                      <span>42 Mbps</span>
                    </div>
                    <Progress value={42} className="h-2" />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Battery className="h-4 w-4" />
                    <span className="text-sm font-medium">Battery Status</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span>Charge Level</span>
                      <span>67%</span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-3">
                      <div
                        className="h-3 rounded-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-300"
                        style={{ width: '67%' }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      2h 34m remaining
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Indeterminate Progress */}
          <Card>
            <CardHeader>
              <CardTitle>Loading States</CardTitle>
              <CardDescription>Progress indicators for loading and processing states.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <p className="text-sm font-medium mb-2">Processing...</p>
                  <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: '60%' }} />
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Loading Content</p>
                  <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-primary to-transparent animate-pulse" style={{ width: '100%' }} />
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Syncing Data</p>
                  <div className="flex space-x-1">
                    {[...Array(10)].map((_, i) => (
                      <div
                        key={i}
                        className="h-2 w-2 bg-primary rounded-full animate-pulse"
                        style={{ animationDelay: `${i * 0.1}s` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
