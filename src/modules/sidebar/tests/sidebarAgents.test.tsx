import assert from 'node:assert/strict';

import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import type { Project, RecentConversationListItem, SessionRowActions, SidebarProjectListProps } from '@/shared/types';

vi.mock('@/modules/sidebar/SessionOptions', () => ({ default: () => null }));

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

const renderAgents = (props: Partial<React.ComponentProps<typeof SidebarAgents>> = {}) => render(
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
    t={t}
    {...props}
  />,
);

const rowTitles = (container: HTMLElement) =>
  within(container).queryAllByTestId('agent-chat-row').map((row) => row.getAttribute('title'));

beforeEach(() => {
  localStorage.clear();
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

  const button = screen.getByTestId('new-agent-button');
  assert.ok(button.textContent?.includes('git'));
  fireEvent.click(button);
  assert.deepEqual(started, ['git']);
});

test('the menu beside New agent picks another project', () => {
  const started: string[] = [];
  renderAgents({ onNewAgent: (target) => started.push(target.displayName) });

  fireEvent.click(screen.getByRole('button', { name: 'New agent in another project' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'home' }));
  assert.deepEqual(started, ['home']);
});

test('one project needs no menu, and New agent stays on an empty list', () => {
  const started: string[] = [];
  renderAgents({ conversations: [], projects: [GIT], onNewAgent: (target) => started.push(target.displayName) });

  assert.equal(screen.queryByRole('button', { name: 'New agent in another project' }) === null, true);
  assert.equal(screen.getByTestId('new-agent-button').textContent, 'New agent');
  fireEvent.click(screen.getByTestId('new-agent-button'));
  assert.deepEqual(started, ['git']);
});

test('without a project there is no New agent button', () => {
  renderAgents({ projects: [] });

  assert.equal(screen.queryByTestId('new-agent-button') === null, true);
});

test('a click opens the chat', () => {
  const opened: unknown[][] = [];
  renderAgents({ onConversationSelect: (...args) => opened.push(args) });

  fireEvent.click(screen.getByText('decagon'));
  assert.deepEqual(opened, [['project-1', 'id:decagon', 'claude']]);
});
