import assert from 'node:assert/strict';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import type { Project, RecentConversationListItem, SessionRowActions, SidebarProjectListProps } from '@/shared/types';

// The menu's pin item as a plain button, so a test can pin without opening a menu.
vi.mock('@/modules/sidebar/SessionOptions', () => ({
  default: ({ sessionId, onTogglePin, isPinned }: { sessionId: string; onTogglePin?: () => void; isPinned?: boolean }) => (
    <button type="button" onClick={onTogglePin}>{`${isPinned ? 'unpin' : 'pin'} ${sessionId}`}</button>
  ),
}));

// The preference store without its server write.
const preferenceStore = vi.hoisted(() => ({ values: {} as Record<string, unknown>, listeners: new Set<() => void>() }));
vi.mock('@/shared/userSettings', () => ({
  readUserPreference: (key: string, fallback: unknown) => preferenceStore.values[key] ?? fallback,
  writeUserPreference: (key: string, value: unknown) => {
    preferenceStore.values[key] = value;
    preferenceStore.listeners.forEach((listener) => listener());
  },
  subscribeToUserPreferences: (listener: () => void) => {
    preferenceStore.listeners.add(listener);
    return () => { preferenceStore.listeners.delete(listener); };
  },
}));

const { default: SidebarAgents } = await import('@/modules/sidebar/SidebarAgents');

const t = ((key: string, options?: string | Record<string, unknown>) => {
  if (typeof options === 'string') {
    return options;
  }
  const template = typeof options?.defaultValue === 'string' ? options.defaultValue : key;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
}) as unknown as SidebarProjectListProps['t'];
const NOW = new Date('2026-11-16T10:00:00.000Z');
const noop = () => {};

const chat = (sessionTitle: string): RecentConversationListItem => ({
  sessionId: `id:${sessionTitle}`,
  provider: 'claude',
  projectId: 'project-1',
  projectDisplayName: 'git',
  sessionTitle,
  lastActivity: '2026-11-16T09:30:00.000Z',
});

const CHATS = [
  chat('wireless lab: map UI'),
  chat('decagon'),
  chat('wireless lab master'),
  chat('wireless lab: release'),
  chat('virt-wifi: azure'),
  chat('virt-wifi: airplay'),
];

const project = (projectId: string, displayName: string): Project => ({
  projectId,
  path: `/home/${displayName}`,
  fullPath: `/home/${displayName}`,
  displayName,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
});
const GIT = project('project-1', 'git');
const HOME = project('project-2', 'home');

const makeActions = (overrides: Partial<SessionRowActions> = {}): SessionRowActions => ({
  activeRename: null,
  activeSessions: new Set<string>(),
  backgroundSessionIds: new Set<string>(),
  attentionSessionIds: new Set<string>(),
  onRenameDraftChange: noop,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  onArchiveSession: noop,
  onDeleteSession: noop,
  ...overrides,
});

const agentsElement = (props: Partial<React.ComponentProps<typeof SidebarAgents>> = {}) => (
  <SidebarAgents
    conversations={CHATS}
    hasMore={false}
    isLoading={false}
    isLoadingMore={false}
    hasError={false}
    searchFilter=""
    selectedSession={null}
    currentTime={NOW}
    sessionActions={makeActions()}
    onConversationSelect={noop}
    onLoadMore={noop}
    onRetry={noop}
    projects={[HOME, GIT]}
    selectedProject={null}
    onNewAgent={noop}
    onCreateProject={noop}
    t={t}
    {...props}
  />
);

const renderAgents = (props: Partial<React.ComponentProps<typeof SidebarAgents>> = {}) => render(agentsElement(props));

const rowTitles = (container: HTMLElement) =>
  within(container).queryAllByTestId('agent-chat-row').map((row) => row.getAttribute('title'));

beforeEach(() => {
  localStorage.clear();
  preferenceStore.values = {};
});

test('chats are listed under their master chat or their shared prefix', () => {
  renderAgents();

  const [lab, virt] = screen.getAllByTestId('agent-group');
  assert.deepEqual(rowTitles(lab), ['wireless lab master', 'wireless lab: map UI', 'wireless lab: release']);
  // A grouped chat drops the prefix its header shows.
  assert.ok(within(lab).getByText('map UI'));
  assert.deepEqual(rowTitles(virt), ['virt-wifi: azure', 'virt-wifi: airplay']);
  assert.ok(within(virt).getByText('virt-wifi'));
  assert.equal(screen.getAllByTestId('agent-chat-row').length, 6);
});

test('a group collapses with its toggle and stays collapsed after a reload', () => {
  const first = renderAgents();

  const toggle = screen.getByRole('button', { name: 'Collapse wireless lab' });
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  fireEvent.click(toggle);

  const [lab] = screen.getAllByTestId('agent-group');
  assert.deepEqual(rowTitles(lab), ['wireless lab master']);
  assert.equal(screen.getByRole('button', { name: 'Expand wireless lab' }).getAttribute('aria-expanded'), 'false');

  first.unmount();
  renderAgents();
  assert.deepEqual(rowTitles(screen.getAllByTestId('agent-group')[0]), ['wireless lab master']);
});

test('a group shows how many of its chats are running', () => {
  renderAgents({
    sessionActions: makeActions({
      activeSessions: new Set(['id:wireless lab master', 'id:wireless lab: release', 'id:decagon']),
      backgroundSessionIds: new Set(['id:wireless lab: release']),
    }),
  });

  const [labCount, virtCount] = screen.getAllByTestId('agent-group-running');
  assert.equal(labCount.textContent, '2/3');
  assert.equal(labCount.getAttribute('aria-label'), '2 of 3 chats running');
  assert.equal(virtCount.textContent, '0/2');
});

test('the count stays on a collapsed group', () => {
  renderAgents({
    sessionActions: makeActions({ activeSessions: new Set(['id:wireless lab: map UI']) }),
  });

  fireEvent.click(screen.getByRole('button', { name: 'Collapse wireless lab' }));
  assert.equal(screen.getAllByTestId('agent-group-running')[0].textContent, '1/3');
});

test('a collapsed group shows the bench resources its chats hold', () => {
  renderAgents({ conversations: [...CHATS, chat('[A3] wireless lab: verify Wi-Fi'), chat('🍎 virt-wifi: mac')] });

  // Open, each marker is drawn once, on its own chat.
  assert.equal(screen.queryAllByTestId('agent-group-lock').length, 0);
  assert.equal(screen.getAllByRole('img', { name: 'Holds the bench A3' }).length, 1);

  fireEvent.click(screen.getByRole('button', { name: 'Collapse wireless lab' }));
  const [lab, virt] = screen.getAllByTestId('agent-group');
  assert.equal(within(lab).getAllByTestId('agent-group-lock').length, 1);
  assert.equal(within(lab).getAllByRole('img', { name: 'Holds the bench A3' }).length, 1);
  assert.equal(within(lab).getByTestId('agent-group-lock').getAttribute('title'), '[A3] verify Wi-Fi');
  assert.equal(within(virt).queryAllByTestId('agent-group-lock').length, 0);

  fireEvent.click(screen.getByRole('button', { name: 'Collapse virt-wifi' }));
  assert.equal(within(screen.getAllByTestId('agent-group')[1]).getAllByRole('img', { name: 'Holds the bench Mac mini' }).length, 1);
});

test('the search filters by title and opens a collapsed group', () => {
  const first = renderAgents();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse wireless lab' }));
  first.unmount();

  renderAgents({ searchFilter: 'release' });
  assert.deepEqual(rowTitles(document.body), ['wireless lab master', 'wireless lab: release']);
});

test('a search with no title hit stays quiet while transcript hits are listed under it', () => {
  renderAgents({ searchFilter: 'zzz', showNoMatches: false });

  assert.equal(screen.queryAllByTestId('agent-chat-row').length, 0);
  assert.equal(screen.queryByText('No agents match this search.') === null, true);
});

test('a search with no hit says so', () => {
  renderAgents({ searchFilter: 'zzz' });

  assert.equal(screen.queryAllByTestId('agent-chat-row').length, 0);
  assert.ok(screen.getByText('No agents match this search.'));
});

test('older pages stay reachable from a search with no hit', () => {
  let loads = 0;
  renderAgents({ searchFilter: 'zzz', hasMore: true, onLoadMore: () => { loads += 1; } });

  fireEvent.click(screen.getByRole('button', { name: 'Load older conversations' }));
  assert.equal(loads, 1);
});

test('New agent starts a chat in the project on screen', () => {
  const started: string[] = [];
  renderAgents({ selectedProject: HOME, onNewAgent: (target) => started.push(target.displayName) });

  fireEvent.click(screen.getByTestId('new-agent-button'));
  assert.deepEqual(started, ['home']);
});

test('with no project on screen, New agent uses the newest chat\'s project', () => {
  const started: string[] = [];
  renderAgents({ onNewAgent: (target) => started.push(target.displayName) });

  // The picker beside the button names the project the button will use.
  assert.equal(screen.getByRole('button', { name: 'New agent in another project' }).textContent, 'git');
  fireEvent.click(screen.getByTestId('new-agent-button'));
  assert.deepEqual(started, ['git']);
});

test('the picker beside New agent lists every project with its folder and starts the agent in the one picked', () => {
  const started: string[] = [];
  renderAgents({ onNewAgent: (target) => started.push(target.displayName) });

  fireEvent.click(screen.getByRole('button', { name: 'New agent in another project' }));
  assert.deepEqual(
    screen.getAllByRole('menuitem').map((item) => item.textContent),
    ['home/home/home', 'git/home/git', 'Another folder...Add a folder as a project, then start the agent in it.'],
  );
  fireEvent.click(screen.getByRole('menuitem', { name: /^home/ }));
  assert.deepEqual(started, ['home']);
});

test('the picker offers a folder that is not a project yet', () => {
  let opened = 0;
  renderAgents({ onCreateProject: () => { opened += 1; } });

  fireEvent.click(screen.getByRole('button', { name: 'New agent in another project' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /^Another folder/ }));
  assert.equal(opened, 1);
});

test('New agent and its picker stay on an empty list', () => {
  const started: string[] = [];
  renderAgents({ conversations: [], projects: [GIT], onNewAgent: (target) => started.push(target.displayName) });

  assert.equal(screen.getByRole('button', { name: 'New agent in another project' }).textContent, 'git');
  assert.equal(screen.getByTestId('new-agent-button').textContent, 'New agent');
  fireEvent.click(screen.getByTestId('new-agent-button'));
  assert.deepEqual(started, ['git']);
});

test('without a project there is no New agent button', () => {
  renderAgents({ projects: [] });

  assert.equal(screen.queryByTestId('new-agent-button') === null, true);
});

test('the menu pins a chat to the top and unpins it again', () => {
  renderAgents();
  assert.equal(screen.queryAllByTestId('agent-pinned').length, 0);

  fireEvent.click(screen.getByRole('button', { name: 'pin id:decagon' }));
  assert.deepEqual(rowTitles(document.body).slice(0, 2), ['decagon', 'wireless lab master']);
  assert.equal(screen.getAllByTestId('agent-pinned').length, 1);
  assert.deepEqual(preferenceStore.values.agentsPinnedSessions, ['id:decagon']);

  fireEvent.click(screen.getByRole('button', { name: 'unpin id:decagon' }));
  assert.deepEqual(rowTitles(document.body).slice(0, 2), ['wireless lab master', 'wireless lab: map UI']);
  assert.deepEqual(preferenceStore.values.agentsPinnedSessions, []);
});

test('a pinned chat inside a group is listed on its own at the top', () => {
  preferenceStore.values.agentsPinnedSessions = ['id:wireless lab: release', 'id:virt-wifi: airplay'];
  renderAgents();

  assert.deepEqual(rowTitles(document.body), [
    'wireless lab: release', 'virt-wifi: airplay',
    'wireless lab master', 'wireless lab: map UI', 'decagon', 'virt-wifi: azure',
  ]);
  // Lifted out, the chat shows its full title.
  assert.ok(screen.getByText('wireless lab: release'));
  assert.equal(screen.getAllByTestId('agent-group').length, 1);
});

test('a pin made on another device shows up when the preferences arrive', () => {
  renderAgents();

  act(() => {
    preferenceStore.values.agentsPinnedSessions = ['id:decagon'];
    preferenceStore.listeners.forEach((listener) => listener());
  });
  assert.equal(rowTitles(document.body)[0], 'decagon');
});

test('older pages are loaded while a pinned chat is not in the feed yet', () => {
  preferenceStore.values.agentsPinnedSessions = ['id:old chat'];
  let loads = 0;
  const { rerender } = renderAgents({ hasMore: true, onLoadMore: () => { loads += 1; } });
  assert.equal(loads, 1);
  assert.deepEqual(preferenceStore.values.agentsPinnedSessions, ['id:old chat']);

  // The next page holds it: it is pinned, and nothing more is loaded.
  rerender(agentsElement({ conversations: [...CHATS, chat('old chat')], hasMore: true, onLoadMore: () => { loads += 1; } }));
  assert.equal(loads, 1);
  assert.equal(rowTitles(document.body)[0], 'old chat');
});

test('a pin for a chat that is in no page of the feed is dropped', () => {
  preferenceStore.values.agentsPinnedSessions = ['id:archived chat', 'id:decagon'];
  renderAgents({ hasMore: false });

  assert.deepEqual(preferenceStore.values.agentsPinnedSessions, ['id:decagon']);
});

test('a pin is kept while the feed is still loading or failed to load', () => {
  preferenceStore.values.agentsPinnedSessions = ['id:old chat'];
  renderAgents({ hasMore: false, isLoading: true });
  renderAgents({ hasMore: false, hasError: true });
  renderAgents({ hasMore: false, conversations: [] });

  assert.deepEqual(preferenceStore.values.agentsPinnedSessions, ['id:old chat']);
});

test('a click opens the chat', () => {
  const opened: unknown[][] = [];
  renderAgents({ onConversationSelect: (...args) => opened.push(args) });

  fireEvent.click(screen.getByText('decagon'));
  assert.deepEqual(opened, [['project-1', 'id:decagon', 'claude']]);
});
