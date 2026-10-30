import { sessionsDb } from '@/modules/database/index.js';
import { broadcastSessionUpsertedBatch } from '@/modules/websocket/index.js';

/**
 * Announces chat titles changed outside the server.
 *
 * Local tools rename chats by writing `sessions.custom_name` directly (the
 * bench-board lock marks its holder's title, for one). No route runs, so no
 * `session_upserted` went out and open pages kept the old title until a
 * reload. Polling the names is a single small query.
 */
const POLL_INTERVAL_MS = 5_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let knownNames: Map<string, string | null> | null = null;

/** Reads the current names and returns the sessions whose name changed since the last read. */
export function collectRenamedSessions(): string[] {
  const current = new Map(sessionsDb.listSessionCustomNames().map((row) => [row.session_id, row.custom_name]));
  const previous = knownNames;
  knownNames = current;
  if (!previous) {
    return [];
  }
  const renamed: string[] = [];
  for (const [sessionId, name] of current) {
    if (previous.has(sessionId) && previous.get(sessionId) !== name) {
      renamed.push(sessionId);
    }
  }
  return renamed;
}

export function initializeSessionTitleWatcher(): void {
  if (pollTimer) {
    return;
  }
  collectRenamedSessions();
  pollTimer = setInterval(() => {
    try {
      const renamed = collectRenamedSessions();
      if (renamed.length > 0) {
        void broadcastSessionUpsertedBatch(renamed).catch((error: unknown) => {
          console.warn('[sessions] Failed to announce renamed sessions', error);
        });
      }
    } catch (error) {
      console.warn('[sessions] Title poll failed', error);
    }
  }, POLL_INTERVAL_MS);
  pollTimer.unref?.();
}

export function closeSessionTitleWatcher(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  knownNames = null;
}
