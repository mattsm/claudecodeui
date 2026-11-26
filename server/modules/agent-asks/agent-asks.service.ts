import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { agentAsksDb, appConfigDb, sessionsDb } from '@/modules/database/index.js';
import type { AgentAskKind, AgentAskRow, AgentAskStatus } from '@/modules/database/index.js';
import { providerMcpService } from '@/modules/providers/index.js';
import { broadcastToConnectedClients } from '@/modules/websocket/index.js';
import { AppError } from '@/shared/utils.js';

const MCP_SERVER_NAME = 'cloudcli-asks';
const MCP_TOKEN_KEY = 'agent_asks_mcp_token';
const MAX_TITLE_LENGTH = 300;
const MAX_TEXT_LENGTH = 20_000;
const MAX_OPTIONS = 6;
const MAX_OPTION_LENGTH = 200;

/** One question or acknowledgement request, as the panel and the agent tools see it. */
export type AgentAsk = {
  id: number;
  /** The chat the item belongs to; null until its session is known to the app. */
  sessionId: string | null;
  kind: AgentAskKind;
  title: string;
  details: string | null;
  /** Answers the agent suggests; the panel offers each as a button. */
  options: string[];
  status: AgentAskStatus;
  /** The user's answer or note; for a withdrawn item, the agent's reason. */
  answer: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

/**
 * An open item with the title of its chat, for the list that spans every chat.
 * `sessionId` is null here also when the chat has been deleted, so the panel
 * can offer the item for dismissal instead of a link that leads nowhere.
 */
export type OpenAgentAsk = AgentAsk & { sessionTitle: string | null };

/** How an agent tool call says which chat it comes from. */
export type AgentAskOrigin = {
  /** The provider's own session id, read from the tool process's environment. */
  providerSessionId?: string | null;
  /** A chat title or session id the agent passed, for providers that set no session id. */
  chat?: string | null;
  projectPath?: string | null;
};

function readOptions(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((option): option is string => typeof option === 'string') : [];
  } catch {
    return [];
  }
}

/** SQLite stores "YYYY-MM-DD HH:MM:SS" in UTC; the panel and the agents get an ISO instant. */
function toIsoTime(sqliteTime: string): string {
  return sqliteTime.includes('T') ? sqliteTime : `${sqliteTime.replace(' ', 'T')}Z`;
}

function toAgentAsk(row: AgentAskRow): AgentAsk {
  return {
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind,
    title: row.title,
    details: row.details,
    options: readOptions(row.options),
    status: row.status,
    answer: row.answer,
    createdAt: toIsoTime(row.created_at),
    resolvedAt: row.resolved_at ? toIsoTime(row.resolved_at) : null,
  };
}

/**
 * Tells every open client that the items changed, so the panel and the sidebar
 * counts read them again. The frame carries no item text: each client reads
 * the lists through the authenticated routes.
 */
function announceChanged(sessionId: string | null): void {
  try {
    broadcastToConnectedClients(JSON.stringify({
      kind: 'agent_asks_changed',
      ...(sessionId ? { sessionId } : {}),
      timestamp: new Date().toISOString(),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[AgentAsks] Failed to announce a change', { sessionId, error: message });
  }
}

/** Gives items recorded before their session was indexed to that session. */
function adoptUnassigned(): void {
  for (const sessionId of agentAsksDb.adoptUnassigned()) {
    announceChanged(sessionId);
  }
}

function findSessionId(id: string): string | null {
  return (sessionsDb.getSessionById(id) ?? sessionsDb.getSessionByProviderSessionId(id))?.session_id ?? null;
}

/**
 * The chat a tool call belongs to. Returns null when the provider session id
 * is not indexed yet: the item is then stored without a chat and adopted once
 * the session shows up.
 */
function resolveOriginSession(origin: AgentAskOrigin): string | null {
  const chat = origin.chat?.trim();
  if (chat) {
    const byId = findSessionId(chat);
    if (byId) {
      return byId;
    }
    const byTitle = agentAsksDb.findSessionIdsByTitle(chat);
    if (byTitle.length === 1) {
      return byTitle[0];
    }
    throw new AppError(
      byTitle.length > 1
        ? `${byTitle.length} chats are titled "${chat}". Pass the chat's session id as "chat" instead.`
        : `No chat has the title or session id "${chat}". Pass this chat's exact title or its session id as "chat".`,
      { code: 'AGENT_ASK_CHAT_NOT_FOUND', statusCode: 404 },
    );
  }

  const providerSessionId = origin.providerSessionId?.trim();
  if (providerSessionId) {
    return findSessionId(providerSessionId);
  }

  throw new AppError(
    'CloudCLI cannot tell which chat this is. Pass "chat": this chat\'s exact title or its session id.',
    { code: 'AGENT_ASK_CHAT_REQUIRED', statusCode: 400 },
  );
}

function readText(value: unknown, field: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new AppError(`${field} is required.`, { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  }
  if (text.length > maxLength) {
    throw new AppError(`${field} is longer than ${maxLength} characters.`, {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }
  return text;
}

function readOptionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    return null;
  }
  return readText(value, field, maxLength);
}

function getOpenAsk(id: number): AgentAskRow {
  const row = agentAsksDb.getById(id);
  if (!row) {
    throw new AppError(`Item #${id} was not found.`, { code: 'AGENT_ASK_NOT_FOUND', statusCode: 404 });
  }
  if (row.status !== 'open') {
    throw new AppError(`Item #${id} is already closed (${row.status}).`, {
      code: 'AGENT_ASK_NOT_OPEN',
      statusCode: 409,
    });
  }
  return row;
}

/** One line for the chat, so the agent can tell which item the user's reply is for. */
function buildChatMessage(row: AgentAskRow): string | null {
  const reference = `#${row.id} ("${row.title}")`;
  if (row.status === 'answered') {
    return `Answer to your question ${reference}:\n\n${row.answer ?? ''}`;
  }
  if (row.status === 'acked') {
    return row.answer ? `Acknowledged ${reference}:\n\n${row.answer}` : `Acknowledged ${reference}.`;
  }
  return null;
}

function getOrCreateMcpToken(): string {
  const existing = appConfigDb.get(MCP_TOKEN_KEY);
  if (existing) {
    return existing;
  }
  const token = randomBytes(32).toString('hex');
  appConfigDb.set(MCP_TOKEN_KEY, token);
  return token;
}

export const agentAsksService = {
  /** Records a question or an acknowledgement request from an agent. */
  create(input: {
    kind: unknown;
    title: unknown;
    details?: unknown;
    options?: unknown;
    origin: AgentAskOrigin;
  }): AgentAsk {
    if (input.kind !== 'question' && input.kind !== 'ack') {
      throw new AppError('kind must be "question" or "ack".', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
    }
    const title = readText(input.title, 'title', MAX_TITLE_LENGTH);
    const details = readOptionalText(input.details, 'details', MAX_TEXT_LENGTH);
    const options = Array.isArray(input.options)
      ? input.options
        .filter((option): option is string => typeof option === 'string' && option.trim() !== '')
        .slice(0, MAX_OPTIONS)
        .map((option) => option.trim().slice(0, MAX_OPTION_LENGTH))
      : [];

    const sessionId = resolveOriginSession(input.origin);
    const row = agentAsksDb.create({
      sessionId,
      providerSessionId: input.origin.providerSessionId?.trim() || null,
      chatLabel: input.origin.chat?.trim() || null,
      projectPath: input.origin.projectPath?.trim() || null,
      kind: input.kind,
      title,
      details,
      options,
    });
    announceChanged(sessionId);
    return toAgentAsk(row);
  },

  /** The calling agent's own items: the open ones, then the recently closed ones with their answers. */
  listForOrigin(origin: AgentAskOrigin): AgentAsk[] {
    adoptUnassigned();
    const sessionId = resolveOriginSession(origin);
    return sessionId ? agentAsksDb.listForSession(sessionId).map(toAgentAsk) : [];
  },

  /** Closes an item the agent no longer needs the user for. Only the chat that recorded it may do so. */
  withdraw(idInput: unknown, reason: unknown, origin: AgentAskOrigin): AgentAsk {
    const row = getOpenAsk(readAskId(idInput));
    const sessionId = resolveOriginSession(origin);
    const sameChat = row.session_id
      ? row.session_id === sessionId
      : Boolean(row.provider_session_id) && row.provider_session_id === origin.providerSessionId?.trim();
    if (!sameChat) {
      throw new AppError(`Item #${row.id} belongs to another chat.`, {
        code: 'AGENT_ASK_OTHER_CHAT',
        statusCode: 403,
      });
    }
    const updated = agentAsksDb.resolve(row.id, 'withdrawn', readOptionalText(reason, 'reason', MAX_TEXT_LENGTH));
    if (!updated) {
      throw new AppError(`Item #${row.id} is already closed.`, { code: 'AGENT_ASK_NOT_OPEN', statusCode: 409 });
    }
    announceChanged(updated.session_id);
    return toAgentAsk(updated);
  },

  /** One chat's items for the panel. */
  listForSession(sessionId: string): AgentAsk[] {
    adoptUnassigned();
    return agentAsksDb.listForSession(sessionId).map(toAgentAsk);
  },

  /** Every open item in every chat, for the sidebar counts and the panel's list of other chats. */
  listOpen(): OpenAgentAsk[] {
    adoptUnassigned();
    return agentAsksDb.listOpen().map((row) => ({
      ...toAgentAsk(row),
      sessionId: row.session_exists ? row.session_id : null,
      sessionTitle: row.session_title,
    }));
  },

  /**
   * Closes an item from the panel. Returns the item and the message the client
   * sends to the chat, so the agent learns the answer; a dismissal sends none.
   */
  resolve(idInput: unknown, input: { action: unknown; answer?: unknown }): { ask: AgentAsk; chatMessage: string | null } {
    const row = getOpenAsk(readAskId(idInput));
    let status: Exclude<AgentAskStatus, 'open' | 'withdrawn'>;
    let answer: string | null;
    if (input.action === 'answer') {
      status = 'answered';
      answer = readText(input.answer, 'answer', MAX_TEXT_LENGTH);
    } else if (input.action === 'ack') {
      status = 'acked';
      answer = readOptionalText(input.answer, 'answer', MAX_TEXT_LENGTH);
    } else if (input.action === 'dismiss') {
      status = 'dismissed';
      answer = null;
    } else {
      throw new AppError('action must be "answer", "ack" or "dismiss".', {
        code: 'INVALID_REQUEST_BODY',
        statusCode: 400,
      });
    }

    const updated = agentAsksDb.resolve(row.id, status, answer);
    if (!updated) {
      throw new AppError(`Item #${row.id} is already closed.`, { code: 'AGENT_ASK_NOT_OPEN', statusCode: 409 });
    }
    announceChanged(updated.session_id);
    return { ask: toAgentAsk(updated), chatMessage: buildChatMessage(updated) };
  },

  getMcpToken(): string {
    return getOrCreateMcpToken();
  },

  /**
   * Makes the agent tools available in every provider's user configuration.
   *
   * Runs at each server start, because the tool script lives inside the
   * running release and its path changes with the release. A provider whose
   * entry already matches is left alone, so a start normally writes nothing.
   */
  async registerAgentMcp(): Promise<void> {
    const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'agent-asks-mcp.js');
    if (!fs.existsSync(scriptPath)) {
      // Running from TypeScript sources (tests, dev server): nothing to point a provider at.
      return;
    }

    const port = process.env.SERVER_PORT || process.env.PORT || '3001';
    const results = await providerMcpService.syncMcpServerToAllProviders({
      name: MCP_SERVER_NAME,
      command: process.execPath,
      args: [scriptPath],
      env: {
        CLOUDCLI_AGENT_ASKS_MCP_TOKEN: getOrCreateMcpToken(),
        CLOUDCLI_AGENT_ASKS_API_URL: `http://127.0.0.1:${port}/api/agent-asks-mcp`,
      },
    });
    for (const result of results) {
      if (result.error) {
        console.warn(`[AgentAsks] Could not register the agent tools for ${result.provider}: ${result.error}`);
      }
    }
  },
};

function readAskId(value: unknown): number {
  const id = typeof value === 'number' ? value : Number.parseInt(String(value ?? '').replace(/^#/, ''), 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError('id must be the number of an item.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  }
  return id;
}
