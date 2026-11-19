import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import {
  buildSessionSearchIndex,
  closeSessionSearchIndex,
  decodeLinkQuery,
  initializeSessionSearchIndex,
  searchConversations,
  toIndexExpression,
} from '@/modules/providers/services/session-conversations-search.service.js';

/**
 * The transcript index answers a search without reading the transcripts
 * again, and finds a chat by a link that only its commands, their output, or
 * the pull-request rows Claude Code writes ever held. Synthetic data only.
 */

const PR_URL = 'https://github.com/example/widget-firmware/pull/265';

const userRow = (sessionId: string, uuid: string, text: string) => ({
  type: 'user', sessionId, uuid, timestamp: '2026-11-18T10:00:00.000Z', message: { role: 'user', content: text },
});
const assistantRow = (sessionId: string, uuid: string, text: string) => ({
  type: 'assistant', sessionId, uuid, timestamp: '2026-11-18T10:00:05.000Z',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});
const toolUseRow = (sessionId: string, uuid: string, command: string) => ({
  type: 'assistant', sessionId, uuid, timestamp: '2026-11-18T10:00:10.000Z',
  message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_${uuid}`, name: 'Bash', input: { command } }] },
});
const toolResultRow = (sessionId: string, uuid: string, output: string) => ({
  type: 'user', sessionId, uuid, timestamp: '2026-11-18T10:00:15.000Z',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${uuid}`, content: output }] },
});
const prLinkRow = (sessionId: string, url: string) => ({
  type: 'pr-link', sessionId, prNumber: 265, prUrl: url, prRepository: 'example/widget-firmware', timestamp: '2026-11-18T10:00:20.000Z',
});

const toJsonl = (rows: unknown[]) => rows.map((row) => `${JSON.stringify(row)}\n`).join('');

type Fixture = { directory: string; addSession: (name: string, title: string, rows: unknown[]) => Promise<string> };

async function withIndexedSessions(runTest: (fixture: Fixture) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'session-search-index-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  initializeSessionSearchIndex({ startDelayMs: null });

  const addSession = async (name: string, title: string, rows: unknown[]) => {
    const file = path.join(directory, `${name}.jsonl`);
    await writeFile(file, toJsonl(rows));
    sessionsDb.createSession(name, 'claude', '/workspace/widgets', title, undefined, undefined, file);
    return file;
  };

  try {
    await runTest({ directory, addSession });
  } finally {
    closeSessionSearchIndex();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

const found = async (query: string) => {
  const { results } = await searchConversations(query);
  return results.flatMap((project) => project.sessions.map((session) => ({
    title: session.sessionSummary,
    snippets: session.matches.map((match) => match.snippet),
  })));
};
const titles = async (query: string) => (await found(query)).map((session) => session.title).sort();

test('a query becomes a token-prefix expression, and a word of several tokens a phrase', () => {
  assert.equal(toIndexExpression(['odm', 'image']), '(text : "odm" *) AND (text : "image" *)');
  assert.equal(toIndexExpression(['github.com/example/pull/265']), '(text : "github com example pull 265" *)');
  assert.equal(toIndexExpression(['widget#265'], { prefix: false }), '(text : "widget 265")');
  assert.equal(toIndexExpression(['odm', '#']), null);
});

test('a link in a query is read so the same pull request is found however it was written', () => {
  assert.deepEqual(decodeLinkQuery(PR_URL), {
    exactTexts: ['github.com/example/widget-firmware/pull/265', 'widget-firmware#265'],
    linkNeedles: ['github.com/example/widget-firmware/pull/265'],
  });
  assert.deepEqual(decodeLinkQuery('widget-firmware#265'), {
    exactTexts: ['widget-firmware#265'],
    linkNeedles: ['widget-firmware/pull/265', 'widget-firmware/issues/265'],
  });
  assert.deepEqual(decodeLinkQuery('docs/build-system.md'), { exactTexts: [], linkNeedles: ['docs/build-system.md'] });
  assert.deepEqual(decodeLinkQuery('odm images'), { exactTexts: [], linkNeedles: [] });
});

test('the index finds what the file search found, by message text', async () => {
  await withIndexedSessions(async ({ addSession }) => {
    await addSession('s-text', 'antenna gain', [
      userRow('s-text', 'u1', 'the ODM image is ready for the A2'),
      assistantRow('s-text', 'u2', 'I will check the image now.'),
    ]);
    await addSession('s-other', 'unrelated', [userRow('s-other', 'u3', 'random notes about a pilgrimage')]);

    const fromFiles = await titles('odm images');
    await buildSessionSearchIndex();
    assert.deepEqual(await titles('odm images'), fromFiles);
    assert.deepEqual(await titles('odm images'), ['antenna gain']);
    // A word still has to start a token.
    assert.deepEqual(await titles('image'), ['antenna gain']);
    assert.deepEqual(await titles('grimage'), []);
  });
});

test('a pull-request link finds the chat that wrote it as a reference, ran it in a command, or recorded it', async () => {
  await withIndexedSessions(async ({ addSession }) => {
    await addSession('s-ref', 'wrote the reference', [
      userRow('s-ref', 'a1', 'please review it'),
      assistantRow('s-ref', 'a2', 'Opened [widget-firmware#265](placeholder) as a draft.'),
    ]);
    await addSession('s-cmd', 'ran the command', [
      userRow('s-cmd', 'b1', 'check the checks'),
      toolUseRow('s-cmd', 'b2', `gh pr checks ${PR_URL}`),
    ]);
    await addSession('s-out', 'saw it in output', [
      userRow('s-out', 'c1', 'open the pull request'),
      toolResultRow('s-out', 'c2', `Creating pull request\n${PR_URL}\n`),
    ]);
    await addSession('s-pr', 'recorded the pull request', [
      userRow('s-pr', 'd1', 'fix the gain table'),
      prLinkRow('s-pr', PR_URL),
    ]);
    await addSession('s-near', 'a different number', [
      userRow('s-near', 'e1', 'unrelated'),
      toolResultRow('s-near', 'e2', 'https://github.com/example/widget-firmware/pull/2651'),
      assistantRow('s-near', 'e3', 'See widget-firmware#2651.'),
    ]);

    // Reading the files finds none of them: no message holds the link itself.
    assert.deepEqual(await titles(PR_URL), []);

    await buildSessionSearchIndex();
    assert.deepEqual(await titles(PR_URL), [
      'ran the command', 'recorded the pull request', 'saw it in output', 'wrote the reference',
    ]);
    const byTitle = new Map((await found(PR_URL)).map((session) => [session.title, session.snippets]));
    assert.deepEqual(byTitle.get('recorded the pull request'), [`Pull request of this chat: ${PR_URL}`]);
    assert.deepEqual(byTitle.get('saw it in output'), [`Link in a command or its output: ${PR_URL}`]);

    // The short reference finds the chats that only ever held the link.
    assert.deepEqual(await titles('widget-firmware#265'), [
      'ran the command', 'recorded the pull request', 'saw it in output', 'wrote the reference',
    ]);
  });
});

test('text added to a transcript after the build is found by the next search', async () => {
  await withIndexedSessions(async ({ addSession }) => {
    const file = await addSession('s-live', 'live chat', [userRow('s-live', 'f1', 'start the lab')]);
    await buildSessionSearchIndex();
    assert.deepEqual(await titles('thermocouple'), []);

    await appendFile(file, toJsonl([assistantRow('s-live', 'f2', 'The thermocouple reads 41 C.')]));
    assert.deepEqual(await titles('thermocouple'), ['live chat']);
    // The earlier text is still there, once.
    assert.deepEqual((await found('start the lab'))[0].snippets, ['start the lab']);
  });
});

test('a transcript that was rewritten is indexed again from the start', async () => {
  await withIndexedSessions(async ({ addSession }) => {
    const file = await addSession('s-rewritten', 'rewritten chat', [
      userRow('s-rewritten', 'g1', 'the first draft mentions a gyroscope and much more text to make the file long'),
      assistantRow('s-rewritten', 'g2', 'noted'),
    ]);
    await buildSessionSearchIndex();
    assert.deepEqual(await titles('gyroscope'), ['rewritten chat']);

    await writeFile(file, toJsonl([userRow('s-rewritten', 'g3', 'a barometer')]));
    assert.deepEqual(await titles('gyroscope'), []);
    assert.deepEqual(await titles('barometer'), ['rewritten chat']);
  });
});

test('a line left unfinished by a writer is picked up once it is complete', async () => {
  await withIndexedSessions(async ({ addSession }) => {
    const file = await addSession('s-partial', 'partial line', [userRow('s-partial', 'h1', 'begin')]);
    const pending = JSON.stringify(assistantRow('s-partial', 'h2', 'the hygrometer is calibrated'));
    await appendFile(file, pending.slice(0, 40));
    await buildSessionSearchIndex();
    assert.deepEqual(await titles('hygrometer'), []);

    await appendFile(file, `${pending.slice(40)}\n`);
    assert.deepEqual(await titles('hygrometer'), ['partial line']);
  });
});
