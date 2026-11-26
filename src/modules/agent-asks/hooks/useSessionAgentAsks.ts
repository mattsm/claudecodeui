import { useCallback, useEffect, useRef, useState } from 'react';

import { useOpenAgentAsks } from '@/modules/agent-asks/context/AgentAsksContext';
import { api } from '@/shared/api';
import type { AgentAsk } from '@/shared/types';

/**
 * One chat's items for the panel: the open ones, then the recently closed
 * ones. Read when the panel opens and again whenever the list of open items
 * changes, which the provider keeps current from the server's announcements.
 */
export function useSessionAgentAsks(sessionId: string | null) {
  // The chat's own list. The provider's list has no closed items, so the panel reads this one.
  const [asks, setAsks] = useState<AgentAsk[]>([]);
  const openAsks = useOpenAgentAsks();
  // Which chat the list on screen belongs to: an answer for the chat the user left must not show in the next one.
  const activeSessionRef = useRef(sessionId);
  const latestRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    const request = ++latestRequestRef.current;
    try {
      const response = await api.agentAsks.list(sessionId);
      const payload = await response.json();
      if (activeSessionRef.current === sessionId && request === latestRequestRef.current && Array.isArray(payload?.data)) {
        setAsks(payload.data);
      }
    } catch (error) {
      console.error('Failed to load agent questions:', error);
    }
  }, [sessionId]);

  // Cleared during the switch render, so one chat's items never paint in another.
  const [renderedSessionId, setRenderedSessionId] = useState(sessionId);
  if (renderedSessionId !== sessionId) {
    setRenderedSessionId(sessionId);
    setAsks([]);
  }

  useEffect(() => {
    activeSessionRef.current = sessionId;
    void refresh();
  }, [refresh, sessionId, openAsks]);

  /** Closes an item and returns the message to send to the chat, or null when there is none. Throws the server's reason on refusal. */
  const resolve = useCallback(async (
    id: number,
    action: 'answer' | 'ack' | 'dismiss',
    answer?: string,
  ): Promise<string | null> => {
    const response = await api.agentAsks.resolve(id, { action, ...(answer ? { answer } : {}) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      void refresh();
      throw new Error(payload?.error?.message || `HTTP ${response.status}`);
    }
    void refresh();
    return typeof payload.data?.chatMessage === 'string' ? payload.data.chatMessage : null;
  }, [refresh]);

  return { asks, resolve };
}
