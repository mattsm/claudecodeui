import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import {
  closeSessionTitleWatcher,
  collectRenamedSessions,
} from '@/modules/providers/services/session-title-watcher.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'session-title-watcher-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeSessionTitleWatcher();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('a title written straight into the database is picked up as a rename', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('held-board', 'claude', '/tmp/title-project');
    sessionsDb.createAppSession('untouched', 'claude', '/tmp/title-project');

    assert.deepEqual(collectRenamedSessions(), [], 'the first read only records the names');

    // What the board-lock tool does: no route, a direct UPDATE.
    getConnection().prepare('UPDATE sessions SET custom_name = ? WHERE session_id = ?').run('🔒A3 flash test', 'held-board');
    assert.deepEqual(collectRenamedSessions(), ['held-board']);

    assert.deepEqual(collectRenamedSessions(), [], 'an unchanged name is not announced again');

    getConnection().prepare('UPDATE sessions SET custom_name = NULL WHERE session_id = ?').run('held-board');
    assert.deepEqual(collectRenamedSessions(), ['held-board'], 'clearing the name is a change too');
  });
});

test('a session created between reads is not reported as renamed', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    collectRenamedSessions();
    sessionsDb.createAppSession('new-chat', 'claude', '/tmp/title-project');
    assert.deepEqual(collectRenamedSessions(), []);
  });
});
