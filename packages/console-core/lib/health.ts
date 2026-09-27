'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import type { Health } from './types';

let cached: Promise<Health | null> | null = null;

/** The API's public settings: whether company signup is open, and whether it runs a demo mailbox. null until known. */
export function useHealth(): Health | null {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    cached ??= api<Health>('GET', '/v1/health').catch(() => { cached = null; return null; });
    let live = true;
    cached.then((h) => { if (live) setHealth(h); });
    return () => { live = false; };
  }, []);
  return health;
}
