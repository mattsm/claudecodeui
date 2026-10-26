import { queuedMessagesDb, scheduledMessagesDb } from '@/modules/database/index.js';
import type { QueuedMessageRow, ScheduledMessageRow } from '@/modules/database/index.js';
import { chatRunRegistry, RUN_IN_PROGRESS_ERROR, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';

/**
 * How often due messages are looked for.
 *
 * A minute is the granularity the composer offers, and a claim is indexed on
 * `(status, scheduled_for)`, so the poll is one cheap query. Anything finer
 * would buy precision nobody asked for.
 */
const POLL_INTERVAL_MS = 30_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let dispatchInFlight = false;

type StoredQueuedMessage = {
  content: string;
  options: Record<string, unknown>;
  attachments: unknown[];
};

function readOptions(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function readQueuedMessage(value: unknown): StoredQueuedMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const content = typeof record.content === 'string' ? record.content : '';
  const attachments = Array.isArray(record.attachments)
    ? record.attachments
    : Array.isArray(record.images)
      ? record.images
      : [];
  if (!content.trim() && attachments.length === 0) {
    return null;
  }
  const options = record.options && typeof record.options === 'object' && !Array.isArray(record.options)
    ? record.options as Record<string, unknown>
    : {};
  return { content, options, attachments };
}

async function sendClaimedQueuedMessage(
  row: QueuedMessageRow,
  runtime: ProviderRuntimeGateway,
): Promise<void> {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.message);
  } catch {
    // Unreadable: dropped, like an empty one.
  }
  const message = readQueuedMessage(parsed);
  if (!message) {
    return;
  }

  const result = await runDetachedChatTurn(
    {
      sessionId: row.session_id,
      userId: row.user_id,
      content: message.content,
      options: { ...message.options, attachments: message.attachments },
    },
    { runtime },
  );

  // The registry check and run reservation are separate operations. If a run
  // wins that tiny race, put the message back so the next poll tries again.
  if (!result.started && result.error === RUN_IN_PROGRESS_ERROR) {
    queuedMessagesDb.restore(row);
  }
}

/**
 * Whether a queued turn has to keep waiting for the session.
 *
 * A turn that ends with background work still going (a backgrounded command,
 * agent or workflow) is marked completed, but its CLI process stays open so
 * that work can report back. A new turn replaces that process and stops the
 * work, which is why the composer asks before an interactive send. A queued
 * turn was promised to go "when this finishes", so it waits for that work too.
 */
function isSessionBusy(sessionId: string, runtime: ProviderRuntimeGateway): boolean {
  return chatRunRegistry.isProcessing(sessionId) || runtime.hasBackgroundWork(sessionId);
}

/**
 * Sends the oldest queued message of every idle session; the rest wait for the
 * turn that one starts to finish.
 */
export async function dispatchQueuedMessages(runtime: ProviderRuntimeGateway): Promise<number> {
  let claimed = 0;

  await Promise.all(queuedMessagesDb.listQueuedSessionIds().map(async (sessionId) => {
    if (isSessionBusy(sessionId, runtime)) {
      return;
    }
    const row = queuedMessagesDb.claimOldest(sessionId);
    if (!row) {
      return;
    }
    claimed += 1;
    await sendClaimedQueuedMessage(row, runtime);
  }));

  return claimed;
}

function formatSlotTime(date: Date): string {
  return date.toISOString().slice(11, 16) + ' UTC';
}

/**
 * The end of the last scheduled turn started or waiting per session, across
 * passes, so a session's scheduled messages go one turn at a time.
 */
const scheduledTurns = new Map<string, Promise<void>>();

/**
 * Starts one due message. Resolves once its run holds the session; `done`
 * settles when the run ends. Wrapped in an object because a promise resolved
 * with a promise would wait for that one too.
 */

async function sendClaimedMessage(
  row: ScheduledMessageRow,
  runtime: ProviderRuntimeGateway,
  now: Date,
): Promise<{ done: Promise<void> }> {
  const repeating = Boolean(row.repeat_every_minutes);
  // A repeating message is a monitor, not a deadline: aborting whatever the
  // session is doing every interval would kill its turn or background work.
  // It skips this slot and tries again at the next one.
  if (repeating && (chatRunRegistry.isProcessing(row.session_id) || runtime.hasBackgroundWork?.(row.session_id))) {
    scheduledMessagesDb.markFailed(row.id, `Skipped at ${formatSlotTime(now)} — the session was busy.`);
    return { done: Promise.resolve() };
  }

  try {
    const result = await runDetachedChatTurn(
      {
        sessionId: row.session_id,
        userId: row.user_id,
        content: row.content,
        options: readOptions(row.options),
        // The user picked this time on purpose; a run that happens to be going
        // is aborted so the scheduled message lands when it was due, instead
        // of being recorded as "not sent — session was busy".
        interruptActiveRun: !repeating,
      },
      { runtime },
    );

    // Recorded rather than retried, and recorded whether the run never started
    // (deleted session, unavailable provider) or started and then failed.
    // Silently dropping a message the user scheduled is worse than telling
    // them it did not go.
    if (!result.started || result.error) {
      scheduledMessagesDb.markFailed(row.id, result.error ?? 'The session was unavailable when this was due.');
      return { done: Promise.resolve() };
    }
    if (repeating) {
      scheduledMessagesDb.clearFailure(row.id);
    }
    return {
      done: result.done.then((outcome) => {
        if (outcome.error) {
          scheduledMessagesDb.markFailed(row.id, outcome.error);
        }
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scheduledMessagesDb.markFailed(row.id, message);
    return { done: Promise.resolve() };
  }
}

/**
 * Sends every message whose time has come.
 *
 * Exported so a test can drive one pass without waiting on the timer.
 */
export async function dispatchDueScheduledMessages(
  runtime: ProviderRuntimeGateway,
  now: Date = new Date(),
): Promise<number> {
  // Claimed before any of them runs, so a long turn cannot let the next poll
  // pick the same message up again.
  const due = scheduledMessagesDb.claimDue(now);
  if (due.length === 0) {
    return 0;
  }

  // A session can only have one run at a time, and two due messages for the
  // same session must not race each other into it.
  // A message's run is not waited for, so one long turn cannot hold up other
  // sessions or the next pass. A second message for the same session waits
  // for the first one's turn to end, in a chain of its own.
  const bySession = new Map<string, ScheduledMessageRow[]>();
  for (const row of due) {
    bySession.set(row.session_id, [...(bySession.get(row.session_id) ?? []), row]);
  }
  await Promise.all([...bySession.entries()].map(async ([sessionId, rows]) => {
    // An earlier pass's message for this session may still be running; this
    // pass's messages line up behind it rather than interrupting it.
    let tail = scheduledTurns.get(sessionId);
    let waiting = rows;
    if (!tail) {
      tail = (await sendClaimedMessage(rows[0], runtime, now)).done;
      waiting = rows.slice(1);
    }
    for (const row of waiting) {
      tail = tail
        .then(() => sendClaimedMessage(row, runtime, now))
        .then(({ done }) => done)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error('[ScheduledMessages] Follow-up dispatch failed', { error: message });
        });
    }
    const last = tail;
    scheduledTurns.set(sessionId, last);
    void last.then(() => {
      if (scheduledTurns.get(sessionId) === last) {
        scheduledTurns.delete(sessionId);
      }
    });
  }));

  return due.length;
}

/**
 * Starts the poll that sends scheduled messages.
 *
 * The schedule lives in the database, so a message stays scheduled across a
 * restart and one that came due while the server was down is sent on the first
 * poll after it comes back, rather than being skipped.
 */
export function initializeScheduledMessageDispatcher(runtime: ProviderRuntimeGateway): void {
  if (pollTimer) {
    return;
  }

  const poll = () => {
    // A pass that overruns the interval must not be started again underneath
    // itself; the claim is transactional but the runs are not.
    if (dispatchInFlight) {
      return;
    }
    dispatchInFlight = true;
    void dispatchDueScheduledMessages(runtime)
      .then(() => dispatchQueuedMessages(runtime))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[ScheduledMessages] Dispatch pass failed', { error: message });
      })
      .finally(() => {
        dispatchInFlight = false;
      });
  };

  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  // Never keep the process alive just to poll for scheduled messages.
  pollTimer.unref?.();

  // Catch up on anything that came due while the server was not running.
  poll();
}

export function closeScheduledMessageDispatcher(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
