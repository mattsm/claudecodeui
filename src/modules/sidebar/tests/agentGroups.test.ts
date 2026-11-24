import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { RecentConversationListItem } from '@/shared/types';
import { agentEntryRows, filterAgentEntries, groupAgentConversations, pinAgentConversations } from '@/modules/sidebar/utils/agentGroups';
import type { AgentEntry } from '@/modules/sidebar/utils/agentGroups';

const chat = (sessionTitle: string): RecentConversationListItem => ({
  sessionId: `id:${sessionTitle}`,
  provider: 'claude',
  projectId: 'project-1',
  projectDisplayName: 'git',
  sessionTitle,
  lastActivity: '2026-11-16T09:30:00.000Z',
});

/** "group name [master title] > member labels" for a group, the title for a chat. */
const describeEntries = (entries: AgentEntry[]) => entries.map((entry) => (
  entry.kind === 'chat'
    ? entry.row.label
    : `${entry.name} [${entry.master?.label ?? '-'}] > ${entry.members.map((row) => row.label).join(' | ')}`
));

test('an "X: ..." chat sits under the "X master ..." chat', () => {
  const entries = groupAgentConversations([
    chat('wireless lab: map UI'),
    chat('MASTER'),
    chat('wireless lab master (mesh lab master)'),
    chat('wireless lab: verify Wi-Fi'),
    chat('secure boot (keys)'),
  ]);

  assert.deepEqual(describeEntries(entries), [
    'MASTER',
    'wireless lab [wireless lab master (mesh lab master)] > map UI | verify Wi-Fi',
    'secure boot (keys)',
  ]);
});

test('two "X:" chats without a master group under a plain "X" header', () => {
  const entries = groupAgentConversations([
    chat('virt-wifi: azure'),
    chat('decagon'),
    chat('Virt-WiFi: airplay'),
  ]);

  assert.deepEqual(describeEntries(entries), [
    'virt-wifi [-] > azure | airplay',
    'decagon',
  ]);
});

test('one "X:" chat without a master, and a master without chats, stay on their own', () => {
  const entries = groupAgentConversations([
    chat('reviews: can you review'),
    chat('mesh lab master'),
    chat('would https://github.com/meterup/firmware/pull/5290 change the'),
  ]);

  assert.deepEqual(describeEntries(entries), [
    'reviews: can you review',
    'mesh lab master',
    'would https://github.com/meterup/firmware/pull/5290 change the',
  ]);
});

test('a group sits where its master chat was, and a second master is listed under the first', () => {
  const entries = groupAgentConversations([
    chat('atf'),
    chat('wireless lab: release'),
    chat('decagon'),
    chat('wireless lab master'),
    chat('wireless lab master (old)'),
  ]);

  assert.deepEqual(describeEntries(entries), [
    'atf',
    'decagon',
    'wireless lab [wireless lab master] > release | wireless lab master (old)',
  ]);
});

test('a group without a master sits where its most recent chat was', () => {
  const entries = groupAgentConversations([
    chat('atf'),
    chat('virt-wifi: azure'),
    chat('decagon'),
    chat('virt-wifi: airplay'),
  ]);

  assert.deepEqual(describeEntries(entries), ['atf', 'virt-wifi [-] > azure | airplay', 'decagon']);
});

test('a bench-lock marker is not part of the name, and stays on the label', () => {
  const entries = groupAgentConversations([
    chat('[A2] wireless lab: verify Wi-Fi'),
    chat('🍎 wireless lab master'),
  ]);

  assert.deepEqual(describeEntries(entries), [
    'wireless lab [🍎 wireless lab master] > [A2] verify Wi-Fi',
  ]);
});

test('"X: master notes" is a chat of X, not its master', () => {
  const entries = groupAgentConversations([
    chat('wireless lab: master notes'),
    chat('wireless lab: map UI'),
  ]);

  assert.deepEqual(describeEntries(entries), ['wireless lab [-] > master notes | map UI']);
});

test('the search keeps the chats whose title holds every word, under their header', () => {
  const entries = groupAgentConversations([
    chat('wireless lab master'),
    chat('wireless lab: map UI'),
    chat('wireless lab: UI kit'),
    chat('wireless lab: release'),
    chat('ui review'),
    chat('decagon'),
  ]);

  assert.deepEqual(describeEntries(filterAgentEntries(entries, '  UI ')), [
    'wireless lab [wireless lab master] > map UI | UI kit',
    'ui review',
  ]);
  assert.deepEqual(describeEntries(filterAgentEntries(entries, 'lab map')), [
    'wireless lab [wireless lab master] > map UI',
  ]);
  assert.deepEqual(describeEntries(filterAgentEntries(entries, 'master')), [
    'wireless lab [wireless lab master] > ',
  ]);
  assert.deepEqual(filterAgentEntries(entries, 'nothing here'), []);
  assert.equal(filterAgentEntries(entries, ''), entries);
});

test('a group counts its master with its chats', () => {
  const [group] = groupAgentConversations([
    chat('wireless lab: map UI'),
    chat('wireless lab master'),
  ]);

  assert.deepEqual(
    agentEntryRows(group).map((row) => row.conversation.sessionTitle),
    ['wireless lab master', 'wireless lab: map UI'],
  );
});

const FEED = [
  chat('atf'),
  chat('wireless lab: release'),
  chat('decagon'),
  chat('wireless lab master'),
  chat('wireless lab: map UI'),
  chat('virt-wifi: azure'),
  chat('virt-wifi: airplay'),
];
const describePinned = (pinnedTitles: string[]) => {
  const { pinned, entries } = pinAgentConversations(FEED, pinnedTitles.map((title) => `id:${title}`));
  return { pinned: describeEntries(pinned), entries: describeEntries(entries) };
};

test('a pinned chat moves to the top, in the order the chats were pinned', () => {
  assert.deepEqual(describePinned(['decagon', 'atf']), {
    pinned: ['decagon', 'atf'],
    entries: [
      'wireless lab [wireless lab master] > release | map UI',
      'virt-wifi [-] > azure | airplay',
    ],
  });
});

test('pinning a master chat moves its whole group to the top', () => {
  assert.deepEqual(describePinned(['wireless lab master']), {
    pinned: ['wireless lab [wireless lab master] > release | map UI'],
    entries: ['atf', 'decagon', 'virt-wifi [-] > azure | airplay'],
  });
});

test('pinning a chat inside a group lifts only that chat out, under its full title', () => {
  assert.deepEqual(describePinned(['wireless lab: map UI']), {
    pinned: ['wireless lab: map UI'],
    entries: ['atf', 'decagon', 'wireless lab [wireless lab master] > release', 'virt-wifi [-] > azure | airplay'],
  });
  // A group of two without a master does not survive losing one.
  assert.deepEqual(describePinned(['virt-wifi: azure']), {
    pinned: ['virt-wifi: azure'],
    entries: ['atf', 'decagon', 'wireless lab [wireless lab master] > release | map UI', 'virt-wifi: airplay'],
  });
});

test('a pin for a chat the feed does not hold is skipped, and no pins means no change', () => {
  assert.deepEqual(describePinned(['gone', 'atf']).pinned, ['atf']);
  assert.deepEqual(describePinned([]).pinned, []);
  assert.deepEqual(describePinned([]).entries, describeEntries(groupAgentConversations(FEED)));
});
