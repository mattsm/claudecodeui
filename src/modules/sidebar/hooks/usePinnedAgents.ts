import { useCallback, useEffect, useState } from 'react';

import { readUserPreference, subscribeToUserPreferences, writeUserPreference } from '@/shared/userSettings';

const readPinnedIds = (): string[] => {
  const stored = readUserPreference<unknown>('agentsPinnedSessions', []);
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
};

const sameIds = (first: string[], second: string[]) =>
  first.length === second.length && first.every((id, index) => id === second[index]);

/**
 * The chats pinned to the top of the Agents tab, in the order they were
 * pinned. Kept in the user's preferences, so a pin follows them to another
 * device.
 */
export function usePinnedAgents() {
  const [pinnedIds, setPinnedIds] = useState<string[]>(readPinnedIds);

  useEffect(() => subscribeToUserPreferences(() => {
    setPinnedIds((previous) => {
      const next = readPinnedIds();
      return sameIds(previous, next) ? previous : next;
    });
  }), []);

  const togglePin = useCallback((sessionId: string) => {
    const current = readPinnedIds();
    writeUserPreference(
      'agentsPinnedSessions',
      current.includes(sessionId) ? current.filter((id) => id !== sessionId) : [...current, sessionId],
    );
  }, []);

  const unpin = useCallback((sessionIds: string[]) => {
    const gone = new Set(sessionIds);
    writeUserPreference('agentsPinnedSessions', readPinnedIds().filter((id) => !gone.has(id)));
  }, []);

  return { pinnedIds, togglePin, unpin };
}
