
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useState, useEffect } from 'react';

const TypedText = ({ 
  text, 
  speed = 100, 
  loop = false, 
  className = "" 
}: { 
  text: string; 
  speed?: number; 
  loop?: boolean; 
  className?: string;
}) => {
  const [displayText, setDisplayText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    if (currentIndex < text.length && isTyping) {
      const timeout = setTimeout(() => {
        setDisplayText(prev => prev + text[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, speed);
      return () => clearTimeout(timeout);
    } else if (currentIndex >= text.length && loop) {
      const timeout = setTimeout(() => {
        setDisplayText('');
        setCurrentIndex(0);
        setIsTyping(true);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [currentIndex, text, speed, loop, isTyping]);

  return (
    <span className={className}>
      {displayText}
      <span className="animate-pulse">|</span>
    </span>
  );
};

const MultiTextTyped = ({ 
  texts, 
  speed = 100 
}: { 
  texts: string[]; 
  speed?: number;
}) => {
  const [currentTextIndex, setCurrentTextIndex] = useState(0);
  const [displayText, setDisplayText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentText = texts[currentTextIndex];
    
    if (!isDeleting && currentIndex < currentText.length) {
      const timeout = setTimeout(() => {
        setDisplayText(prev => prev + currentText[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, speed);
      return () => clearTimeout(timeout);
    } else if (!isDeleting && currentIndex >= currentText.length) {
      const timeout = setTimeout(() => {
        setIsDeleting(true);
      }, 1500);
      return () => clearTimeout(timeout);
    } else if (isDeleting && displayText.length > 0) {
      const timeout = setTimeout(() => {
        setDisplayText(prev => prev.slice(0, -1));
      }, speed / 2);
      return () => clearTimeout(timeout);
    } else if (isDeleting && displayText.length === 0) {
      setIsDeleting(false);
      setCurrentIndex(0);
      setCurrentTextIndex(prev => (prev + 1) % texts.length);
    }
  }, [currentIndex, displayText, isDeleting, texts, currentTextIndex, speed]);

  return (
    <span>
      {displayText}
      <span className="animate-pulse">|</span>
    </span>
  );
};

export default function ComponentTypedText() {
  const [isStarted, setIsStarted] = useState(false);

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Typed Text</h1>
            <p className="text-muted-foreground">Animated typing effect components for dynamic text display.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Basic Typed Text */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Typed Text</CardTitle>
              <CardDescription>Simple typing animation that types out text character by character.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 bg-muted rounded-lg">
                  <h2 className="text-2xl font-bold">
                    <TypedText text="Welcome to our website!" speed={150} />
                  </h2>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-lg">
                    <TypedText text="This is a longer message that demonstrates the typing effect with more content to show how it works with sentences." speed={50} />
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Looping Typed Text */}
          <Card>
            <CardHeader>
              <CardTitle>Looping Typed Text</CardTitle>
              <CardDescription>Typed text that repeats in a continuous loop.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="p-4 bg-muted rounded-lg text-center">
                <h3 className="text-xl font-semibold text-primary">
                  <TypedText text="This message loops forever!" speed={100} loop={true} />
                </h3>
              </div>
            </CardContent>
          </Card>

          {/* Multiple Text Rotation */}
          <Card>
            <CardHeader>
              <CardTitle>Text Rotation</CardTitle>
              <CardDescription>Cycles through multiple texts with typing and deleting effects.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 rounded-lg text-center">
                  <h2 className="text-3xl font-bold">
                    We are{" "}
                    <span className="text-primary">
                      <MultiTextTyped 
                        texts={["Developers", "Designers", "Innovators", "Creators"]} 
                        speed={120} 
                      />
                    </span>
                  </h2>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-lg">
                    Learn{" "}
                    <span className="font-semibold text-green-600">
                      <MultiTextTyped 
                        texts={["React", "TypeScript", "Tailwind CSS", "Node.js", "Next.js"]} 
                        speed={80} 
                      />
                    </span>
                    {" "}with us!
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Interactive Control */}
          <Card>
            <CardHeader>
              <CardTitle>Interactive Typed Text</CardTitle>
              <CardDescription>Control when the typing animation starts.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Button onClick={() => setIsStarted(!isStarted)}>
                  {isStarted ? 'Reset' : 'Start'} Animation
                </Button>
                <div className="p-4 bg-muted rounded-lg min-h-[60px] flex items-center">
                  {isStarted && (
                    <p className="text-lg">
                      <TypedText 
                        key={isStarted ? 'started' : 'stopped'} 
                        text="Click the button above to control this typing animation!" 
                        speed={100} 
                      />
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Different Speeds */}
          <Card>
            <CardHeader>
              <CardTitle>Variable Speeds</CardTitle>
              <CardDescription>Typed text with different animation speeds.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Slow (200ms per character):</p>
                  <div className="p-3 bg-muted rounded">
                    <TypedText text="This types very slowly..." speed={200} />
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Normal (100ms per character):</p>
                  <div className="p-3 bg-muted rounded">
                    <TypedText text="This types at normal speed." speed={100} />
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Fast (50ms per character):</p>
                  <div className="p-3 bg-muted rounded">
                    <TypedText text="This types very quickly!" speed={50} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Hero Section Example */}
          <Card>
            <CardHeader>
              <CardTitle>Hero Section Example</CardTitle>
              <CardDescription>Real-world example of typed text in a hero section.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-8 rounded-lg text-center">
                <h1 className="text-4xl font-bold mb-4">
                  <TypedText text="Build Amazing Applications" speed={120} />
                </h1>
                <p className="text-xl opacity-90">
                  <TypedText text="Create stunning user experiences with modern web technologies." speed={80} />
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
