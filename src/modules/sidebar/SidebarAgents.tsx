import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Bot, Folder, FolderPlus, Loader2, Pin, Plus } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ActionMenu, Button, LLMProviderLogo, SessionTitle, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { LockIcon, splitBenchLockPrefix } from '@/shared/ui/SessionTitle';
import type { Project, ProjectSession, RecentConversationListItem, SessionRowActions } from '@/shared/types';
import { formatCompactAge } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import { agentEntryRows, filterAgentEntries, pinAgentConversations } from '@/modules/sidebar/utils/agentGroups';
import { usePinnedAgents } from '@/modules/sidebar/hooks/usePinnedAgents';
import type { AgentRow } from '@/modules/sidebar/utils/agentGroups';
import SessionOptions from '@/modules/sidebar/SessionOptions';
import { AgentAskCountBadge } from '@/modules/agent-asks';

const COLLAPSED_GROUPS_STORAGE_KEY = 'sidebar-agents-collapsed-groups';

function readCollapsedGroups(): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(saved) ? saved.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeCollapsedGroups(groups: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify([...groups]));
  } catch {
    // The list still works without storage; the groups just open again on reload.
  }
}

type SidebarAgentsProps = {
  conversations: RecentConversationListItem[];
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasError: boolean;
  /** The search box's text. Filters the list by title. */
  searchFilter: string;
  selectedSession: ProjectSession | null;
  currentTime: Date;
  /** The same row state and callbacks the Projects and Conversations rows get. */
  sessionActions: SessionRowActions;
  onConversationSelect: (
    projectId: string | null,
    sessionId: string,
    provider: string,
  ) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  projects: Project[];
  selectedProject: Project | null;
  /** Opens an empty chat in the project, the way the Projects tab's "New Session" does. */
  onNewAgent: (project: Project) => void;
  /** Opens the add-a-project dialog, for a folder that is not a project yet. */
  onCreateProject: () => void;
  /** False while transcript hits for the same search are listed under the tab. */
  showNoMatches?: boolean;
  t: TFunction;
};

type AgentChatRowProps = Pick<SidebarAgentsProps, 'selectedSession' | 'currentTime' | 'sessionActions' | 'onConversationSelect' | 't'> & {
  row: AgentRow;
  /** Drawn after the title in place of the age; the group header puts its running count here. */
  badge?: ReactNode;
  /** The chats whose open questions the row counts; a folded group's header counts its hidden chats too. Defaults to the row's own chat. */
  askSessionIds?: readonly string[];
  pinnedIds: ReadonlySet<string>;
  onTogglePin: (sessionId: string) => void;
};

function AgentChatRow({ row, badge, askSessionIds, pinnedIds, onTogglePin, selectedSession, currentTime, sessionActions, onConversationSelect, t }: AgentChatRowProps) {
  const { conversation, label } = row;
  const isPinned = pinnedIds.has(conversation.sessionId);
  const isSelected = String(selectedSession?.id ?? '') === conversation.sessionId;
  const age = formatCompactAge(conversation.lastActivity, currentTime);
  const hasBackgroundWork = sessionActions.backgroundSessionIds.has(conversation.sessionId);
  const isProcessing = sessionActions.activeSessions.has(conversation.sessionId) && !hasBackgroundWork;
  const needsAttention = sessionActions.attentionSessionIds.has(conversation.sessionId) && !isSelected;
  const rename = sessionActions.activeRename;
  const sessionRename = rename?.target === 'session' && rename.id === conversation.sessionId ? rename : null;

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onConversationSelect(conversation.projectId, conversation.sessionId, conversation.provider);
  };

  return (
    <div className="group relative min-w-0 flex-1">
      <a
        href={`/session/${conversation.sessionId}`}
        onClick={handleClick}
        title={conversation.sessionTitle}
        data-testid="agent-chat-row"
        className={cn(
          'flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 pr-10 text-left transition-colors',
          isSelected ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-accent/60',
        )}
      >
        <LLMProviderLogo provider={conversation.provider} className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-normal leading-5">
          <SessionTitle name={label} />
        </span>
        {isPinned && (
          <Pin
            role="img"
            aria-label={t('agents.pinned', 'Pinned')}
            data-testid="agent-pinned"
            className="h-3 w-3 flex-shrink-0 text-muted-foreground"
          />
        )}
        <AgentAskCountBadge sessionIds={askSessionIds ?? [conversation.sessionId]} />
        {badge}
        {needsAttention ? (
          <Tooltip content={t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })} position="top">
            <span
              role="status"
              aria-label={t('tooltips.attentionRequiredIndicator', { defaultValue: 'Session needs attention' })}
              className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-amber-500"
            />
          </Tooltip>
        ) : isProcessing ? (
          <Tooltip content={t('tooltips.processingSessionIndicator', 'Processing session')} position="top">
            <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-emerald-500" />
          </Tooltip>
        ) : hasBackgroundWork ? (
          <Tooltip content={t('tooltips.backgroundWorkIndicator', 'Background work running')} position="top">
            <span
              role="status"
              aria-label={t('tooltips.backgroundWorkIndicator', 'Background work running')}
              className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-purple-500 dark:bg-purple-400"
            />
          </Tooltip>
        ) : age && !badge ? (
          <time className="flex-shrink-0 text-[10px] tabular-nums text-muted-foreground" dateTime={conversation.lastActivity ?? undefined}>
            {age}
          </time>
        ) : null}
      </a>

      <SessionOptions
        className="absolute right-1.5 top-1/2 -translate-y-1/2 transform"
        sessionId={conversation.sessionId}
        sessionName={conversation.sessionTitle}
        provider={conversation.provider}
        projectId={conversation.projectId}
        isProcessing={isProcessing}
        isEditing={sessionRename !== null}
        renameDraft={sessionRename?.draft ?? ''}
        onRenameDraftChange={sessionActions.onRenameDraftChange}
        onStartEditingSession={sessionActions.onStartEditingSession}
        onCancelEditingSession={sessionActions.onCancelEditingSession}
        onSaveEditingSession={sessionActions.onSaveEditingSession}
        onArchiveSession={sessionActions.onArchiveSession}
        onDeleteSession={sessionActions.onDeleteSession}
        onTogglePin={() => onTogglePin(conversation.sessionId)}
        isPinned={isPinned}
        onFork={sessionActions.onForkSession
          ? () => sessionActions.onForkSession?.({
            id: conversation.sessionId,
            summary: conversation.sessionTitle,
            __provider: conversation.provider,
            __projectId: conversation.projectId ?? undefined,
          })
          : undefined}
        t={t}
      />
    </div>
  );
}

const projectLabel = (project: Project) => project.displayName || project.projectId;

/**
 * The "New agent" button and its project picker. A chat needs a project: the
 * button uses the one on screen, else the one the newest chat is in, and the
 * picker beside it names that project and starts the chat in another one.
 */
function NewAgentButton({ projects, selectedProject, conversations, onNewAgent, onCreateProject, t }: Pick<SidebarAgentsProps, 'projects' | 'selectedProject' | 'conversations' | 'onNewAgent' | 'onCreateProject' | 't'>) {
  const project = projects.find((candidate) => candidate.projectId === selectedProject?.projectId)
    ?? projects.find((candidate) => candidate.projectId === conversations[0]?.projectId)
    ?? projects[0];
  if (!project) {
    return null;
  }

  const label = t('agents.newAgent', 'New agent');
  const pickProjectLabel = t('agents.newAgentIn', 'New agent in another project');

  return (
    <div className="mb-1.5 flex items-center gap-1 px-1">
      <Button
        variant="default"
        size="sm"
        className="flex h-8 min-w-0 flex-1 justify-start gap-2 bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        onClick={() => onNewAgent(project)}
        title={`${label}: ${project.fullPath || projectLabel(project)}`}
        data-testid="new-agent-button"
      >
        <Plus className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">{label}</span>
      </Button>
      <ActionMenu
        label={projectLabel(project)}
        ariaLabel={pickProjectLabel}
        icon={Folder}
        portal
        variant="outline"
        size="sm"
        className="min-w-0 max-w-[55%] flex-none"
        triggerClassName="h-8 w-full min-w-0 gap-1.5 px-2 text-xs font-normal [&>span]:min-w-0 [&>span]:truncate [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:flex-shrink-0"
        menuClassName="w-[280px] rounded-xl p-1.5 shadow-xl"
        items={[
          ...projects.map((candidate) => ({
            key: candidate.projectId,
            label: projectLabel(candidate),
            description: candidate.fullPath || candidate.path || undefined,
            icon: Folder,
            onSelect: () => onNewAgent(candidate),
          })),
          {
            key: 'another-folder',
            label: t('agents.anotherFolder', 'Another folder...'),
            description: t('agents.anotherFolderHint', 'Add a folder as a project, then start the agent in it.'),
            icon: FolderPlus,
            showDividerBefore: true,
            onSelect: onCreateProject,
          },
        ]}
      />
    </div>
  );
}

/**
 * Rendered by SidebarContent in the agents mode: the "New agent" button and
 * the recent chats, with the chats of one effort ("wireless lab: map UI")
 * folded under their master chat ("wireless lab master") or under the shared
 * prefix.
 */
export default function SidebarAgents(props: SidebarAgentsProps) {
  return (
    <>
      <NewAgentButton
        projects={props.projects}
        selectedProject={props.selectedProject}
        conversations={props.conversations}
        onNewAgent={props.onNewAgent}
        onCreateProject={props.onCreateProject}
        t={props.t}
      />
      <AgentsList {...props} />
    </>
  );
}

function AgentsList({
  conversations,
  hasMore,
  isLoading,
  isLoadingMore,
  hasError,
  searchFilter,
  selectedSession,
  currentTime,
  sessionActions,
  onConversationSelect,
  onLoadMore,
  onRetry,
  showNoMatches = true,
  t,
}: SidebarAgentsProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(readCollapsedGroups);
  const isFiltering = searchFilter.trim().length > 0;

  const { pinnedIds, togglePin, unpin } = usePinnedAgents();
  const pinnedIdSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);

  const { pinned, entries } = useMemo(() => {
    const split = pinAgentConversations(conversations, pinnedIds);
    return {
      pinned: filterAgentEntries(split.pinned, searchFilter),
      entries: filterAgentEntries(split.entries, searchFilter),
    };
  }, [conversations, pinnedIds, searchFilter]);

  // A pinned chat can be older than the page the tab loads. Older pages are
  // fetched until every pin is found; a pin still missing from the whole feed
  // belongs to a chat that was archived or deleted, and is dropped.
  const missingPinnedIds = useMemo(() => {
    const loaded = new Set(conversations.map((conversation) => conversation.sessionId));
    return pinnedIds.filter((sessionId) => !loaded.has(sessionId));
  }, [conversations, pinnedIds]);
  useEffect(() => {
    if (missingPinnedIds.length === 0 || isLoading || isLoadingMore || hasError || conversations.length === 0) {
      return;
    }
    if (hasMore) {
      onLoadMore();
    } else {
      unpin(missingPinnedIds);
    }
  }, [conversations.length, hasError, hasMore, isLoading, isLoadingMore, missingPinnedIds, onLoadMore, unpin]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) {
        next.add(key);
      }
      writeCollapsedGroups(next);
      return next;
    });
  }, []);

  if (isLoading && conversations.length === 0) {
    return (
      <div className="space-y-1 px-1" aria-label={t('agents.loading', 'Loading agents')} aria-busy="true">
        {Array.from({ length: 10 }).map((_, index) => (
          <div key={index} className="flex items-center gap-2 px-2 py-2">
            <div className="h-3.5 w-3.5 animate-pulse rounded bg-muted" />
            <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${78 - index * 4}%` }} />
          </div>
        ))}
      </div>
    );
  }

  if (hasError && conversations.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <Bot className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{t('agents.loadFailed', 'Could not load agents')}</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={onRetry}>
          {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
        </Button>
      </div>
    );
  }

  // The search only sees the loaded chats, so older pages stay reachable from a search with no hit.
  const loadMoreButton = hasMore ? (
    <Button
      variant="ghost"
      size="sm"
      className="mt-1 h-8 w-full text-xs text-muted-foreground"
      onClick={onLoadMore}
      disabled={isLoading || isLoadingMore}
    >
      {isLoadingMore
        ? t('recent.loadingMore', 'Loading more...')
        : t('recent.loadMore', 'Load older conversations')}
    </Button>
  ) : null;

  if (pinned.length + entries.length === 0) {
    if (isFiltering && !showNoMatches) {
      return loadMoreButton;
    }
    return (
      <div className="px-4 py-10 text-center">
        <Bot className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          {isFiltering
            ? t('agents.noMatches', 'No agents match this search.')
            : t('agents.emptyTitle', 'No agents yet')}
        </p>
        {loadMoreButton}
      </div>
    );
  }

  const rowProps = { selectedSession, currentTime, sessionActions, onConversationSelect, t, pinnedIds: pinnedIdSet, onTogglePin: togglePin };
  // A rule under the pinned entries sets them apart from the rest.
  const dividerClass = (index: number) => (
    pinned.length > 0 && index === pinned.length ? 'mt-1.5 border-t border-border/60 pt-1.5' : undefined
  );

  return (
    <div className="px-1" data-testid="agents-list">
      <div className="space-y-0.5">
        {[...pinned, ...entries].map((entry, index) => {
          if (entry.kind === 'chat') {
            return (
              <div key={entry.key} className={cn('flex min-w-0 items-center', dividerClass(index))}>
                {/* Lines the row up with the group headers, which lead with a toggle. */}
                <span className="w-5 flex-shrink-0" />
                <AgentChatRow row={entry.row} {...rowProps} />
              </div>
            );
          }

          const rows = agentEntryRows(entry);
          const runningCount = rows.filter((row) => sessionActions.activeSessions.has(row.conversation.sessionId)).length;
          // A search opens every group so its hits show.
          const isOpen = isFiltering || !collapsedGroups.has(entry.key);
          const toggleLabel = isOpen
            ? t('agents.collapseGroup', { defaultValue: 'Collapse {{name}}', name: entry.name })
            : t('agents.expandGroup', { defaultValue: 'Expand {{name}}', name: entry.name });
          const runningLabel = t('agents.groupRunning', {
            defaultValue: '{{running}} of {{total}} chats running',
            running: runningCount,
            total: rows.length,
          });
          // A collapsed group hides the chats that hold a bench resource, so the header shows their markers.
          const hiddenLocks = isOpen
            ? []
            : entry.members.flatMap((row) => splitBenchLockPrefix(row.conversation.sessionTitle).locks
              .map((lock) => ({ lock, sessionId: row.conversation.sessionId, title: row.label })));
          // A collapsed group also hides the chats that wait on the user, so the header counts their questions.
          const hiddenAskSessionIds = isOpen ? [] : entry.members.map((row) => row.conversation.sessionId);
          const runningBadge = (
            <>
            {!entry.master && <AgentAskCountBadge sessionIds={hiddenAskSessionIds} />}
            {hiddenLocks.map(({ lock, sessionId, title }) => (
              <span key={`${sessionId}:${lock}`} title={title} data-testid="agent-group-lock" className="inline-flex flex-shrink-0 items-center">
                <LockIcon lock={lock} />
              </span>
            ))}
            <span
              title={runningLabel}
              aria-label={runningLabel}
              data-testid="agent-group-running"
              className={cn(
                'flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums leading-none',
                runningCount > 0
                  ? 'bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-300'
                  : 'bg-muted/60 text-muted-foreground',
              )}
            >
              {runningCount}/{rows.length}
            </span>
            </>
          );

          return (
            <section key={`group:${entry.key}`} data-testid="agent-group" className={dividerClass(index)}>
              <div className="flex min-w-0 items-center">
                <button
                  type="button"
                  onClick={() => toggleGroup(entry.key)}
                  aria-expanded={isOpen}
                  aria-label={toggleLabel}
                  title={toggleLabel}
                  className="flex h-7 w-5 flex-shrink-0 items-center justify-center rounded text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  <span aria-hidden className={cn('inline-block transition-transform', isOpen && 'rotate-90')}>▸</span>
                </button>
                {entry.master ? (
                  <AgentChatRow
                    row={entry.master}
                    badge={runningBadge}
                    askSessionIds={[entry.master.conversation.sessionId, ...hiddenAskSessionIds]}
                    {...rowProps}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleGroup(entry.key)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium leading-5 text-foreground hover:bg-accent/60"
                  >
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {runningBadge}
                  </button>
                )}
              </div>
              {isOpen && entry.members.length > 0 && (
                <div className="ml-2.5 space-y-0.5 border-l border-border/60 pl-5">
                  {entry.members.map((row) => (
                    <AgentChatRow key={row.conversation.sessionId} row={row} {...rowProps} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {loadMoreButton}
    </div>
  );
}
