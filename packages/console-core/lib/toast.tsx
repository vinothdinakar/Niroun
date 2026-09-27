'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type ToastFn = (message: string, isError?: boolean) => void;
const ToastContext = createContext<ToastFn>(() => undefined);
export const useToast = (): ToastFn => useContext(ToastContext);

/** Copy text to the clipboard and say so. */
export function useCopy(): (text: string) => Promise<void> {
  const toast = useToast();
  return useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch {
      toast('Copy failed: select and copy manually', true);
    }
  }, [toast]);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ message: string; error: boolean; show: boolean }>({ message: '', error: false, show: false });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback<ToastFn>((message, isError = false) => {
    setState({ message, error: isError, show: true });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState((s) => ({ ...s, show: false })), 3500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={'toast' + (state.show ? ' show' : '') + (state.error ? ' err' : '')} role="status" aria-live="polite">{state.message}</div>
    </ToastContext.Provider>
  );
}
