import { AuthCard } from '@bond/console-core/components/auth-card';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthCard subtitle="Staff Console">{children}</AuthCard>;
}
