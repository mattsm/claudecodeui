import type { RecentConversationListItem } from '@/shared/types';
import { splitBenchLockPrefix } from '@/shared/ui/SessionTitle';
import { readAgentTitleRole } from '@/shared/utils';

/** One chat in the Agents tab. `label` is the title to draw: a grouped chat drops the "X: " its header already shows. */
export type AgentRow = {
  conversation: RecentConversationListItem;
  label: string;
};

/**
 * A top-level entry of the Agents tab: a chat on its own, or a group of chats
 * that share a title prefix. A group is headed by its master chat, or by the
 * bare prefix when no chat is titled "X master".
 */
export type AgentEntry =
  | { kind: 'chat'; key: string; row: AgentRow }
  | { kind: 'group'; key: string; name: string; master: AgentRow | null; members: AgentRow[] };

/**
 * Groups the recent-chats feed for the Agents tab. Entries keep the feed's
 * order. A group sits where its master chat was, so busy chats under a quiet
 * master do not lift it. Without a master it sits where its most recent chat was.
 */
export function groupAgentConversations(conversations: RecentConversationListItem[]): AgentEntry[] {
  const parsed = conversations.map((conversation) => {
    // Bench-lock markers sit in front of the title and are not part of its name.
    const { title } = splitBenchLockPrefix(conversation.sessionTitle);
    const markers = conversation.sessionTitle.slice(0, conversation.sessionTitle.length - title.length);
    return { conversation, markers, role: readAgentTitleRole(title.trim()) };
  });

  const masterByKey = new Map<string, RecentConversationListItem>();
  const memberCountByKey = new Map<string, number>();
  const nameByKey = new Map<string, string>();
  for (const { conversation, role } of parsed) {
    if (role.role === 'none') {
      continue;
    }
    if (role.role === 'master' && !masterByKey.has(role.key)) {
      masterByKey.set(role.key, conversation);
      nameByKey.set(role.key, role.name);
      continue;
    }
    // A second "X master" is listed under the first.
    memberCountByKey.set(role.key, (memberCountByKey.get(role.key) ?? 0) + 1);
    if (!nameByKey.has(role.key)) {
      nameByKey.set(role.key, role.name);
    }
  }

  const isGroup = (key: string) => {
    const members = memberCountByKey.get(key) ?? 0;
    return masterByKey.has(key) ? members >= 1 : members >= 2;
  };

  const entries: AgentEntry[] = [];
  const groupByKey = new Map<string, Extract<AgentEntry, { kind: 'group' }>>();
  for (const { conversation, markers, role } of parsed) {
    if (role.role === 'none' || !isGroup(role.key)) {
      entries.push({
        kind: 'chat',
        key: conversation.sessionId,
        row: { conversation, label: conversation.sessionTitle },
      });
      continue;
    }

    const master = masterByKey.get(role.key);
    let group = groupByKey.get(role.key);
    if (!group) {
      group = { kind: 'group', key: role.key, name: nameByKey.get(role.key) ?? role.name, master: null, members: [] };
      groupByKey.set(role.key, group);
      if (!master) {
        entries.push(group);
      }
    }

    if (master === conversation) {
      group.master = { conversation, label: conversation.sessionTitle };
      entries.push(group);
    } else {
      const rest = role.role === 'member' ? role.rest : '';
      group.members.push({ conversation, label: rest ? `${markers}${rest}` : conversation.sessionTitle });
    }
  }

  return entries;
}

/**
 * Splits the feed into the pinned entries, in pin order, and the rest.
 *
 * Pinning a group's master chat, or a chat on its own, moves that whole entry
 * to the top. Pinning a chat inside a group lifts just that chat out of it.
 */
export function pinAgentConversations(
  conversations: RecentConversationListItem[],
  pinnedIds: string[],
): { pinned: AgentEntry[]; entries: AgentEntry[] } {
  if (pinnedIds.length === 0) {
    return { pinned: [], entries: groupAgentConversations(conversations) };
  }

  const pinnedSet = new Set(pinnedIds);
  const headsEntry = (entry: AgentEntry, sessionId: string) => (
    entry.kind === 'chat' ? entry.row.conversation.sessionId === sessionId : entry.master?.conversation.sessionId === sessionId
  );
  const lifted = new Set<string>();
  for (const entry of groupAgentConversations(conversations)) {
    if (entry.kind === 'group') {
      for (const row of entry.members) {
        if (pinnedSet.has(row.conversation.sessionId)) {
          lifted.add(row.conversation.sessionId);
        }
      }
    }
  }

  // Grouped again without the lifted chats, so a group they leave is judged on what is left of it.
  const grouped = groupAgentConversations(conversations.filter((conversation) => !lifted.has(conversation.sessionId)));
  const byId = new Map(conversations.map((conversation) => [conversation.sessionId, conversation]));
  const pinned: AgentEntry[] = [];
  const moved = new Set<AgentEntry>();
  for (const sessionId of pinnedIds) {
    const conversation = byId.get(sessionId);
    if (!conversation) {
      continue;
    }
    if (lifted.has(sessionId)) {
      pinned.push({ kind: 'chat', key: sessionId, row: { conversation, label: conversation.sessionTitle } });
      continue;
    }
    const entry = grouped.find((candidate) => headsEntry(candidate, sessionId));
    if (entry && !moved.has(entry)) {
      moved.add(entry);
      pinned.push(entry);
    }
  }

  return { pinned, entries: grouped.filter((entry) => !moved.has(entry)) };
}

/**
 * Narrows the entries to the chats whose title holds every word of the query.
 * A group keeps its master as the header while any of its chats match.
 */
export function filterAgentEntries(entries: AgentEntry[], query: string): AgentEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return entries;
  }

  const matches = (row: AgentRow) => {
    const title = row.conversation.sessionTitle.toLowerCase();
    return words.every((word) => title.includes(word));
  };

  return entries.flatMap((entry): AgentEntry[] => {
    if (entry.kind === 'chat') {
      return matches(entry.row) ? [entry] : [];
    }
    const members = entry.members.filter(matches);
    if (members.length === 0 && !(entry.master && matches(entry.master))) {
      return [];
    }
    return [{ ...entry, members }];
  });
}

/** Every chat of an entry, the master first. */
export function agentEntryRows(entry: AgentEntry): AgentRow[] {
  if (entry.kind === 'chat') {
    return [entry.row];
  }
  return entry.master ? [entry.master, ...entry.members] : entry.members;
}
