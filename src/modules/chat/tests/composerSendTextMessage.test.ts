import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { clearQueuedMessage } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession, SessionActivityMap } from '@/shared/types';

/**
 * `sendTextMessage` sends text that did not come from the composer: the
 * questions panel's answers. The agent must get it without the user losing
 * what they are typing, and a running turn or background work must not be
 * interrupted by it.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };

const backgroundOnly: SessionActivityMap = new Map([[
  'session-1',
  {
    statusText: null,
    canInterrupt: false,
    startedAt: 1,
    background: true,
    tasks: [{ taskId: 'a1', toolUseId: 'toolu_agent', taskType: 'local_agent', description: 'Survey the repo', startedAt: 3 }],
  },
]]);

const queuedPosts = () => vi.mocked(fetch).mock.calls
  .filter(([url, init]) => String(url).includes('/api/user/drafts/queued-message') && init?.method === 'POST')
  .map(([, init]) => JSON.parse(String(init?.body)) as { scope: string; queuedMessage: { content: string } });

const render = (options: { isLoading?: boolean; processingSessions?: SessionActivityMap } = {}) => {
  const sent: Array<{ type: string; content?: string; anchorId?: string }> = [];
  const view = renderHook(() =>
    useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: SESSION,
      currentSessionId: SESSION.id,
      provider: 'claude',
      permissionMode: 'default',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: 'test-model',
      currentProviderEffort: 'medium',
      isLoading: options.isLoading ?? false,
      processingSessions: options.processingSessions ?? new Map(),
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as { type: string }); },
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  );
  return { view, sent };
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('/api/user/drafts/queued-message') && init?.method === 'POST') {
      const { queuedMessage } = JSON.parse(String(init.body)) as { queuedMessage: unknown };
      return new Response(JSON.stringify({ success: true, queuedMessage, appended: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  clearQueuedMessage(SESSION.id);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('on an idle session the text is sent at once and the composer keeps what was typed', async () => {
  const { view, sent } = render();
  await act(async () => { view.result.current.setInput('half a thought'); });

  await act(async () => { await view.result.current.sendTextMessage('Answer to your question #7: yes'); });

  assert.deepEqual(sent.map((message) => [message.type, message.content]), [['chat.send', 'Answer to your question #7: yes']]);
  assert.equal(view.result.current.input, 'half a thought');
  assert.equal(queuedPosts().length, 0);
});

test('an edit in progress stays an edit: the text goes as a new message', async () => {
  const { view, sent } = render();
  await act(async () => {
    view.result.current.beginEditMessage({ type: 'user', content: 'old text', timestamp: new Date(), transcriptAnchorId: 'anchor-1' } as never);
  });
  const editingAnchorId = view.result.current.editingAnchorId;
  assert.notEqual(editingAnchorId, null);

  await act(async () => { await view.result.current.sendTextMessage('Acknowledged #3.'); });

  assert.deepEqual(sent.map((message) => [message.type, message.anchorId]), [['chat.send', undefined]]);
  assert.equal(view.result.current.editingAnchorId, editingAnchorId);
});

test('behind a running turn the text is queued, not sent over it', async () => {
  const { view, sent } = render({ isLoading: true });
  await act(async () => { view.result.current.setInput('still typing'); });

  await act(async () => { await view.result.current.sendTextMessage('Answer to your question #8: no'); });

  assert.equal(sent.length, 0);
  assert.deepEqual(queuedPosts().map((post) => [post.scope, post.queuedMessage.content]), [['session-1', 'Answer to your question #8: no']]);
  assert.equal(view.result.current.input, 'still typing');
  assert.equal(view.result.current.queuedDraft?.content, 'Answer to your question #8: no');
});

test('behind background work the text is queued without asking', async () => {
  const { view, sent } = render({ processingSessions: backgroundOnly });

  await act(async () => { await view.result.current.sendTextMessage('Acknowledged #9.'); });

  assert.equal(sent.length, 0);
  assert.equal(view.result.current.backgroundSendPrompt, null);
  assert.deepEqual(queuedPosts().map((post) => post.queuedMessage.content), ['Acknowledged #9.']);
});
