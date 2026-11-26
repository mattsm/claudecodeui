import { useCallback, useMemo, useState } from 'react';

import { useOpenAgentAsks } from '@/modules/agent-asks/context/AgentAsksContext';
import type { OpenAgentAsk } from '@/shared/types';
import { splitBenchLockPrefix } from '@/shared/ui/SessionTitle';
import { readAgentTitleRole } from '@/shared/utils';

const PANEL_HIDDEN_STORAGE_KEY = 'agent-asks-panel-hidden';

function readPanelHidden(): boolean {
  try {
    return window.localStorage.getItem(PANEL_HIDDEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePanelHidden(hidden: boolean) {
  try {
    if (hidden) {
      window.localStorage.setItem(PANEL_HIDDEN_STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(PANEL_HIDDEN_STORAGE_KEY);
    }
  } catch {
    // Without storage the choice lasts until the page reloads.
  }
}

const titleRole = (title: string | null | undefined) =>
  readAgentTitleRole(splitBenchLockPrefix(title ?? '').title.trim());

/**
 * The open items of the chats grouped under a master chat, for that master's
 * panel: the chats titled "X: ..." when the chat on screen is "X master". A
 * chat that is not a master has none.
 */
export function selectGroupAsks(
  openAsks: OpenAgentAsk[],
  sessionId: string | null,
  sessionTitle: string | null | undefined,
): OpenAgentAsk[] {
  const own = titleRole(sessionTitle);
  if (own.role !== 'master') {
    return [];
  }
  return openAsks.filter((ask) => {
    if (!ask.sessionId || ask.sessionId === sessionId) {
      return false;
    }
    const role = titleRole(ask.sessionTitle);
    return role.role !== 'none' && role.key === own.key;
  });
}

/**
 * Whether the panel beside the chat shows, and the counts for its button.
 *
 * The panel shows by itself while the open chat has open items, or is a
 * master chat whose group has some. The button
 * hides it, which is remembered, or shows it for a chat that has none, which
 * lasts until the user moves to another chat. On a phone the panel covers the
 * chat, so there it shows only when the button asks for it.
 */
export function useAgentAsksPanel(sessionId: string | null, isMobile: boolean, sessionTitle?: string | null) {
  const openAsks = useOpenAgentAsks();
  // The user's choice to keep the panel shut even when the chat has open items.
  const [hidden, setHidden] = useState(readPanelHidden);
  // The chat the user opened the panel for although it had no open items.
  const [shownForSessionId, setShownForSessionId] = useState<string | null>(null);

  // `openCount` is what the panel lists for this chat: its own items and, for a master chat, its group's.
  const { openCount, otherOpenCount } = useMemo(() => {
    const own = sessionId ? openAsks.filter((ask) => ask.sessionId === sessionId).length : 0;
    const listed = own + selectGroupAsks(openAsks, sessionId, sessionTitle).length;
    // Items with no chat count too: the panel lists them for dismissal.
    return { openCount: listed, otherOpenCount: openAsks.length - listed };
  }, [openAsks, sessionId, sessionTitle]);

  const shownOnRequest = sessionId !== null && shownForSessionId === sessionId;
  const isVisible = sessionId !== null && ((!isMobile && !hidden && openCount > 0) || shownOnRequest);

  const toggle = useCallback(() => {
    if (isVisible) {
      setShownForSessionId(null);
      if (openCount > 0 && !isMobile) {
        setHidden(true);
        writePanelHidden(true);
      }
      return;
    }
    if (!isMobile) {
      setHidden(false);
      writePanelHidden(false);
    }
    setShownForSessionId(sessionId);
  }, [isMobile, isVisible, openCount, sessionId]);

  return { isVisible, openCount, otherOpenCount, toggle };
}
