import assert from 'node:assert/strict';

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, test, vi } from 'vitest';

import type { AgentAsk, OpenAgentAsk, ServerEvent } from '@/shared/types';

// Returns the default text with its values filled in, as the app's English does.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') {
        return options;
      }
      const template = typeof options?.defaultValue === 'string' ? options.defaultValue : key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
  }),
}));

// The transcript's renderer pulls in the whole chat module; the panel only needs the text.
vi.mock('@/modules/chat', () => ({
  Markdown: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const sendChatMessage = vi.fn();
vi.mock('@/modules/command-palette', () => ({
  usePaletteOps: () => ({ sendChatMessage }),
}));

// The server's lists, and what its resolve route answers.
const server = vi.hoisted(() => ({
  open: [] as unknown[],
  bySession: {} as Record<string, unknown[]>,
  resolveCalls: [] as Array<{ id: number; body: unknown }>,
  resolveResponse: { ok: true, status: 200, body: { success: true, data: { chatMessage: null } } as unknown },
}));
vi.mock('@/shared/api', () => ({
  api: {
    agentAsks: {
      list: async (sessionId?: string) => ({
        ok: true,
        json: async () => ({ success: true, data: sessionId ? server.bySession[sessionId] ?? [] : server.open }),
      }),
      resolve: async (id: number, body: unknown) => {
        server.resolveCalls.push({ id, body });
        return {
          ok: server.resolveResponse.ok,
          status: server.resolveResponse.status,
          json: async () => server.resolveResponse.body,
        };
      },
    },
  },
}));

const { AgentAskCountBadge, AgentAsksPanel, AgentAsksProvider, useAgentAsksPanel } = await import('@/modules/agent-asks');

const ask = (id: number, sessionId: string, overrides: Partial<OpenAgentAsk> = {}): OpenAgentAsk => ({
  id,
  sessionId,
  kind: 'question',
  title: `Question ${id}`,
  details: null,
  options: [],
  status: 'open',
  answer: null,
  createdAt: '2026-11-26T10:00:00Z',
  resolvedAt: null,
  sessionTitle: `Chat ${sessionId}`,
  ...overrides,
});

// The websocket context's subscribe, with a handle to announce a change.
function createSocket() {
  const listeners = new Set<(event: ServerEvent) => void>();
  return {
    subscribe: (listener: (event: ServerEvent) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    announce: (event: ServerEvent) => listeners.forEach((listener) => listener(event)),
  };
}

function setServerAsks(asks: OpenAgentAsk[], closed: AgentAsk[] = []) {
  server.open = asks;
  server.bySession = {};
  for (const item of [...asks, ...closed]) {
    if (item.sessionId) {
      (server.bySession[item.sessionId] ??= []).push(item);
    }
  }
}

beforeEach(() => {
  setServerAsks([]);
  server.resolveCalls = [];
  server.resolveResponse = { ok: true, status: 200, body: { success: true, data: { chatMessage: null } } };
  sendChatMessage.mockReset();
  window.localStorage.clear();
});

test('an answer is stored on the server and sent to the chat as a message', async () => {
  setServerAsks([ask(7, 'a', { title: 'Rebase now?', options: ['Yes', 'No'] }), ask(8, 'b')]);
  server.resolveResponse.body = { success: true, data: { chatMessage: 'Answer to your question #7 ("Rebase now?"):\n\nYes' } };
  const socket = createSocket();
  const navigated: string[] = [];

  render(
    <AgentAsksProvider subscribe={socket.subscribe}>
      <AgentAsksPanel sessionId="a" isMobile={false} onClose={() => {}} onNavigateToSession={(id) => navigated.push(id)} />
    </AgentAsksProvider>,
  );

  await screen.findByText('Rebase now?');
  const sendButton = screen.getByRole('button', { name: 'Send answer' }) as HTMLButtonElement;
  assert.equal(sendButton.disabled, true);

  fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
  assert.equal((screen.getByLabelText('Your answer') as HTMLTextAreaElement).value, 'Yes');
  await act(async () => { fireEvent.click(sendButton); });

  assert.deepEqual(server.resolveCalls, [{ id: 7, body: { action: 'answer', answer: 'Yes' } }]);
  assert.deepEqual(sendChatMessage.mock.calls, [['Answer to your question #7 ("Rebase now?"):\n\nYes']]);

  // The other chat that waits on the user is one click away.
  fireEvent.click(screen.getByTestId('agent-asks-other-chat'));
  assert.deepEqual(navigated, ['b']);
});

test('an acknowledgement needs no text, and a dismissal sends nothing to the chat', async () => {
  setServerAsks([ask(3, 'a', { kind: 'ack', title: 'Lab left running' }), ask(4, 'a', { title: 'Drop me' })]);
  const socket = createSocket();

  render(
    <AgentAsksProvider subscribe={socket.subscribe}>
      <AgentAsksPanel sessionId="a" isMobile={false} onClose={() => {}} onNavigateToSession={() => {}} />
    </AgentAsksProvider>,
  );

  await screen.findByText('Lab left running');
  server.resolveResponse.body = { success: true, data: { chatMessage: 'Acknowledged #3 ("Lab left running").' } };
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' })); });
  assert.deepEqual(server.resolveCalls[0], { id: 3, body: { action: 'ack' } });
  assert.equal(sendChatMessage.mock.calls.length, 1);

  server.resolveResponse.body = { success: true, data: { chatMessage: null } };
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[1]); });
  assert.deepEqual(server.resolveCalls[1], { id: 4, body: { action: 'dismiss' } });
  assert.equal(sendChatMessage.mock.calls.length, 1);
});

test('a refused answer shows the reason and sends nothing', async () => {
  setServerAsks([ask(5, 'a')]);
  server.resolveResponse = {
    ok: false,
    status: 409,
    body: { success: false, error: { code: 'AGENT_ASK_NOT_OPEN', message: 'Item #5 is already closed (answered).' } },
  };
  const socket = createSocket();

  render(
    <AgentAsksProvider subscribe={socket.subscribe}>
      <AgentAsksPanel sessionId="a" isMobile={false} onClose={() => {}} onNavigateToSession={() => {}} />
    </AgentAsksProvider>,
  );

  await screen.findByText('Question 5');
  fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'late' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send answer' })); });

  assert.equal(screen.getByRole('alert').textContent, 'Item #5 is already closed (answered).');
  assert.equal(sendChatMessage.mock.calls.length, 0);
});

test('the panel shows by itself for a chat with open items, and the button hides or shows it', async () => {
  setServerAsks([ask(1, 'a'), ask(2, 'b'), ask(3, 'b')]);
  const socket = createSocket();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AgentAsksProvider subscribe={socket.subscribe}>{children}</AgentAsksProvider>
  );

  const { result, rerender } = renderHook(({ sessionId }) => useAgentAsksPanel(sessionId, false), {
    wrapper,
    initialProps: { sessionId: 'a' as string | null },
  });
  await waitFor(() => assert.equal(result.current.openCount, 1));
  assert.equal(result.current.otherOpenCount, 2);
  assert.equal(result.current.isVisible, true);

  // Hidden by the user: it stays hidden in the next chat with open items too.
  act(() => result.current.toggle());
  assert.equal(result.current.isVisible, false);
  rerender({ sessionId: 'b' });
  assert.equal(result.current.openCount, 2);
  assert.equal(result.current.isVisible, false);

  act(() => result.current.toggle());
  assert.equal(result.current.isVisible, true);

  // A chat with nothing open: shown only on request, and only for that chat.
  rerender({ sessionId: 'c' });
  assert.equal(result.current.isVisible, false);
  act(() => result.current.toggle());
  assert.equal(result.current.isVisible, true);
  rerender({ sessionId: 'd' });
  assert.equal(result.current.isVisible, false);

  // A new item announced by the server opens the panel for its chat.
  setServerAsks([ask(9, 'd')]);
  await act(async () => { socket.announce({ kind: 'agent_asks_changed', sessionId: 'd' }); });
  await waitFor(() => assert.equal(result.current.isVisible, true));
});

test('a sidebar row counts the open items of its chats', async () => {
  setServerAsks([ask(1, 'a'), ask(2, 'b'), ask(3, 'b')]);
  const socket = createSocket();

  render(
    <AgentAsksProvider subscribe={socket.subscribe}>
      <div data-testid="own"><AgentAskCountBadge sessionIds={['a']} /></div>
      <div data-testid="group"><AgentAskCountBadge sessionIds={['a', 'b']} /></div>
      <div data-testid="none"><AgentAskCountBadge sessionIds={['c']} /></div>
    </AgentAsksProvider>,
  );

  await waitFor(() => assert.equal(screen.getByTestId('own').textContent, '1'));
  assert.equal(screen.getByTestId('group').textContent, '3');
  assert.equal(screen.getByTestId('none').textContent, '');
});

test('on a phone the panel shows only when the button asks for it', async () => {
  setServerAsks([ask(1, 'a')]);
  const socket = createSocket();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AgentAsksProvider subscribe={socket.subscribe}>{children}</AgentAsksProvider>
  );

  const { result } = renderHook(() => useAgentAsksPanel('a', true), { wrapper });
  await waitFor(() => assert.equal(result.current.openCount, 1));
  assert.equal(result.current.isVisible, false);

  act(() => result.current.toggle());
  assert.equal(result.current.isVisible, true);
  act(() => result.current.toggle());
  assert.equal(result.current.isVisible, false);
  // Closing it on a phone is not a choice to keep it shut on the desktop.
  assert.equal(window.localStorage.getItem('agent-asks-panel-hidden'), null);
});

test('an item whose chat cannot be found is listed and can be dismissed', async () => {
  server.open = [ask(11, 'a'), { ...ask(12, 'gone', { title: 'Asked from a deleted chat' }), sessionId: null }];
  server.bySession = { a: [ask(11, 'a')] };
  const socket = createSocket();

  render(
    <AgentAsksProvider subscribe={socket.subscribe}>
      <AgentAsksPanel sessionId="a" isMobile={false} onClose={() => {}} onNavigateToSession={() => {}} />
    </AgentAsksProvider>,
  );

  const row = await screen.findByTestId('agent-ask-unmatched');
  assert.equal(row.textContent?.includes('Asked from a deleted chat'), true);
  assert.equal(screen.queryByTestId('agent-asks-other-chat') === null, true);
  await act(async () => { fireEvent.click(row.querySelector('button') as HTMLButtonElement); });
  assert.deepEqual(server.resolveCalls, [{ id: 12, body: { action: 'dismiss' } }]);
});

test('a master chat lists the open items of its group, with a way to the chat that asked', async () => {
  setServerAsks([
    ask(21, 'child-1', { title: 'May I read the bench counters?', sessionTitle: '[A1] [STA] mt7995: station data path' }),
    ask(22, 'other', { sessionTitle: 'wireless lab: map UI' }),
  ]);
  const socket = createSocket();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AgentAsksProvider subscribe={socket.subscribe}>{children}</AgentAsksProvider>
  );

  // The master has nothing of its own, but its group has one item: the panel opens for it.
  const { result } = renderHook(() => useAgentAsksPanel('master', false, 'mt7995 master'), { wrapper });
  await waitFor(() => assert.equal(result.current.openCount, 1));
  assert.equal(result.current.otherOpenCount, 1);
  assert.equal(result.current.isVisible, true);

  // A chat that is not that group's master does not get it.
  const plain = renderHook(() => useAgentAsksPanel('plain', false, 'decagon'), { wrapper });
  await waitFor(() => assert.equal(plain.result.current.otherOpenCount, 2));
  assert.equal(plain.result.current.openCount, 0);
  assert.equal(plain.result.current.isVisible, false);

  const navigated: string[] = [];
  render(
    <AgentAsksProvider subscribe={socket.subscribe}>
      <AgentAsksPanel
        sessionId="master"
        sessionTitle="mt7995 master"
        isMobile={false}
        onClose={() => {}}
        onNavigateToSession={(id) => navigated.push(id)}
      />
    </AgentAsksProvider>,
  );

  const groupItem = await screen.findByTestId('agent-ask-group');
  assert.equal(groupItem.textContent?.includes('May I read the bench counters?'), true);
  assert.equal(groupItem.textContent?.includes('mt7995: station data path'), true);
  // The group's item is not repeated under the other chats.
  assert.equal(screen.getAllByTestId('agent-asks-other-chat').length, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Open the chat to answer' }));
  assert.deepEqual(navigated, ['child-1']);
});
