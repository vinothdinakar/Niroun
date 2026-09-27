import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@bond/console-core/components/providers';
import '@bond/console-core/styles/globals.css';

// Every page is rendered per request so Next can stamp this request's CSP nonce onto its scripts (see src/middleware.ts).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Bond · Console', template: '%s · Bond Console' },
  description: 'Bond console: agents, deals, disputes and spending limits.',
  robots: { index: false, follow: false },
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, colorScheme: 'dark' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions often stamp attributes onto <html> before React loads
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
