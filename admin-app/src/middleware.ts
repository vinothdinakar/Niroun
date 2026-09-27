import { createConsoleMiddleware } from '@bond/console-core/lib/middleware';

// 'staff': stamped onto every request so the API keeps this app's sessions separate from the customer
// dashboard's, even on a shared hostname — see @bond/console-core/lib/middleware for why that matters.
export const { middleware, config } = createConsoleMiddleware('staff');
