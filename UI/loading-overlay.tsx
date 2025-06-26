import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadingOverlayProps {
  className?: string;
}

export function LoadingOverlay({ className }: LoadingOverlayProps) {
  return (
    <div className={cn('absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-50', className)}>
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
