import { getConnection } from '@/modules/database/connection.js';

export type AgentAskKind = 'question' | 'ack';

export type AgentAskStatus = 'open' | 'answered' | 'acked' | 'dismissed' | 'withdrawn';

export type AgentAskRow = {
  id: number;
  session_id: string | null;
  provider_session_id: string | null;
  chat_label: string | null;
  project_path: string | null;
  kind: AgentAskKind;
  title: string;
  details: string | null;
  options: string;
  status: AgentAskStatus;
  answer: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

/** An open item's row with the title of its chat, and whether that chat still exists. */
export type OpenAgentAskRow = AgentAskRow & { session_title: string | null; session_exists: number };

const COLUMNS =
  'id, session_id, provider_session_id, chat_label, project_path, kind, title, details, options, status, answer, created_at, updated_at, resolved_at';

/** How many resolved items a chat's list carries; older ones stay in the table. */
const RESOLVED_HISTORY_LIMIT = 30;

export const agentAsksDb = {
  create(input: {
    sessionId: string | null;
    providerSessionId: string | null;
    chatLabel: string | null;
    projectPath: string | null;
    kind: AgentAskKind;
    title: string;
    details: string | null;
    options: string[];
  }): AgentAskRow {
    const db = getConnection();
    const result = db.prepare(
      `INSERT INTO agent_asks (session_id, provider_session_id, chat_label, project_path, kind, title, details, options)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.sessionId,
      input.providerSessionId,
      input.chatLabel,
      input.projectPath,
      input.kind,
      input.title,
      input.details,
      JSON.stringify(input.options),
    );

    return db.prepare(`SELECT ${COLUMNS} FROM agent_asks WHERE id = ?`).get(result.lastInsertRowid) as AgentAskRow;
  },

  getById(id: number): AgentAskRow | null {
    const row = getConnection()
      .prepare(`SELECT ${COLUMNS} FROM agent_asks WHERE id = ?`)
      .get(id) as AgentAskRow | undefined;
    return row ?? null;
  },

  /** A chat's open items, oldest first, then its most recently resolved ones. */
  listForSession(sessionId: string): AgentAskRow[] {
    const db = getConnection();
    const open = db
      .prepare(
        `SELECT ${COLUMNS} FROM agent_asks
         WHERE session_id = ? AND status = 'open'
         ORDER BY id ASC`
      )
      .all(sessionId) as AgentAskRow[];
    const resolved = db
      .prepare(
        `SELECT ${COLUMNS} FROM agent_asks
         WHERE session_id = ? AND status <> 'open'
         ORDER BY datetime(resolved_at) DESC, id DESC
         LIMIT ?`
      )
      .all(sessionId, RESOLVED_HISTORY_LIMIT) as AgentAskRow[];
    return [...open, ...resolved];
  },

  /** Every open item in every chat, oldest first, with its chat's title. */
  listOpen(): OpenAgentAskRow[] {
    return getConnection()
      .prepare(
        `SELECT ${COLUMNS.split(', ').map((column) => `asks.${column}`).join(', ')},
                sessions.custom_name AS session_title,
                sessions.session_id IS NOT NULL AS session_exists
         FROM agent_asks AS asks
         LEFT JOIN sessions ON sessions.session_id = asks.session_id
         WHERE asks.status = 'open'
         ORDER BY asks.id ASC`
      )
      .all() as OpenAgentAskRow[];
  },

  /**
   * Closes an open item. Returns the updated row, or null when the item is
   * missing or already closed, so two tabs cannot both answer it.
   */
  resolve(id: number, status: Exclude<AgentAskStatus, 'open'>, answer: string | null): AgentAskRow | null {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE agent_asks
         SET status = ?, answer = ?, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'open'`
      )
      .run(status, answer, id);
    return result.changes > 0 ? agentAsksDb.getById(id) : null;
  },

  /**
   * Gives items that were recorded without a chat to the session that now
   * matches their provider session id. Returns the session ids that gained items.
   */
  adoptUnassigned(): string[] {
    const db = getConnection();
    const adopted = db
      .prepare(
        `SELECT DISTINCT sessions.session_id AS session_id
         FROM agent_asks AS asks
         INNER JOIN sessions ON sessions.provider_session_id = asks.provider_session_id
         WHERE asks.session_id IS NULL AND asks.provider_session_id IS NOT NULL`
      )
      .all() as Array<{ session_id: string }>;
    if (adopted.length === 0) {
      return [];
    }

    db.prepare(
      `UPDATE agent_asks
       SET session_id = (
         SELECT sessions.session_id FROM sessions
         WHERE sessions.provider_session_id = agent_asks.provider_session_id
         ORDER BY sessions.updated_at DESC
         LIMIT 1
       )
       WHERE session_id IS NULL AND provider_session_id IS NOT NULL`
    ).run();
    return adopted.map((row) => row.session_id);
  },

  /** Sessions whose title is exactly the given text, ignoring case. */
  findSessionIdsByTitle(title: string): string[] {
    const rows = getConnection()
      .prepare(
        `SELECT session_id FROM sessions
         WHERE custom_name IS NOT NULL AND lower(trim(custom_name)) = lower(trim(?)) AND isArchived = 0`
      )
      .all(title) as Array<{ session_id: string }>;
    return rows.map((row) => row.session_id);
  },
};
