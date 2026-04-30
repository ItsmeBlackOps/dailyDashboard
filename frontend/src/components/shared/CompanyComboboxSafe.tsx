import * as React from 'react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { CompanyCombobox, type CompanyComboboxProps } from './CompanyCombobox';

// Feature flag — flip to "on" via Vite env var. Off by default so the
// rollout is opt-in per environment / per release.
//
// Behaviour:
//   on (default in repo until ready): combobox renders. ErrorBoundary
//   below catches any runtime crash and falls back to a plain <Input>.
//   off: combobox is bypassed entirely; plain <Input> renders.
//
// The flag is intentionally read at module-eval time so a React DevTools
// reload picks up env changes without a hot-reload edge case.
const FLAG = (import.meta.env.VITE_END_CLIENT_COMBOBOX || 'on').toLowerCase();
const COMBOBOX_ENABLED = FLAG === 'on' || FLAG === 'true' || FLAG === '1';

interface ErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class CompanyComboboxBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[CompanyCombobox] crashed; falling back to plain input', error, info);
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.hasError) return <>{this.props.fallback}</>;
    return <>{this.props.children}</>;
  }
}

/**
 * Drop-in safe wrapper around CompanyCombobox.
 *
 * - When VITE_END_CLIENT_COMBOBOX is off → renders a plain text Input
 *   (today's behaviour). Form submission unaffected.
 * - When on → renders CompanyCombobox. Any runtime crash is caught and
 *   falls through to the same plain Input. End Client field cannot
 *   block form submission.
 *
 * Intended as a 1:1 swap for the pre-existing <CompanyCombobox> sites
 * in BranchCandidates so we get the safety net without touching three
 * other call sites' code paths.
 */
export function CompanyComboboxSafe(props: CompanyComboboxProps) {
  const fallback = (
    <Input
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder ?? 'Client name'}
      disabled={props.disabled}
      className={props.className}
      autoComplete="off"
    />
  );

  if (!COMBOBOX_ENABLED) return fallback;

  return (
    <CompanyComboboxBoundary fallback={fallback}>
      <CompanyCombobox {...props} />
    </CompanyComboboxBoundary>
  );
}
