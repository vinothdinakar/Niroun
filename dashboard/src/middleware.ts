import { createConsoleMiddleware } from '@bond/console-core/lib/middleware';

// 'customer': stamped onto every request so the API keeps this app's sessions separate from the staff
// app's, even on a shared hostname — see @bond/console-core/lib/middleware for why that matters.
export const { middleware, config } = createConsoleMiddleware('customer');
