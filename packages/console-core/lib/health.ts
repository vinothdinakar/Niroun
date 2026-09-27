'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import type { Health } from './types';

/**
 * The API's public settings: whether company signup is open, and whether it runs a demo mailbox. null until known.
 * Fetched fresh on every mount (it's a tiny, unauthenticated call) rather than cached module-wide, so a value
 * that changed server-side is picked up on the next page a visitor lands on, not stuck for the rest of the tab's
 * life. A module-level cache here also made every consumer's tests bleed into each other within one test file.
 */
export function useHealth(): Health | null {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    let live = true;
    api<Health>('GET', '/v1/health')
      .then((h) => { if (live) setHealth(h); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  return health;
}
