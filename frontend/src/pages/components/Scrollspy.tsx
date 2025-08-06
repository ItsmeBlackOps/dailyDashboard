
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

export default function ComponentScrollspy() {
  const [activeSection, setActiveSection] = useState('section1');

  useEffect(() => {
    const handleScroll = () => {
      const sections = ['section1', 'section2', 'section3', 'section4', 'section5'];
      const scrollPosition = window.scrollY + 100;

      for (const section of sections) {
        const element = document.getElementById(section);
        if (element) {
          const offsetTop = element.offsetTop;
          const offsetHeight = element.offsetHeight;
          
          if (scrollPosition >= offsetTop && scrollPosition < offsetTop + offsetHeight) {
            setActiveSection(section);
            break;
          }
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const sections = [
    { id: 'section1', title: 'Introduction', content: 'This is the introduction section. Scrollspy allows you to automatically update navigation highlighting based on scroll position.' },
    { id: 'section2', title: 'Getting Started', content: 'Here you can learn how to get started with the component. This section covers basic setup and configuration options.' },
    { id: 'section3', title: 'Features', content: 'This section covers the main features of the component including automatic highlighting, smooth scrolling, and customizable options.' },
    { id: 'section4', title: 'Examples', content: 'Various examples of how to implement and customize the scrollspy component in different scenarios and layouts.' },
    { id: 'section5', title: 'Configuration', content: 'Detailed configuration options and advanced usage patterns for the scrollspy component.' }
  ];

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Scrollspy</h1>
            <p className="text-muted-foreground">Automatically update navigation highlighting based on scroll position.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        {/* Basic Scrollspy Example */}
        <Card>
          <CardHeader>
            <CardTitle>Scrollspy with Sidebar Navigation</CardTitle>
            <CardDescription>Navigation that updates based on the current scroll position.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6">
              {/* Sidebar Navigation */}
              <div className="w-64 flex-shrink-0">
                <div className="sticky top-6">
                  <nav className="space-y-1">
                    {sections.map((section) => (
                      <button
                        key={section.id}
                        onClick={() => scrollToSection(section.id)}
                        className={cn(
                          'block w-full text-left px-3 py-2 text-sm rounded-md transition-colors',
                          activeSection === section.id
                            ? 'bg-primary text-primary-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                        )}
                      >
                        {section.title}
                      </button>
                    ))}
                  </nav>
                </div>
              </div>

              {/* Content Sections */}
              <div className="flex-1 space-y-8">
                {sections.map((section, index) => (
                  <section
                    key={section.id}
                    id={section.id}
                    className="min-h-[400px] scroll-mt-6"
                  >
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <span className="bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-sm">
                            {index + 1}
                          </span>
                          {section.title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-muted-foreground mb-4">{section.content}</p>
                        <div className="space-y-4 text-sm">
                          <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.</p>
                          <p>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>
                          <p>Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.</p>
                          <p>Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.</p>
                        </div>
                      </CardContent>
                    </Card>
                  </section>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Top Navigation Scrollspy */}
        <Card>
          <CardHeader>
            <CardTitle>Horizontal Navigation Scrollspy</CardTitle>
            <CardDescription>Top navigation bar that highlights active sections.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Top Navigation */}
              <div className="border-b">
                <nav className="flex space-x-8 overflow-x-auto">
                  {sections.map((section) => (
                    <button
                      key={section.id}
                      onClick={() => scrollToSection(section.id)}
                      className={cn(
                        'whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm transition-colors',
                        activeSection === section.id
                          ? 'border-primary text-primary'
                          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground'
                      )}
                    >
                      {section.title}
                    </button>
                  ))}
                </nav>
              </div>

              {/* Content Preview */}
              <div className="text-center text-muted-foreground py-8">
                <p>This demonstrates a horizontal navigation that would work with page sections.</p>
                <p className="text-sm mt-2">Currently active: <span className="font-medium text-foreground">{sections.find(s => s.id === activeSection)?.title}</span></p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Dot Navigation */}
        <Card>
          <CardHeader>
            <CardTitle>Dot Navigation Scrollspy</CardTitle>
            <CardDescription>Minimal dot-based navigation indicator.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center space-x-2 py-8">
              {sections.map((section, index) => (
                <button
                  key={section.id}
                  onClick={() => scrollToSection(section.id)}
                  className={cn(
                    'w-3 h-3 rounded-full transition-all duration-300',
                    activeSection === section.id
                      ? 'bg-primary scale-125'
                      : 'bg-muted hover:bg-muted-foreground'
                  )}
                  title={section.title}
                />
              ))}
            </div>
            <div className="text-center text-muted-foreground">
              <p className="text-sm">Hover over dots to see section titles</p>
              <p className="text-sm mt-2">Currently viewing: <span className="font-medium text-foreground">{sections.find(s => s.id === activeSection)?.title}</span></p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
