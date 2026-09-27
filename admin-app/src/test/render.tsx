import { Providers } from '@bond/console-core/components/providers';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

/** Wraps a page/component in the same providers the real root layout supplies (session, sign-in flow, toasts). */
export function renderWithProviders(ui: ReactElement) {
  return render(<Providers>{ui}</Providers>);
}

export * from '@testing-library/react';
