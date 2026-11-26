import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { agentAsksService } from '@/modules/agent-asks/agent-asks.service.js';
import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { connectedClients } from '@/modules/websocket/index.js';
import { AppError } from '@/shared/utils.js';

const SESSION_ID = 'asking-session';
const PROVIDER_SESSION_ID = 'provider-session-1';

/** Runs a test on an empty database and returns the frames broadcast to clients. */
async function withIsolatedDatabase(runTest: (frames: Array<Record<string, unknown>>) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'agent-asks-'));
  const frames: Array<Record<string, unknown>> = [];

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  connectedClients.add({
    readyState: 1,
    send: (frame: string) => { frames.push(JSON.parse(frame) as Record<string, unknown>); },
  } as never);

  try {
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory, 'Bench master');
    sessionsDb.assignProviderSessionId(SESSION_ID, PROVIDER_SESSION_ID);
    await runTest(frames);
  } finally {
    connectedClients.clear();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function expectAppError(run: () => unknown, code: string): void {
  assert.throws(run, (error: unknown) => error instanceof AppError && error.code === code);
}

test('a question from a Claude tool process lands in its chat and is announced', async () => {
  await withIsolatedDatabase((frames) => {
    const ask = agentAsksService.create({
      kind: 'question',
      title: 'Rebase the stack now?',
      details: 'Main moved by 3 commits.',
      options: ['Yes', 'No', ''],
      origin: { providerSessionId: PROVIDER_SESSION_ID },
    });

    assert.equal(ask.sessionId, SESSION_ID);
    assert.equal(ask.status, 'open');
    assert.deepEqual(ask.options, ['Yes', 'No']);
    assert.deepEqual(agentAsksService.listForSession(SESSION_ID).map((item) => item.id), [ask.id]);
    assert.equal(agentAsksService.listOpen()[0].sessionTitle, 'Bench master');
    assert.equal(frames.at(-1)?.kind, 'agent_asks_changed');
    assert.equal(frames.at(-1)?.sessionId, SESSION_ID);
  });
});

test('an agent with no session id names its chat by title or session id', async () => {
  await withIsolatedDatabase(() => {
    const byTitle = agentAsksService.create({ kind: 'ack', title: 'Bench A2 left as found', origin: { chat: 'bench master' } });
    const byId = agentAsksService.create({ kind: 'ack', title: 'Second', origin: { chat: SESSION_ID } });
    assert.equal(byTitle.sessionId, SESSION_ID);
    assert.equal(byId.sessionId, SESSION_ID);

    expectAppError(
      () => agentAsksService.create({ kind: 'ack', title: 'Third', origin: { chat: 'No such chat' } }),
      'AGENT_ASK_CHAT_NOT_FOUND',
    );
    expectAppError(
      () => agentAsksService.create({ kind: 'ack', title: 'Fourth', origin: {} }),
      'AGENT_ASK_CHAT_REQUIRED',
    );
  });
});

test('an item recorded before its session is indexed is adopted when the session appears', async () => {
  await withIsolatedDatabase((frames) => {
    const ask = agentAsksService.create({
      kind: 'question',
      title: 'Asked early',
      origin: { providerSessionId: 'not-indexed-yet' },
    });
    assert.equal(ask.sessionId, null);

    sessionsDb.createAppSession('late-session', 'claude', '/tmp', 'Late');
    sessionsDb.assignProviderSessionId('late-session', 'not-indexed-yet');
    frames.length = 0;

    assert.deepEqual(agentAsksService.listForSession('late-session').map((item) => item.id), [ask.id]);
    assert.equal(frames.some((frame) => frame.sessionId === 'late-session'), true);
  });
});

test('answering closes the item once and returns the message for the chat', async () => {
  await withIsolatedDatabase(() => {
    const question = agentAsksService.create({ kind: 'question', title: 'Which base?', origin: { chat: SESSION_ID } });
    const ack = agentAsksService.create({ kind: 'ack', title: 'Lab is down', origin: { chat: SESSION_ID } });
    const dropped = agentAsksService.create({ kind: 'question', title: 'Never mind', origin: { chat: SESSION_ID } });

    expectAppError(() => agentAsksService.resolve(question.id, { action: 'answer', answer: '  ' }), 'INVALID_REQUEST_BODY');

    const answered = agentAsksService.resolve(question.id, { action: 'answer', answer: 'release/wos/16' });
    assert.equal(answered.ask.status, 'answered');
    assert.equal(answered.chatMessage, `Answer to your question #${question.id} ("Which base?"):\n\nrelease/wos/16`);
    expectAppError(() => agentAsksService.resolve(question.id, { action: 'answer', answer: 'again' }), 'AGENT_ASK_NOT_OPEN');

    assert.equal(agentAsksService.resolve(ack.id, { action: 'ack' }).chatMessage, `Acknowledged #${ack.id} ("Lab is down").`);
    assert.equal(agentAsksService.resolve(dropped.id, { action: 'dismiss' }).chatMessage, null);

    assert.equal(agentAsksService.listOpen().length, 0);
    const listed = agentAsksService.listForOrigin({ providerSessionId: PROVIDER_SESSION_ID });
    assert.equal(listed.find((item) => item.id === question.id)?.answer, 'release/wos/16');
  });
});

test('only the chat that recorded an item can withdraw it', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('other-session', 'claude', '/tmp', 'Other chat');
    const ask = agentAsksService.create({ kind: 'question', title: 'Mine', origin: { chat: SESSION_ID } });

    expectAppError(() => agentAsksService.withdraw(ask.id, null, { chat: 'other-session' }), 'AGENT_ASK_OTHER_CHAT');
    const withdrawn = agentAsksService.withdraw(`#${ask.id}`, 'Found it in the log', { providerSessionId: PROVIDER_SESSION_ID });
    assert.equal(withdrawn.status, 'withdrawn');
    assert.equal(withdrawn.answer, 'Found it in the log');
  });
});

test('an open item of a deleted chat is listed without a chat', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('short-lived', 'claude', '/tmp', 'Short-lived');
    const ask = agentAsksService.create({ kind: 'question', title: 'Orphan', origin: { chat: 'short-lived' } });
    assert.equal(agentAsksService.listOpen()[0].sessionId, 'short-lived');

    sessionsDb.deleteSessionById('short-lived');
    const [orphan] = agentAsksService.listOpen();
    assert.equal(orphan.id, ask.id);
    assert.equal(orphan.sessionId, null);
    assert.equal(agentAsksService.resolve(ask.id, { action: 'dismiss' }).ask.status, 'dismissed');
  });
});
