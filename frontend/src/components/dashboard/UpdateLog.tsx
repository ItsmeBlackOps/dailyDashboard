import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface UpdateLogEntry {
  id: string;
  title: string;
  description: string;
  date: string;
  tags?: string[];
}

interface UpdateLogProps {
  updates: UpdateLogEntry[];
  storageKey?: string;
}

const DEFAULT_STORAGE_KEY = "dashboard_update_log_collapsed";

export function UpdateLog({ updates, storageKey = DEFAULT_STORAGE_KEY }: UpdateLogProps) {
  const sortedUpdates = useMemo(
    () => [...updates].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [updates]
  );

  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      setCollapsed(stored === "true");
    } catch {
      // ignore storage failures
    }
  }, [storageKey]);

  const handleToggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(storageKey, String(next));
        } catch {
          // ignore storage failures
        }
      }
      return next;
    });
  };

  if (!sortedUpdates.length) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-primary/10 p-1 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base">Latest Updates</CardTitle>
            <CardDescription>Key improvements and new features since your last visit.</CardDescription>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto px-2 text-xs"
          onClick={handleToggle}
        >
          {collapsed ? (
            <>
              Expand
              <ChevronDown className="ml-1 h-4 w-4" />
            </>
          ) : (
            <>
              Collapse
              <ChevronUp className="ml-1 h-4 w-4" />
            </>
          )}
        </Button>
      </CardHeader>
      {!collapsed && (
        <>
          <CardContent className="space-y-4">
            {sortedUpdates.map((update, index) => (
              <div key={update.id} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-sm md:text-base">{update.title}</div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">
                    {new Date(update.date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric"
                    })}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{update.description}</p>
                {update.tags && update.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {update.tags.map((tag) => (
                      <Badge key={`${update.id}-${tag}`} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                {index < sortedUpdates.length - 1 && <Separator className="pt-2" />}
              </div>
            ))}
          </CardContent>
          <CardFooter className="pt-2">
            <p className="text-xs text-muted-foreground">
              Tip: You can collapse this panel once you are caught up. We store your preference for next time.
            </p>
          </CardFooter>
        </>
      )}
    </Card>
  );
}
