import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '../types';
import { storageService } from '../services/storageService';
import { enqueue, mergeSessions, pendingSessions, synchronize, validSession } from '../services/activityRepository';
export function useActivityStore(owner: string) {
  const [sessions, setSessions] = useState(() => mergeSessions(storageService.loadSessions(owner), pendingSessions(owner)));
  const current = useRef(sessions);
  const [storageError, setStorageError] = useState(false);
  const [syncState, setSyncState] = useState<'local'|'syncing'|'synced'|'syncPending'>(owner === 'local-user' ? 'local' : 'syncPending');
  const syncing = useRef(false);
  const mounted = useRef(true);
  const publish = useCallback((next: Session[]) => {
    current.current = next;
    setSessions(next);
    setStorageError(!storageService.saveSessions(next, owner));
  }, [owner]);
  const sync = useCallback(async () => {
    if (owner === 'local-user' || syncing.current) return;
    syncing.current = true; setSyncState('syncing');
    try {
      const remote = await synchronize(owner);
      if (mounted.current) {
        publish(mergeSessions(remote, current.current));
        setSyncState(pendingSessions(owner).length ? 'syncPending' : 'synced');
      }
    } catch {if (mounted.current) setSyncState('syncPending');}
    finally {syncing.current = false;}
  }, [owner, publish]);
  useEffect(() => {
    mounted.current = true;
    void sync();
    const retry = () => {void sync();};
    window.addEventListener('online', retry);
    const timer = window.setInterval(retry, 60000);
    return () => {mounted.current = false;window.removeEventListener('online', retry);window.clearInterval(timer);};
  }, [sync]);
  const save = useCallback((s: Session) => {
    const owned = {...s, user_id: owner};
    publish(mergeSessions(current.current, [owned]));
    if (owner !== 'local-user') {
      try {enqueue(owned);} catch {setStorageError(true);}
      void sync();
    }
  }, [owner, publish, sync]);
  const importLocal = () => {
    // Keep originals on device. Stable UUIDs make repeated imports idempotent.
    for (const s of storageService.loadSessions().filter(validSession).filter(s => !s.demo && s.end_time)) save(s);
  };
  return {sessions, save, storageError, syncState, sync, importLocal};
}
