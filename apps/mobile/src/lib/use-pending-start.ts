import { useCallback, useEffect, useState } from 'react';
import { PENDING_START_KEY, readPendingStart, type StartIntent } from './start-intent';
import { kv } from './storage';

/** The website destination waiting for this device (undefined while loading), and a way to consume it. */
export function usePendingStart() {
  const [intent, setIntent] = useState<StartIntent | null | undefined>(undefined);
  useEffect(() => {
    void kv.get(PENDING_START_KEY).then((raw) => setIntent(readPendingStart(raw)));
  }, []);
  const consume = useCallback(() => {
    setIntent(null);
    void kv.remove(PENDING_START_KEY);
  }, []);
  return { intent, consume };
}
