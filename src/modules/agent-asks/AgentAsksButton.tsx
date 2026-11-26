import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';

type AgentAsksButtonProps = {
  /** Open items in the chat on screen. */
  openCount: number;
  /** Open items in every other chat. */
  otherOpenCount: number;
  isPanelVisible: boolean;
  onToggle: () => void;
};

/** Rendered by the project-workspace module in the workspace header: shows how much waits on the user and toggles the panel beside the chat. */
export default function AgentAsksButton({ openCount, otherOpenCount, isPanelVisible, onToggle }: AgentAsksButtonProps) {
  const { t } = useTranslation();
  const label = t('agentAsks.buttonLabel', {
    defaultValue: 'Waiting on you: {{openCount}} in this chat, {{otherOpenCount}} in other chats',
    openCount,
    otherOpenCount,
  });

  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={isPanelVisible}
      data-testid="agent-asks-button"
      className={cn(
        'relative flex h-7 flex-shrink-0 items-center gap-1 rounded-md px-1.5 text-xs transition-colors',
        isPanelVisible ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <CircleHelp className={cn('h-4 w-4', openCount > 0 && 'text-amber-600 dark:text-amber-400')} />
      {openCount > 0 ? (
        <span className="font-medium tabular-nums text-amber-700 dark:text-amber-300">{openCount}</span>
      ) : otherOpenCount > 0 ? (
        <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
      ) : null}
    </button>
  );
}
