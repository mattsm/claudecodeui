import fs from 'node:fs';

import Database from 'better-sqlite3';

type AnyRecord = Record<string, any>;

/**
 * A full-text index of Claude transcripts, kept in its own SQLite file.
 *
 * The transcripts are several gigabytes, nearly all of it tool output, and a
 * search used to read every file that held a query word. The index keeps only
 * what a search can show: the message text, and the links a chat touched (from
 * its commands, their output, and the `pr-link` rows Claude Code writes for the
 * pull requests a session worked on).
 *
 * The file is a cache. Nothing else lives in it, and deleting it only costs a
 * rebuild. Transcripts are append-only, so a file is indexed from the offset
 * the last pass stopped at.
 */

/** Bump to rebuild every file's rows after a change to what is indexed. */
const INDEX_VERSION = 1;
const READ_CHUNK_BYTES = 1024 * 1024;
/** A line this long is tool output or an attachment. It is scanned for links without being parsed. */
const MAX_PARSED_LINE_BYTES = 2 * 1024 * 1024;
const MAX_URL_LENGTH = 400;
const URL_PATTERN = /https?:\/\/[^\s"'<>\\)\]}`|]+/g;

export type IndexedMessage = { role: string; text: string; timestamp: string | null; uuid: string | null };
export type IndexedLink = { sessionId: string; url: string; timestamp: string | null; kind: 'pr' | 'tool' };
type ExtractMessage = (entry: AnyRecord) => { text: string; role: string } | null;

type FileRow = { path: string; offset: number; version: number; last_session_id: string | null };

/** The session id as one index token: letters and digits only. */
export const toSessionToken = (sessionId: string): string => `s${sessionId.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

const yieldToEventLoop = () => new Promise<void>((resolve) => { setImmediate(resolve); });

function collectUrls(text: string, into: Set<string>): void {
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(/[.,;:!?]+$/, '');
    if (url.length > 10 && url.length <= MAX_URL_LENGTH) {
      into.add(url);
    }
  }
}

export class SessionSearchIndex {
  private readonly db: Database.Database;
  private readonly extractMessage: ExtractMessage;
  private refreshing: Promise<void> = Promise.resolve();
  private ready = false;

  constructor(file: string, extractMessage: ExtractMessage) {
    this.extractMessage = extractMessage;
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        offset INTEGER NOT NULL,
        version INTEGER NOT NULL,
        last_session_id TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(
        text, sid, role UNINDEXED, ts UNINDEXED, uuid UNINDEXED, path UNINDEXED,
        tokenize = 'unicode61'
      );
      CREATE TABLE IF NOT EXISTS links (
        session_id TEXT NOT NULL,
        url TEXT NOT NULL,
        url_lower TEXT NOT NULL,
        ts TEXT,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        PRIMARY KEY (session_id, url)
      );
    `);
  }

  /** True once every known transcript has been indexed at least once since start-up. */
  isReady(): boolean {
    return this.ready;
  }

  close(): void {
    this.db.close();
  }

  /**
   * Indexes whatever the given transcripts gained since the last pass. Passes
   * run one at a time; a second caller waits for the first and then runs its
   * own, which finds little left to do.
   */
  refresh(paths: string[], signal?: AbortSignal | null): Promise<void> {
    const run = this.refreshing.then(() => this.refreshNow(paths, signal ?? null));
    this.refreshing = run.catch(() => undefined);
    return run;
  }

  /** A full pass over every transcript, after which searches may use the index. */
  async build(paths: string[]): Promise<void> {
    await this.refresh(paths);
    this.ready = true;
  }

  private async refreshNow(paths: string[], signal: AbortSignal | null): Promise<void> {
    const known = new Map(
      (this.db.prepare('SELECT path, offset, version, last_session_id FROM files').all() as FileRow[]).map((row) => [row.path, row]),
    );
    for (const file of paths) {
      if (signal?.aborted) {
        return;
      }
      let size: number;
      try {
        size = fs.statSync(file).size;
      } catch {
        continue;
      }
      let row = known.get(file) ?? null;
      // A rewritten or shortened file, or rows from an older layout: start over.
      if (row && (row.version !== INDEX_VERSION || size < row.offset)) {
        this.forget(file);
        row = null;
      }
      if (row && row.offset === size) {
        continue;
      }
      await this.indexFile(file, row?.offset ?? 0, size, row?.last_session_id ?? null, signal);
    }
  }

  private forget(file: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE path = ?').run(file);
      this.db.prepare('DELETE FROM links WHERE path = ?').run(file);
      this.db.prepare('DELETE FROM files WHERE path = ?').run(file);
    })();
  }

  private async indexFile(
    file: string,
    startOffset: number,
    size: number,
    startSessionId: string | null,
    signal: AbortSignal | null,
  ): Promise<void> {
    const insertMessage = this.db.prepare('INSERT INTO messages (text, sid, role, ts, uuid, path) VALUES (?, ?, ?, ?, ?, ?)');
    // A pull request the session itself recorded outranks the same link seen in output.
    const insertLink = this.db.prepare(`
      INSERT INTO links (session_id, url, url_lower, ts, kind, path) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, url) DO UPDATE SET kind = excluded.kind WHERE excluded.kind = 'pr'
    `);
    const saveProgress = this.db.prepare(`
      INSERT INTO files (path, offset, version, last_session_id) VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET offset = excluded.offset, version = excluded.version, last_session_id = excluded.last_session_id
    `);

    let currentSessionId = startSessionId;
    const indexLine = (line: Buffer): void => {
      if (line.length === 0) {
        return;
      }
      const urls = new Set<string>();
      if (line.length > MAX_PARSED_LINE_BYTES) {
        const raw = line.toString('utf8');
        const sessionId = /"sessionId":"([^"]+)"/.exec(raw)?.[1] ?? currentSessionId;
        if (!sessionId) {
          return;
        }
        currentSessionId = sessionId;
        collectUrls(raw, urls);
        const timestamp = /"timestamp":"([^"]+)"/.exec(raw)?.[1] ?? null;
        for (const url of urls) {
          insertLink.run(sessionId, url, url.toLowerCase(), timestamp, 'tool', file);
        }
        return;
      }

      let entry: AnyRecord;
      try {
        entry = JSON.parse(line.toString('utf8')) as AnyRecord;
      } catch {
        return;
      }
      if (entry.sessionId) {
        currentSessionId = String(entry.sessionId);
      }
      const sessionId = currentSessionId;
      if (!sessionId) {
        return;
      }
      const timestamp = entry.timestamp ? String(entry.timestamp) : null;

      if (entry.type === 'pr-link' && typeof entry.prUrl === 'string') {
        insertLink.run(sessionId, entry.prUrl, entry.prUrl.toLowerCase(), timestamp, 'pr', file);
        return;
      }

      const message = this.extractMessage(entry);
      if (message?.text) {
        insertMessage.run(message.text, toSessionToken(sessionId), message.role, timestamp, entry.uuid ? String(entry.uuid) : null, file);
      }

      const content = entry.message?.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === 'tool_use') {
            collectUrls(JSON.stringify(part.input ?? ''), urls);
          } else if (part?.type === 'tool_result') {
            collectUrls(typeof part.content === 'string' ? part.content : JSON.stringify(part.content ?? ''), urls);
          }
        }
      }
      for (const url of urls) {
        insertLink.run(sessionId, url, url.toLowerCase(), timestamp, 'tool', file);
      }
    };

    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(file, 'r');
    } catch {
      return;
    }

    try {
      const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      let position = startOffset;
      // The start of a line whose end has not been read yet.
      let carry: Buffer = Buffer.alloc(0);
      while (position < size && !signal?.aborted) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(READ_CHUNK_BYTES, size - position), position);
        if (bytesRead === 0) {
          break;
        }
        position += bytesRead;
        const chunk = carry.length > 0 ? Buffer.concat([carry, buffer.subarray(0, bytesRead)]) : buffer.subarray(0, bytesRead);
        const lastNewline = chunk.lastIndexOf(0x0a);
        if (lastNewline === -1) {
          carry = Buffer.from(chunk);
          continue;
        }

        // Only whole lines are indexed; the offset saved is the end of the last one.
        const indexedThrough = position - (chunk.length - lastNewline - 1);
        this.db.transaction(() => {
          let lineStart = 0;
          while (lineStart <= lastNewline) {
            const lineEnd = chunk.indexOf(0x0a, lineStart);
            indexLine(chunk.subarray(lineStart, lineEnd));
            lineStart = lineEnd + 1;
          }
          saveProgress.run(file, indexedThrough, INDEX_VERSION, currentSessionId);
        })();
        carry = Buffer.from(chunk.subarray(lastNewline + 1));
        // The server stays responsive while a large file is read.
        await yieldToEventLoop();
      }
    } finally {
      await handle.close();
    }
  }

  /** The sessions with at least one message matching the full-text expression. */
  sessionTokensMatching(matchExpression: string): Set<string> {
    const rows = this.db.prepare('SELECT DISTINCT sid FROM messages WHERE messages MATCH ?').all(matchExpression) as { sid: string }[];
    return new Set(rows.map((row) => row.sid));
  }

  /** One session's messages matching the expression, oldest first. */
  messagesMatching(matchExpression: string, sessionId: string, limit: number, offset: number): IndexedMessage[] {
    const rows = this.db
      .prepare('SELECT role, text, ts, uuid FROM messages WHERE messages MATCH ? ORDER BY rowid LIMIT ? OFFSET ?')
      .all(`(${matchExpression}) AND sid : ${toSessionToken(sessionId)}`, limit, offset) as { role: string; text: string; ts: string | null; uuid: string | null }[];
    return rows.map((row) => ({ role: row.role, text: row.text, timestamp: row.ts, uuid: row.uuid }));
  }

  /** The first thing the user said in a session, for a result's label. */
  firstUserText(sessionId: string): string | null {
    const rows = this.db
      .prepare('SELECT role, text FROM messages WHERE messages MATCH ? ORDER BY rowid LIMIT 20')
      .all(`sid : ${toSessionToken(sessionId)}`) as { role: string; text: string }[];
    return rows.find((row) => row.role === 'user')?.text ?? rows[0]?.text ?? null;
  }

  /** The links holding any of the given texts, compared without case. */
  linksContaining(needles: string[]): IndexedLink[] {
    const found = new Map<string, IndexedLink>();
    const select = this.db.prepare("SELECT session_id, url, ts, kind FROM links WHERE url_lower LIKE ? ESCAPE '\\'");
    for (const needle of needles) {
      const pattern = `%${needle.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
      for (const row of select.all(pattern) as { session_id: string; url: string; ts: string | null; kind: 'pr' | 'tool' }[]) {
        found.set(`${row.session_id}\n${row.url}`, { sessionId: row.session_id, url: row.url, timestamp: row.ts, kind: row.kind });
      }
    }
    return [...found.values()];
  }

  /** Row counts, for the log line after a build. */
  stats(): { files: number; messages: number; links: number } {
    const count = (table: string) => (this.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
    return { files: count('files'), messages: count('messages'), links: count('links') };
  }
}
