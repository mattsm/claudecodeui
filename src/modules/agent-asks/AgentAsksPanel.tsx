import { Check, ChevronDown, ChevronRight, CircleHelp, Send, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useOpenAgentAsks } from '@/modules/agent-asks/context/AgentAsksContext';
import { useSessionAgentAsks } from '@/modules/agent-asks/hooks/useSessionAgentAsks';
import { Markdown } from '@/modules/chat';
import { usePaletteOps } from '@/modules/command-palette';
import type { AgentAsk } from '@/shared/types';
import { cn } from '@/shared/utils';

type AgentAsksPanelProps = {
  sessionId: string;
  isMobile: boolean;
  onClose: () => void;
  /** Opens another chat that has open items. */
  onNavigateToSession: (sessionId: string) => void;
};

function formatAge(isoTime: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(isoTime).getTime()) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

type OpenAskCardProps = {
  ask: AgentAsk;
  /** The time the ages are counted from. */
  now: number;
  onResolve: (ask: AgentAsk, action: 'answer' | 'ack' | 'dismiss', answer?: string) => Promise<void>;
};

function OpenAskCard({ ask, now, onResolve }: OpenAskCardProps) {
  const { t } = useTranslation();
  // The answer or note being typed for this item.
  const [reply, setReply] = useState('');
  // Blocks a second click while the first is on its way to the server.
  const [isSending, setIsSending] = useState(false);
  // Why the server refused, shown under the item.
  const [error, setError] = useState<string | null>(null);
  const isQuestion = ask.kind === 'question';
  const canSend = !isSending && (!isQuestion || reply.trim() !== '');

  const send = async (action: 'answer' | 'ack' | 'dismiss') => {
    setIsSending(true);
    setError(null);
    try {
      await onResolve(ask, action, reply.trim() || undefined);
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : String(resolveError));
      setIsSending(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && canSend) {
      event.preventDefault();
      void send(isQuestion ? 'answer' : 'ack');
    }
  };

  return (
    <li
      data-testid="agent-ask-open"
      className={cn(
        'rounded-lg border bg-card p-2.5 text-sm shadow-sm',
        isQuestion ? 'border-amber-500/40' : 'border-sky-500/40',
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 font-medium',
            isQuestion
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
              : 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
          )}
        >
          {isQuestion ? t('agentAsks.question', 'Question') : t('agentAsks.ack', 'Needs your ack')}
        </span>
        <span className="tabular-nums">#{ask.id}</span>
        <time className="ml-auto tabular-nums" dateTime={ask.createdAt}>{formatAge(ask.createdAt, now)}</time>
        <button
          type="button"
          onClick={() => void send('dismiss')}
          disabled={isSending}
          title={t('agentAsks.dismissHint', 'Close without a reply to the agent')}
          aria-label={t('agentAsks.dismiss', 'Dismiss')}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="break-words font-medium leading-snug text-foreground">{ask.title}</p>
      {ask.details && (
        <Markdown className="prose prose-sm mt-1.5 max-h-64 max-w-none overflow-y-auto break-words text-[13px] dark:prose-invert">
          {ask.details}
        </Markdown>
      )}

      {ask.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ask.options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setReply(option)}
              className={cn(
                'max-w-full truncate rounded-md border px-2 py-1 text-xs transition-colors',
                reply === option
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      <textarea
        value={reply}
        onChange={(event) => setReply(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={isQuestion ? 2 : 1}
        placeholder={isQuestion
          ? t('agentAsks.answerPlaceholder', 'Your answer')
          : t('agentAsks.notePlaceholder', 'Note (optional)')}
        aria-label={isQuestion ? t('agentAsks.answerPlaceholder', 'Your answer') : t('agentAsks.notePlaceholder', 'Note (optional)')}
        className="mt-2 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />

      <div className="mt-1.5 flex items-center justify-end">
        <button
          type="button"
          onClick={() => void send(isQuestion ? 'answer' : 'ack')}
          disabled={!canSend}
          className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-40"
        >
          {isQuestion ? <Send className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          {isQuestion ? t('agentAsks.sendAnswer', 'Send answer') : t('agentAsks.acknowledge', 'Acknowledge')}
        </button>
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </li>
  );
}

const CLOSED_STATUS_LABELS: Record<Exclude<AgentAsk['status'], 'open'>, string> = {
  answered: 'Answered',
  acked: 'Acknowledged',
  dismissed: 'Dismissed',
  withdrawn: 'Withdrawn by the agent',
};

/** Rendered by the project-workspace module beside the chat: what the chat's agent waits on the user for, with the reply controls. */
export default function AgentAsksPanel({ sessionId, isMobile, onClose, onNavigateToSession }: AgentAsksPanelProps) {
  const { t } = useTranslation();
  const { asks, resolve } = useSessionAgentAsks(sessionId);
  const allOpenAsks = useOpenAgentAsks();
  const { sendChatMessage } = usePaletteOps();
  // The closed items are history: folded until the user asks for them.
  const [showClosed, setShowClosed] = useState(false);
  // The clock the item ages are counted from, moved once a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const openAsks = useMemo(() => asks.filter((ask) => ask.status === 'open'), [asks]);
  const closedAsks = useMemo(() => asks.filter((ask) => ask.status !== 'open'), [asks]);

  // Other chats that wait on the user, each with its number of open items, oldest item first.
  const otherChats = useMemo(() => {
    const chats = new Map<string, { sessionId: string; title: string; count: number }>();
    for (const ask of allOpenAsks) {
      if (!ask.sessionId || ask.sessionId === sessionId) {
        continue;
      }
      const chat = chats.get(ask.sessionId);
      if (chat) {
        chat.count += 1;
      } else {
        chats.set(ask.sessionId, { sessionId: ask.sessionId, title: ask.sessionTitle || ask.title, count: 1 });
      }
    }
    return [...chats.values()];
  }, [allOpenAsks, sessionId]);
  // Items whose chat the server cannot find (not indexed yet, or deleted): shown so they can be dismissed.
  const unmatchedAsks = useMemo(() => allOpenAsks.filter((ask) => ask.sessionId === null), [allOpenAsks]);

  const handleResolve = useCallback(async (
    ask: AgentAsk,
    action: 'answer' | 'ack' | 'dismiss',
    answer?: string,
  ) => {
    const chatMessage = await resolve(ask.id, action, answer);
    if (chatMessage) {
      await sendChatMessage(chatMessage);
    }
  }, [resolve, sendChatMessage]);

  return (
    <aside
      data-testid="agent-asks-panel"
      aria-label={t('agentAsks.title', 'Waiting on you')}
      className={cn(
        'flex h-full flex-col bg-background',
        isMobile ? 'absolute inset-0 z-30' : 'w-80 flex-shrink-0 border-l border-border/60',
      )}
    >
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <CircleHelp className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <h2 className="text-sm font-medium text-foreground">{t('agentAsks.title', 'Waiting on you')}</h2>
        {openAsks.length > 0 && (
          <span className="rounded-full bg-amber-500/15 px-1.5 text-xs tabular-nums text-amber-700 dark:text-amber-300">
            {openAsks.length}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('agentAsks.close', 'Close the panel')}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
        {openAsks.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">
            {t('agentAsks.empty', 'Nothing in this chat waits on you.')}
          </p>
        ) : (
          <ul className="space-y-2.5">
            {openAsks.map((ask) => <OpenAskCard key={ask.id} ask={ask} now={now} onResolve={handleResolve} />)}
          </ul>
        )}

        {closedAsks.length > 0 && (
          <section>
            <button
              type="button"
              onClick={() => setShowClosed((shown) => !shown)}
              aria-expanded={showClosed}
              className="flex w-full items-center gap-1 px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showClosed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {t('agentAsks.closed', 'Closed')} ({closedAsks.length})
            </button>
            {showClosed && (
              <ul className="mt-1.5 space-y-1.5">
                {closedAsks.map((ask) => (
                  <li key={ask.id} data-testid="agent-ask-closed" className="rounded-md border border-border/60 px-2 py-1.5 text-xs">
                    <p className="break-words text-foreground">
                      <span className="tabular-nums text-muted-foreground">#{ask.id}</span> {ask.title}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">
                      {CLOSED_STATUS_LABELS[ask.status as Exclude<AgentAsk['status'], 'open'>]}
                      {ask.answer ? `: ${ask.answer}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {otherChats.length > 0 && (
          <section>
            <h3 className="px-1 text-xs font-medium text-muted-foreground">
              {t('agentAsks.otherChats', 'Other chats waiting on you')}
            </h3>
            <ul className="mt-1.5 space-y-1">
              {otherChats.map((chat) => (
                <li key={chat.sessionId}>
                  <button
                    type="button"
                    onClick={() => onNavigateToSession(chat.sessionId)}
                    data-testid="agent-asks-other-chat"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-accent/60"
                  >
                    <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                    <span className="rounded-full bg-amber-500/15 px-1.5 text-xs tabular-nums text-amber-700 dark:text-amber-300">
                      {chat.count}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {unmatchedAsks.length > 0 && (
          <section>
            <h3 className="px-1 text-xs font-medium text-muted-foreground">
              {t('agentAsks.unmatched', 'From a chat CloudCLI cannot find')}
            </h3>
            <ul className="mt-1.5 space-y-1">
              {unmatchedAsks.map((ask) => (
                <li
                  key={ask.id}
                  data-testid="agent-ask-unmatched"
                  className="flex items-start gap-2 rounded-md border border-border/60 px-2 py-1.5 text-xs text-foreground"
                >
                  <span className="min-w-0 flex-1 break-words">
                    <span className="tabular-nums text-muted-foreground">#{ask.id}</span> {ask.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => void resolve(ask.id, 'dismiss').catch(() => undefined)}
                    aria-label={t('agentAsks.dismiss', 'Dismiss')}
                    title={t('agentAsks.dismissHint', 'Close without a reply to the agent')}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
