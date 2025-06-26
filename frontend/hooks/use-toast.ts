import * as React from "react";

export interface Toast {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

let listeners: Array<(toasts: Toast[]) => void> = [];
let memoryToasts: Toast[] = [];

function notify() {
  listeners.forEach((l) => l(memoryToasts));
}

export function toast(toast: Omit<Toast, "id">) {
  const newToast = { ...toast, id: Math.random().toString(36).slice(2) };
  memoryToasts = [...memoryToasts, newToast];
  notify();
  return newToast;
}

export function useToast() {
  const [toasts, setToasts] = React.useState<Toast[]>(memoryToasts);

  React.useEffect(() => {
    listeners.push(setToasts);
    return () => {
      listeners = listeners.filter((l) => l !== setToasts);
    };
  }, []);

  return { toasts, toast };
}
