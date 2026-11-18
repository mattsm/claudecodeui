import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, RecentConversationListItem } from '@/shared/types';

/**
 * The Agents tab is the sidebar's default and reads the same recent-chats feed
 * as the Conversations tab, at the largest page the server allows. The search
 * box filters what is loaded, so typing must not refetch the feed. It also
 * starts the transcript search, for chats whose title does not say it.
 */

const feedRequests: { limit?: number; offset?: number }[] = [];
let feed: RecentConversationListItem[] = [];
const openedUrls: string[] = [];

class FakeEventSource {
  constructor(url: string) {
    openedUrls.push(url);
  }
  addEventListener() {}
  close() {}
}

vi.mock('@/shared/api', () => ({
  api: {
    recentConversations: (request: { limit?: number; offset?: number }) => {
      feedRequests.push(request);
      const conversations = feed;
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { conversations, total: conversations.length, hasMore: false } }),
      });
    },
    searchConversationsUrl: (query: string) => `/api/providers/search/sessions?q=${query}`,
    archivedProjects: () => Promise.resolve({ ok: true, json: async () => ({ data: { projects: [] } }) }),
    getArchivedSessions: () => Promise.resolve({ ok: true, json: async () => ({ data: { sessions: [] } }) }),
  },
}));

const { useSidebarController } = await import('@/modules/sidebar/hooks/useSidebarController');

const t = ((key: string) => key) as unknown as TFunction;

const conversation = (sessionId: string): RecentConversationListItem => ({
  sessionId,
  provider: 'claude',
  projectId: 'project-1',
  projectDisplayName: 'repo',
  sessionTitle: `wireless lab: ${sessionId}`,
  lastActivity: '2026-11-16T09:30:00.000Z',
});

// One array for every render: the controller resets state when `projects` changes identity.
const PROJECTS: Project[] = [];

const renderController = (initialActiveSessions: string[] = []) => renderHook(
  ({ activeSessions }: { activeSessions: string[] }) => useSidebarController({
    projects: PROJECTS,
    selectedProject: null,
    selectedSession: null,
    activeSessions: new Set(activeSessions),
    backgroundSessionIds: new Set<string>(),
    isLoading: false,
    isMobile: false,
    t,
    onRefresh: vi.fn(),
    onProjectSelect: vi.fn(),
    onSessionSelect: vi.fn(),
    setCurrentProject: vi.fn(),
    setSidebarVisible: vi.fn(),
    sidebarVisible: true,
  }),
  { initialProps: { activeSessions: initialActiveSessions } },
);

const settle = () => act(() => new Promise<void>((resolve) => { setTimeout(resolve, 450); }));

beforeEach(() => {
  localStorage.clear();
  feedRequests.length = 0;
  openedUrls.length = 0;
  feed = [conversation('a'), conversation('b')];
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
});

afterEach(() => {
  delete (globalThis as { EventSource?: unknown }).EventSource;
});

test('the sidebar opens on the Agents tab and loads a 100-chat page of the feed', async () => {
  const { result } = renderController();

  assert.equal(result.current.searchMode, 'agents');
  await waitFor(() => {
    assert.equal(result.current.recentConversations.length, 2);
  });
  assert.deepEqual(feedRequests, [{ limit: 100, offset: 0 }]);
});

test('the Conversations tab keeps its own page size', async () => {
  const { result } = renderController();
  await waitFor(() => {
    assert.equal(feedRequests.length, 1);
  });

  act(() => {
    result.current.setSearchMode('conversations');
  });

  await waitFor(() => {
    assert.deepEqual(feedRequests, [{ limit: 100, offset: 0 }, { limit: 40, offset: 0 }]);
  });
});

test('typing in the Agents tab searches transcripts and does not refetch the feed', async () => {
  const { result } = renderController();
  await waitFor(() => {
    assert.equal(result.current.recentConversations.length, 2);
  });

  act(() => {
    result.current.setSearchFilter('map ui');
  });
  await settle();

  assert.equal(feedRequests.length, 1);
  assert.deepEqual(openedUrls, ['/api/providers/search/sessions?q=map ui']);
});

test('a chat started while the feed is empty shows up', async () => {
  feed = [];
  const { result, rerender } = renderController();
  await waitFor(() => {
    assert.equal(feedRequests.length, 1);
  });
  await settle();

  feed = [conversation('first')];
  rerender({ activeSessions: ['first'] });
  await waitFor(() => {
    assert.equal(result.current.recentConversations.length, 1);
  });
});

test('a running chat the feed does not hold reloads it once', async () => {
  const { result, rerender } = renderController(['a']);
  await waitFor(() => {
    assert.equal(result.current.recentConversations.length, 2);
  });
  assert.equal(feedRequests.length, 1);

  // A chat started after the feed was fetched.
  feed = [conversation('new'), conversation('a'), conversation('b')];
  rerender({ activeSessions: ['a', 'new'] });
  await waitFor(() => {
    assert.equal(result.current.recentConversations.length, 3);
  });
  assert.equal(feedRequests.length, 2);

  // A running session the feed never lists is asked about once, not on every render.
  rerender({ activeSessions: ['a', 'new', 'hidden'] });
  await settle();
  rerender({ activeSessions: ['a', 'new', 'hidden'] });
  await settle();
  assert.equal(feedRequests.length, 3);
});
