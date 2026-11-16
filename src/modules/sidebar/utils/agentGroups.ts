import type { RecentConversationListItem } from '@/shared/types';
import { splitBenchLockPrefix } from '@/shared/ui/SessionTitle';

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

type TitleRole =
  | { role: 'master'; key: string; name: string }
  | { role: 'member'; key: string; name: string; rest: string }
  | { role: 'none' };

const toGroupKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * "X master ..." heads the group X and "X: ..." belongs to it. The colon must
 * be followed by a space or end the title, so a URL is not a prefix.
 */
function readTitleRole(title: string): TitleRole {
  const colon = /:(?:\s|$)/.exec(title);
  const head = colon ? title.slice(0, colon.index) : title;

  const master = /^(.+?)\s+master\b/i.exec(head);
  if (master) {
    return { role: 'master', key: toGroupKey(master[1]), name: master[1].trim() };
  }

  const name = head.trim();
  if (colon && name.length > 0 && name.length <= 40) {
    return { role: 'member', key: toGroupKey(name), name, rest: title.slice(colon.index + 1).trim() };
  }

  return { role: 'none' };
}

/**
 * Groups the recent-chats feed for the Agents tab. Entries keep the feed's
 * order: a group sits where its most recent chat was.
 */
export function groupAgentConversations(conversations: RecentConversationListItem[]): AgentEntry[] {
  const parsed = conversations.map((conversation) => {
    // Bench-lock markers sit in front of the title and are not part of its name.
    const { title } = splitBenchLockPrefix(conversation.sessionTitle);
    const markers = conversation.sessionTitle.slice(0, conversation.sessionTitle.length - title.length);
    return { conversation, markers, role: readTitleRole(title.trim()) };
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

    let group = groupByKey.get(role.key);
    if (!group) {
      group = { kind: 'group', key: role.key, name: nameByKey.get(role.key) ?? role.name, master: null, members: [] };
      groupByKey.set(role.key, group);
      entries.push(group);
    }

    if (masterByKey.get(role.key) === conversation) {
      group.master = { conversation, label: conversation.sessionTitle };
    } else {
      const rest = role.role === 'member' ? role.rest : '';
      group.members.push({ conversation, label: rest ? `${markers}${rest}` : conversation.sessionTitle });
    }
  }

  return entries;
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
