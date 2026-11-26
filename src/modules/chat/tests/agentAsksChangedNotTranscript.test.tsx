import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { NormalizedMessage, ProjectSession, ServerEvent } from '@/shared/types';

/**
 * `agent_asks_changed` names the chat whose questions changed, so it carries
 * that chat's session id like a message does. It is not a message: stored in
 * the transcript, a row with no id made the store's readers throw, and the
 * open chat stopped taking new messages, the answer to the question included.
 */
test('agent_asks_changed for the open chat never reaches the transcript store', () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const appended: NormalizedMessage[] = [];

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: 'viewed-session' } as ProjectSession,
    currentSessionId: 'viewed-session',
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: null },
    accumulatedStreamRef: { current: '' },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    onSessionIdle: () => {},
    onSessionBackground: () => {},
    getSessionActivity: () => undefined,
    requestLatestMessages: async () => {},
    sessionStore: {
      appendRealtime: (_sessionId: string, msg: NormalizedMessage) => { appended.push(msg); },
      getMessages: () => [],
      updateStreaming: () => {},
      finalizeStreaming: () => {},
    } as unknown as SessionStore,
  }));

  act(() => {
    listener?.({ kind: 'agent_asks_changed', sessionId: 'viewed-session', timestamp: '2026-11-26T10:00:00.000Z' });
    listener?.({ kind: 'agent_asks_changed', sessionId: 'other-session', timestamp: '2026-11-26T10:00:01.000Z' });
  });

  assert.equal(appended.length, 0);
});
