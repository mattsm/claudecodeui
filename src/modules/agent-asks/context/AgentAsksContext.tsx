import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { api } from '@/shared/api';
import type { OpenAgentAsk, ServerEvent } from '@/shared/types';

const NO_OPEN_ASKS: OpenAgentAsk[] = [];

const AgentAsksContext = createContext<OpenAgentAsk[]>(NO_OPEN_ASKS);

type AgentAsksProviderProps = {
  /** The websocket context's `subscribe`: the server announces every change to the items. */
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  children: ReactNode;
};

/** Mounted by the project-workspace module around the sidebar and the chat, which both show what agents wait on the user for. */
export function AgentAsksProvider({ subscribe, children }: AgentAsksProviderProps) {
  // Every open item in every chat. One list feeds the sidebar counts, the
  // header button and the panel's list of other chats.
  const [openAsks, setOpenAsks] = useState<OpenAgentAsk[]>(NO_OPEN_ASKS);
  // Numbers each request so that an older answer arriving last is ignored.
  const latestRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latestRequestRef.current;
    try {
      const response = await api.agentAsks.list();
      const payload = await response.json();
      if (request === latestRequestRef.current && Array.isArray(payload?.data)) {
        setOpenAsks(payload.data);
      }
    } catch (error) {
      console.error('Failed to load agent questions:', error);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // A change announced while the socket was down is lost, so a reconnect reads the list again.
    return subscribe((event) => {
      if (event.kind === 'agent_asks_changed' || event.kind === 'websocket_reconnected') {
        void refresh();
      }
    });
  }, [refresh, subscribe]);

  return <AgentAsksContext.Provider value={openAsks}>{children}</AgentAsksContext.Provider>;
}

/** Every open item in every chat; empty outside the provider. */
export function useOpenAgentAsks(): OpenAgentAsk[] {
  return useContext(AgentAsksContext);
}
