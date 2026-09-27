import { AuthCard } from '@bond/console-core/components/auth-card';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthCard subtitle="Agent Trust Console">{children}</AuthCard>;
}
