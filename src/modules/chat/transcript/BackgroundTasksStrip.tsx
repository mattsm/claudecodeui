import { memo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronDown, ChevronRight, X } from 'lucide-react';

import { useSetUiPreference, useUiPreferences } from '@/shared/context/UiPreferencesContext';
import type { BackgroundTaskSummary, ChatMessage } from '@/shared/types';
import {
  describeWorkflowAgent,
  findCurrentWorkflowAgent,
  listRunningBackgroundLaunches,
  ownBackgroundTasks,
  readBackgroundTaskId,
  readBackgroundTaskStatus,
} from '@/modules/chat/utils/backgroundTasks';
import { parseToolPayload } from '@/modules/chat/utils/messageTransforms';
import { parseWorkflowMeta } from '@/modules/chat/utils/workflowScriptMeta';

type BackgroundTasksStripProps = {
  /** Every loaded row of the session, not the visible window: a task launched pages ago is still running. */
  messages: ChatMessage[];
  /**
   * The session's running tasks as the activity map has them — from the
   * running-sessions poll after a reload, or the rows themselves once the
   * turn ended. A task whose launch row is on a page not loaded yet has no
   * row to draw from and is listed from here, so it can still be stopped.
   */
  tasks?: BackgroundTaskSummary[];
  /** The session the tasks belong to, which `chat.stop-task` names; null before one exists. */
  sessionId: string | null;
  /** The chat websocket's send, for stopping a task. */
  sendMessage: (message: unknown) => void;
  /**
   * Brings a row into view. Owned by the pane's session state because the
   * row may sit outside the visible window or in an unmounted lazy row, so
   * it takes more than an element lookup to reach it.
   */
  onReveal: (message: ChatMessage) => void;
  /** Loads the rest of the transcript, for a task whose launch row is not loaded yet. */
  onLoadAll: () => void;
  /**
   * `floating` sits over the transcript's top right: the collapsed pill, and on
   * narrow screens the open list too. `sidebar` is the open list as a column
   * beside the transcript, on wide screens only. The pane renders both.
   */
  variant?: 'floating' | 'sidebar';
};

/** The one-line description the launch was given, as the card reads it. */
function readLaunchDescription(message: ChatMessage): string {
  if (message.workflow?.description) {
    return message.workflow.description;
  }
  const input = parseToolPayload(message.toolInput);
  const { description, script } = input && typeof input === 'object'
    ? (input as { description?: unknown; script?: unknown })
    : { description: undefined, script: undefined };
  if (typeof description === 'string' && description) {
    return description;
  }
  // The CLI sets a workflow's description in the script's `meta` header, not
  // in the tool input, and reports it back as the run's first summary.
  return typeof script === 'string' ? parseWorkflowMeta(script).description ?? '' : '';
}

/** What one running task's chip says: its kind, its name, and how far it has got. */
function describeTask(message: ChatMessage, t: TFunction) {
  const live = message.taskStatus;
  const name = message.toolName === 'Workflow'
    ? message.workflow?.name || live?.workflowName || ''
    : message.subagent?.description || live?.description || '';
  const kind = message.toolName === 'Workflow'
    ? t('workflow.title', 'Workflow')
    : message.toolName === 'Bash'
      ? t('workflow.backgroundCommand', 'Command')
      : t('workflow.backgroundAgent', 'Agent');

  // A workflow reports on each agent it spawned — "2/6 agents · audit:sidebar"
  // says how many have finished and the one it is on. Short of that, its own
  // summary, unless it merely restates the launch's description (a workflow's
  // progress opens with it) or the chip's name — that says nothing new and it
  // is long. An agent reports only what it has spent. The history-loaded agent
  // counts stand in for a workflow the live stream has not described yet.
  let agentsProgress = '';
  if (live?.agents?.length) {
    const finished = live.agents.filter((agent) => agent.state === 'done' || agent.state === 'failed').length;
    const current = findCurrentWorkflowAgent(live.agents);
    agentsProgress = t('workflow.agentsProgress', { finished, count: live.agents.length, defaultValue_one: '{{finished}}/{{count}} agent', defaultValue_other: '{{finished}}/{{count}} agents' });
    if (current) {
      agentsProgress += ` · ${describeWorkflowAgent(current)}`;
    }
  }
  const description = readLaunchDescription(message);
  const summary = live?.summary && live.summary !== description && live.summary !== name ? live.summary : '';
  const progress = agentsProgress
    || summary
    || (live?.usage ? `${live.usage.toolUses} ${live.usage.toolUses === 1 ? 'tool' : 'tools'}` : '')
    || (message.workflow && message.workflow.agentCounts.total > 0
      ? `${message.workflow.agentCounts.completed + message.workflow.agentCounts.failed}/${message.workflow.agentCounts.total}`
      : '');

  return { kind, name, progress };
}

type TaskRow = {
  key: string;
  kind: string;
  name: string;
  progress: string;
  /** Hover text for the row. */
  title: string;
  /** Scrolls to the task's card, or loads the page holding it; absent when no page of this transcript holds it. */
  onOpen?: () => void;
  /** The id `chat.stop-task` names; absent when the row has no id to stop it by. */
  taskId?: string;
};

const Dot = () => (
  <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400" />
);

/**
 * Rendered by chat's ChatMessagesPane at the top right of the transcript: a
 * collapsible list of the background tasks — workflows, agents, commands —
 * that are still running. Collapsed it is one pill with the count; open, one
 * row per task, each scrolling to its card when clicked and stoppable from its
 * ✕. Open or closed is a UI preference, so it holds across sessions. Renders
 * nothing while nothing runs, which is most of the time.
 */
export const BackgroundTasksStrip = memo(({ messages, tasks, sessionId, sendMessage, onReveal, onLoadAll, variant = 'floating' }: BackgroundTasksStripProps) => {
  const { t } = useTranslation();
  const { backgroundTasksExpanded: expanded } = useUiPreferences();
  const setPreference = useSetUiPreference();
  const running = listRunningBackgroundLaunches(messages);
  // A loaded row that has a word on its task — settled or not — is the word;
  // a task whose row is not loaded, or is loaded without one (a backgrounded
  // command's launch row from history says nothing until the poll does), is
  // drawn from the map.
  const settledToolIds = new Set(
    messages.filter((message) => readBackgroundTaskStatus(message) !== undefined).map((message) => message.toolId),
  );
  const fromMap = ownBackgroundTasks(tasks ?? []).filter((task) => !settledToolIds.has(task.toolUseId));

  if (running.length === 0 && fromMap.length === 0) {
    return null;
  }

  const rows: TaskRow[] = [
    ...running.map((message): TaskRow => {
      const { kind, name, progress } = describeTask(message, t);
      return {
        key: message.toolId ?? `${kind}-${name}`,
        kind,
        name,
        progress,
        title: [kind, name, progress].filter(Boolean).join(' · '),
        onOpen: () => onReveal(message),
        taskId: readBackgroundTaskId(message),
      };
    }),
    ...fromMap.map((task): TaskRow => {
      const kind = task.taskType === 'local_workflow'
        ? t('workflow.title', 'Workflow')
        : task.taskType === 'local_bash'
          ? t('workflow.backgroundCommand', 'Command')
          : t('workflow.backgroundAgent', 'Agent');
      const name = task.workflowName ?? task.description;
      const base = [kind, name].filter(Boolean).join(' · ');
      return {
        key: task.taskId,
        kind,
        name,
        progress: '',
        // Launched by one of the session's agents: its row is in that agent's
        // transcript, so no page of this one will ever hold it.
        title: task.nested
          ? `${base} · ${t('workflow.taskOfAgent', 'Launched by one of this session\'s agents')}`
          : `${base} · ${t('workflow.taskRowNotLoaded', 'Launched earlier in this conversation; click to load it')}`,
        onOpen: task.nested ? undefined : onLoadAll,
        taskId: task.taskId,
      };
    }),
  ];

  const label = t('workflow.backgroundTasks', 'Background tasks');
  const count = t('workflow.runningCount', { count: rows.length, defaultValue_one: '{{count}} running', defaultValue_other: '{{count}} running' });

  const header = (
    <button
      type="button"
      onClick={() => setPreference('backgroundTasksExpanded', !expanded)}
      aria-expanded={expanded}
      title={label}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-muted hover:text-foreground"
    >
      {expanded ? <ChevronDown className="h-3 w-3 flex-shrink-0" /> : <ChevronRight className="h-3 w-3 flex-shrink-0" />}
      <Dot />
      <span className="font-medium text-foreground">{count}</span>
    </button>
  );

  const list = (
    <ul className="min-h-0 flex-1 overflow-y-auto border-t border-border/60 py-1">
      {rows.map((row) => {
        const content: ReactNode = (
          <>
            <Dot />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 gap-1">
                <span className="flex-shrink-0 font-medium text-foreground">{row.kind}</span>
                {row.name && <span className="min-w-0 truncate">{row.name}</span>}
              </span>
              {row.progress && <span className="block truncate text-muted-foreground/70">{row.progress}</span>}
            </span>
          </>
        );
        return (
          <li key={row.key} className="flex items-start gap-1 px-1">
            {row.onOpen ? (
              <button
                type="button"
                onClick={row.onOpen}
                title={row.title}
                className="flex min-w-0 flex-1 items-start gap-1.5 rounded px-1.5 py-1 text-left hover:bg-muted hover:text-foreground"
              >
                {content}
              </button>
            ) : (
              <span title={row.title} className="flex min-w-0 flex-1 items-start gap-1.5 px-1.5 py-1">{content}</span>
            )}
            {sessionId && row.taskId && (
              <button
                type="button"
                onClick={() => sendMessage({ type: 'chat.stop-task', sessionId, taskId: row.taskId })}
                aria-label={t('workflow.stopTask', 'Stop')}
                title={t('workflow.stopTask', 'Stop')}
                className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );

  if (variant === 'sidebar') {
    if (!expanded) {
      return null;
    }
    return (
      <aside
        role="status"
        aria-label={label}
        className="hidden w-72 flex-shrink-0 flex-col border-l border-border/60 bg-background text-[11px] text-muted-foreground lg:flex"
      >
        <div className="px-1 py-1">{header}</div>
        {list}
      </aside>
    );
  }

  return (
    <div
      role="status"
      aria-label={label}
      className={`flex max-h-[60vh] w-72 max-w-[calc(100vw-2rem)] flex-col rounded-md border border-border/60 bg-background/95 text-[11px] text-muted-foreground shadow-sm backdrop-blur ${
        expanded ? 'lg:hidden' : ''
      }`}
    >
      {header}
      {expanded && list}
    </div>
  );
});
BackgroundTasksStrip.displayName = 'BackgroundTasksStrip';
