import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionDraftsDb, userDb } from '@/modules/database/index.js';

/**
 * Local builds kept queued messages one per row in `queued_messages`. On the
 * upstream queue, rows still waiting are merged into the session's queued
 * message, in queue order, and the table goes.
 */
test('messages waiting in the local queue table move into the session draft queue', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'local-queue-migration-'));
  const databasePath = path.join(directory, 'auth.db');

  // A database as an earlier local build left it: users exist, and the
  // local queue table still holds messages.
  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();
  const userId = Number(userDb.createUser('queuer', 'hash').id);
  closeConnection();

  const seed = new Database(databasePath);
  seed.exec(`CREATE TABLE queued_messages (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, session_id TEXT NOT NULL,
    message TEXT NOT NULL, created_at TEXT NOT NULL)`);
  const insert = seed.prepare('INSERT INTO queued_messages (id, user_id, session_id, message, created_at) VALUES (?, ?, ?, ?, ?)');
  insert.run('q2', userId, 'session-a', JSON.stringify({ content: 'second', options: { model: 'b' }, attachments: [{ path: '/u/2.png' }] }), '2026-10-27T10:00:02.000Z');
  insert.run('q1', userId, 'session-a', JSON.stringify({ content: 'first', options: { model: 'a' }, attachments: [{ path: '/u/1.png' }] }), '2026-10-27T10:00:01.000Z');
  insert.run('q3', userId, 'session-b', JSON.stringify({ content: 'other session' }), '2026-10-27T10:00:03.000Z');
  insert.run('q4', userId + 99, 'session-c', JSON.stringify({ content: 'nobody to send it' }), '2026-10-27T10:00:04.000Z');
  seed.close();

  try {
    await initializeDatabase();

    const queued = new Map(sessionDraftsDb.getDrafts(userId).map((draft) => [draft.scope, draft.queuedMessage]));
    assert.deepEqual(queued.get('session-a'), {
      content: 'first\n\nsecond',
      options: { model: 'b' },
      attachments: [{ path: '/u/1.png' }, { path: '/u/2.png' }],
    });
    assert.deepEqual(queued.get('session-b'), { content: 'other session', attachments: [] });

    closeConnection();
    const after = new Database(databasePath, { readonly: true });
    const table = after.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'queued_messages'").get();
    after.close();
    assert.equal(table, undefined, 'the local table is gone');
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
