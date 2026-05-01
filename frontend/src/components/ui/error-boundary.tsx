import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  /** Friendly label shown in the fallback header (e.g. tab name). */
  label?: string;
  /** Override the entire fallback render. */
  fallback?: ReactNode;
  /** Optional onError hook (analytics, Sentry, etc). */
  onError?: (error: Error, info: ErrorInfo) => void;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Local error boundary for a single page region (tab, panel, route).
 * Prevents one component's render crash from blanking the parent
 * page, gives the user a Try-Again button, and logs the failure to
 * the console for engineering.
 *
 * Use:
 *   <ErrorBoundary label="Live Logs">
 *     <LiveLogsTab />
 *   </ErrorBoundary>
 *
 * Reset behaviour: a parent can pass a `key` prop that changes when
 * the user moves to a different sibling, which remounts the boundary
 * (and clears the hasError state).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.label ? ` ${this.props.label}` : ''}]`, error, info);
    this.props.onError?.(error, info);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">
              {this.props.label ? `${this.props.label} crashed` : 'Something went wrong'}
            </p>
            <p className="text-xs text-muted-foreground mt-1 break-words">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={this.reset} className="gap-1.5">
                <RotateCw className="h-3.5 w-3.5" /> Try again
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => window.location.reload()}
                className="text-xs"
              >
                Reload page
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
