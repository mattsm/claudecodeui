import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useOpenAgentAsks } from '@/modules/agent-asks/context/AgentAsksContext';

type AgentAskCountBadgeProps = {
  /** The chats to count: one chat for its own row, a master chat and its children for a folded group. */
  sessionIds: readonly string[];
};

/** Rendered by the sidebar module on a chat's row: how many items that chat waits on the user for. Nothing when there are none. */
export default function AgentAskCountBadge({ sessionIds }: AgentAskCountBadgeProps) {
  const { t } = useTranslation();
  const openAsks = useOpenAgentAsks();
  const count = openAsks.filter((ask) => ask.sessionId !== null && sessionIds.includes(ask.sessionId)).length;
  if (count === 0) {
    return null;
  }

  const label = t('agentAsks.rowBadge', { defaultValue: '{{count}} waiting on you', count });
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      data-testid="agent-ask-count"
      className="flex flex-shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1 text-[10px] font-medium tabular-nums text-amber-700 dark:text-amber-300"
    >
      <CircleHelp className="h-2.5 w-2.5" />
      {count}
    </span>
  );
}
