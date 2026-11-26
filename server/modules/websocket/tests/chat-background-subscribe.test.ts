import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { handleChatConnection, runDetachedChatTurn } from '@/modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

/**
 * A session's turn ends while its agents, workflow or backgrounded command are
 * still going. The run registry marks the run completed at the turn's
 * `complete`, but the runtime keeps producing events through that run's
 * writer — task progress, and the turn the CLI pushes when the task reports.
 * A tab opened during that work has to attach to the run to see them, and the
 * run has to still be there to attach to.
 */

const SESSION_ID = 'held-session';
const FIVE_MINUTES = 5 * 60 * 1000;

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: Array<Record<string, unknown>>;
    send: (data: string) => void;
  };
  socket.readyState = 1;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(JSON.parse(data) as Record<string, unknown>);
  return socket;
}

async function withIsolatedDatabase(runTest: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-background-subscribe-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  try {
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory);
    await runTest();
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    chatRunRegistry.setRetentionGuard(() => false);
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Starts a run for the session and ends its turn, leaving the run completed but registered. */
function startAndCompleteRun(connection: ReturnType<typeof createFakeSocket>) {
  const run = chatRunRegistry.startRun({
    appSessionId: SESSION_ID,
    provider: 'claude',
    providerSessionId: 'native-1',
    connection: connection as never,
    userId: 1,
  });
  assert.ok(run);
  run.writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-1', exitCode: 0 });
  assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false);
  return run;
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 30); });

test('a tab that subscribes during background work receives the run\'s later events', async () => {
  await withIsolatedDatabase(async () => {
    const run = startAndCompleteRun(createFakeSocket());

    const newTab = createFakeSocket();
    handleChatConnection(
      newTab as never,
      { user: { id: 1 } } as never,
      { runtime: { hasBackgroundWork: (sessionId: string) => sessionId === SESSION_ID, getPendingApprovalsForSession: () => [] } as never },
    );
    newTab.emit('message', JSON.stringify({ type: 'chat.subscribe', sessions: [{ sessionId: SESSION_ID, lastSeq: 0 }] }));
    await settle();

    // Not processing — the composer stays usable — but attached.
    assert.equal(newTab.frames[0]?.kind, 'chat_subscribed');
    assert.equal(newTab.frames[0]?.isProcessing, false);

    run.writer.send({ kind: 'task_status', provider: 'claude', sessionId: 'native-1', event: 'notification', taskId: 't1', status: 'completed' } as never);
    assert.ok(
      newTab.frames.some((frame) => frame.kind === 'task_status'),
      'the task event must reach the tab that subscribed after the turn ended',
    );
  });
});

test('a tab that subscribes to an idle session is not attached to its old run', async () => {
  await withIsolatedDatabase(async () => {
    const run = startAndCompleteRun(createFakeSocket());

    const newTab = createFakeSocket();
    handleChatConnection(
      newTab as never,
      { user: { id: 1 } } as never,
      { runtime: { hasBackgroundWork: () => false, getPendingApprovalsForSession: () => [] } as never },
    );
    newTab.emit('message', JSON.stringify({ type: 'chat.subscribe', sessions: [{ sessionId: SESSION_ID, lastSeq: 0 }] }));
    await settle();

    run.writer.send({ kind: 'task_status', provider: 'claude', sessionId: 'native-1', event: 'notification', taskId: 't1', status: 'completed' } as never);
    assert.ok(!newTab.frames.some((frame) => frame.kind === 'task_status'));
  });
});

test('a completed run stays registered while its session still has background work', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await withIsolatedDatabase(async () => {
      let working = true;
      chatRunRegistry.setRetentionGuard((sessionId) => sessionId === SESSION_ID && working);
      startAndCompleteRun(createFakeSocket());

      mock.timers.tick(FIVE_MINUTES);
      assert.ok(chatRunRegistry.getRun(SESSION_ID), 'the run must outlive the retention window while work is outstanding');

      working = false;
      mock.timers.tick(FIVE_MINUTES);
      assert.equal(chatRunRegistry.getRun(SESSION_ID), undefined, 'once the work is gone the run is evicted as before');
    });
  } finally {
    mock.timers.reset();
  }
});

test('a retained run\'s eviction timer cannot evict the session\'s next run early', async () => {
  // Run one completes with work outstanding and is re-armed at five minutes;
  // run two takes the slot and completes with two minutes of retention to
  // go. Run one's timer firing on the slot alone would evict run two.
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await withIsolatedDatabase(async () => {
      let working = true;
      chatRunRegistry.setRetentionGuard((sessionId) => sessionId === SESSION_ID && working);
      const first = startAndCompleteRun(createFakeSocket());
      mock.timers.tick(FIVE_MINUTES);
      assert.equal(chatRunRegistry.getRun(SESSION_ID), first);

      working = false;
      mock.timers.tick(FIVE_MINUTES - 2 * 60 * 1000);
      const second = startAndCompleteRun(createFakeSocket());
      assert.equal(chatRunRegistry.getRun(SESSION_ID), second);

      // Run one's re-armed timer fires now; run two's has two minutes left.
      mock.timers.tick(2 * 60 * 1000);
      assert.equal(chatRunRegistry.getRun(SESSION_ID), second, 'run two keeps its own retention window');
      mock.timers.tick(FIVE_MINUTES);
      assert.equal(chatRunRegistry.getRun(SESSION_ID), undefined);
    });
  } finally {
    mock.timers.reset();
  }
});

/** A runtime whose turn sends one message and then stays open until released. */
function createHeldRuntime() {
  let finish: (() => void) | undefined;
  const runtime = {
    hasRuntime: () => true,
    hasBackgroundWork: () => false,
    getPendingApprovalsForSession: () => [],
    run: async (_provider: string, command: string, _options: unknown, writer: { send: (message: unknown) => void }) => {
      writer.send({ kind: 'text', provider: 'claude', sessionId: 'native-1', role: 'assistant', content: `reply to ${command}` });
      await new Promise<void>((resolve) => { finish = resolve; });
      writer.send({ kind: 'complete', provider: 'claude', sessionId: 'native-1', exitCode: 0 });
    },
  };
  return { runtime, finish: () => finish?.() };
}

function openTab(runtime: unknown, sessionId: string | null) {
  const tab = createFakeSocket();
  handleChatConnection(tab as never, { user: { id: 1 } } as never, { runtime: runtime as never });
  if (sessionId) {
    tab.emit('message', JSON.stringify({ type: 'chat.subscribe', sessions: [{ sessionId, lastSeq: 0 }] }));
  }
  return tab;
}

test('a tab showing an idle chat gets the turn the server starts in it, from the first event', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('other-session', 'claude', os.tmpdir());
    const { runtime, finish } = createHeldRuntime();

    // Open on the chat before anything runs, as a tab left on screen is.
    const watching = openTab(runtime, SESSION_ID);
    const elsewhere = openTab(runtime, 'other-session');
    const closed = openTab(runtime, SESSION_ID);
    closed.emit('close');
    // This tab moved on to another chat: its latest subscribe is the one that counts.
    const movedOn = openTab(runtime, SESSION_ID);
    movedOn.emit('message', JSON.stringify({ type: 'chat.subscribe', sessions: [{ sessionId: 'other-session', lastSeq: 0 }] }));
    await settle();
    for (const tab of [watching, elsewhere, closed, movedOn]) {
      tab.frames.length = 0;
    }

    // A queued or scheduled message: no socket asked for this run.
    const turn = runDetachedChatTurn({ sessionId: SESSION_ID, userId: 1, content: 'queued text' }, { runtime: runtime as never });
    await settle();

    assert.deepEqual(
      watching.frames.map((frame) => [frame.kind, frame.isProcessing ?? frame.content]),
      [['chat_subscribed', true], ['text', 'reply to queued text']],
      'the open tab is told the chat is processing and gets the run\'s events',
    );
    assert.deepEqual(elsewhere.frames, [], 'a tab on another chat gets nothing');
    assert.deepEqual(movedOn.frames, [], 'a tab that left the chat gets nothing');
    assert.deepEqual(closed.frames, [], 'a closed tab gets nothing');

    finish();
    await turn;
    assert.equal(watching.frames.at(-1)?.kind, 'complete');
  });
});

test('the tab that sends a message is not told twice that its chat is processing', async () => {
  await withIsolatedDatabase(async () => {
    const { runtime, finish } = createHeldRuntime();
    const sender = openTab(runtime, SESSION_ID);
    const secondTab = openTab(runtime, SESSION_ID);
    await settle();
    sender.frames.length = 0;
    secondTab.frames.length = 0;

    sender.emit('message', JSON.stringify({ type: 'chat.send', sessionId: SESSION_ID, content: 'typed text', options: {} }));
    await settle();

    assert.deepEqual(sender.frames.map((frame) => frame.kind), ['text']);
    assert.deepEqual(secondTab.frames.map((frame) => frame.kind), ['chat_subscribed', 'text'], 'the same chat open in a second tab follows the turn live');
    finish();
    await settle();
  });
});
