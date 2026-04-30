import { useEffect, useRef, type DependencyList } from 'react';

/**
 * Like `useEffect` but skips the first invocation (mount). Runs only on
 * subsequent dependency-list changes.
 *
 * Use whenever you have an effect that should react to a state change
 * but mustn't fire on the initial mount — e.g. closing a sidebar on
 * route transition (without auto-closing it on the page that loaded
 * the sidebar in the first place).
 */
export function useDidUpdate(effect: () => void | (() => void), deps: DependencyList): void {
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    return effect();
    // The hook intentionally proxies the caller's deps array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
