'use client';

import type { ReactNode } from 'react';
import { FlowProvider } from '../lib/flow';
import { SessionProvider } from '../lib/session';
import { ToastProvider } from '../lib/toast';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SessionProvider>
        <FlowProvider>{children}</FlowProvider>
      </SessionProvider>
    </ToastProvider>
  );
}
