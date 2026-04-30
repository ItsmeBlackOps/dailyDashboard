import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HelpCircle, ExternalLink, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { HELP_GUIDE, type GuideRole, type GuideSection } from '@/data/helpGuide';

function getStoredRole(): GuideRole {
  const raw = (localStorage.getItem('role') || '').trim().toLowerCase();
  if (!raw) return 'all';
  if (raw === 'admin' || raw === 'administrator') return 'admin';
  if (raw === 'mlead' || raw === 'marketing lead') return 'mlead';
  if (raw === 'teamlead' || raw === 'team lead' || raw === 'tl') return 'teamlead';
  if (raw === 'recruiter') return 'recruiter';
  return 'all';
}

function sectionMatchesRole(section: GuideSection, role: GuideRole): boolean {
  if (section.roles.includes('all')) return true;
  if (section.roles.includes(role)) return true;
  return false;
}

function sectionMatchesQuery(section: GuideSection, q: string): boolean {
  if (!q) return true;
  const haystack = [
    section.title,
    section.summary,
    ...section.steps.map((s) => s.text),
    ...(section.tips ?? []),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q.toLowerCase());
}

export default function HelpGuideButton() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // Keyboard shortcut: `?` (Shift+/) opens the help panel from anywhere.
  // Skipped while the user is typing in an input/textarea/contenteditable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = (t?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'role' | 'tech' | 'all'>('role');

  const role = useMemo(getStoredRole, [open]);

  const filtered = useMemo(() => {
    return HELP_GUIDE.filter((s) => {
      if (!sectionMatchesQuery(s, search)) return false;
      if (tab === 'all') return true;
      if (tab === 'tech') return s.roles.includes('tech');
      return sectionMatchesRole(s, role);
    });
  }, [role, search, tab]);

  const newCount = HELP_GUIDE.filter((s) => s.isNew && sectionMatchesRole(s, role)).length;

  const handleStepClick = (to?: string, href?: string) => {
    if (href) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (to) {
      navigate(to);
      setOpen(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Open help guide (press ?)"
          title="Help & Guides — press ?"
        >
          <HelpCircle className="h-5 w-5" />
          {newCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-aurora-violet px-1 text-[10px] font-semibold text-white">
              {newCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[480px] overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-aurora-violet" />
            Help & Guides
          </SheetTitle>
          <SheetDescription>
            Step-by-step click paths for every feature, tailored to your role.
            New things ship often — check back when you see the badge.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <Input
            placeholder="Search guides…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm"
          />

          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="role" className="text-xs">For You</TabsTrigger>
              <TabsTrigger value="tech" className="text-xs">Technical</TabsTrigger>
              <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
            </TabsList>
            <TabsContent value={tab} className="mt-3">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No guides match your filter.
                </p>
              ) : (
                <Accordion type="multiple" className="w-full">
                  {filtered.map((section) => (
                    <AccordionItem key={section.id} value={section.id}>
                      <AccordionTrigger className="text-left hover:no-underline">
                        <div className="flex items-start gap-2 pr-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">{section.title}</span>
                              {section.isNew && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-aurora-violet text-aurora-violet"
                                >
                                  NEW
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {section.summary}
                            </p>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <ol className="space-y-2 list-decimal list-inside text-sm">
                          {section.steps.map((step, i) => (
                            <li key={i} className="leading-relaxed">
                              {step.to || step.href ? (
                                <button
                                  type="button"
                                  onClick={() => handleStepClick(step.to, step.href)}
                                  className="text-left hover:text-aurora-violet underline-offset-2 hover:underline inline"
                                >
                                  {step.text}
                                  {step.to && (
                                    <ExternalLink className="inline h-3 w-3 ml-1 align-text-top opacity-60" />
                                  )}
                                </button>
                              ) : (
                                <span>{step.text}</span>
                              )}
                            </li>
                          ))}
                        </ol>
                        {section.tips && section.tips.length > 0 && (
                          <div className="mt-3 rounded-md border border-aurora-violet/30 bg-aurora-violet/5 p-3 space-y-1">
                            {section.tips.map((tip, i) => (
                              <p key={i} className="text-xs text-muted-foreground leading-relaxed">
                                <span className="text-aurora-violet font-semibold">Tip · </span>
                                {tip}
                              </p>
                            ))}
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </TabsContent>
          </Tabs>

          <p className="text-xs text-muted-foreground text-center pt-2">
            Missing a guide? Ping the team — we'll add it.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
