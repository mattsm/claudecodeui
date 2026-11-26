#!/usr/bin/env node
// Stdio MCP server that lets an agent record questions and acknowledgement
// requests for the user. It only forwards each call to the CloudCLI server.

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

const apiUrl = (process.env.CLOUDCLI_AGENT_ASKS_API_URL || 'http://127.0.0.1:3001/api/agent-asks-mcp').replace(/\/$/, '');
const apiToken = process.env.CLOUDCLI_AGENT_ASKS_MCP_TOKEN || '';
const API_TIMEOUT_MS = 15_000;

const CHAT_PROPERTY = {
  type: 'string',
  description:
    'Only needed when a call fails with "cannot tell which chat this is" (agents other than Claude Code): '
    + 'the exact title of your chat, or its session id.',
};

const tools = [
  {
    name: 'ask_user',
    description:
      'Record a question for the user, or something the user must acknowledge, in the list CloudCLI shows beside '
      + 'this chat. The call returns at once and does not wait for the user: carry on with the work that does not '
      + 'depend on the reply. The reply arrives later as a normal chat message that names the item number. Use '
      + 'kind "question" when you need a decision or a fact, and kind "ack" when the user must see and confirm '
      + 'something (a risk, a finished step that needs sign-off, a change of plan). One item per call. Write the '
      + 'title so that it can be understood without the chat, and put the context the user needs in details.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['question', 'ack'] },
        title: { type: 'string', description: 'The question, or what to acknowledge, in one sentence.' },
        details: { type: 'string', description: 'Optional context in Markdown: what you found, the choices, your recommendation.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional short answers to offer as buttons, the recommended one first. The user can still type another answer.',
        },
        chat: CHAT_PROPERTY,
      },
      required: ['kind', 'title'],
    },
  },
  {
    name: 'list_asks',
    description:
      'List the items this chat recorded with ask_user: the open ones, then the recently closed ones with the '
      + 'user\'s answers. Use it after a restart or a context summary to see what you still wait on.',
    inputSchema: {
      type: 'object',
      properties: { chat: CHAT_PROPERTY },
    },
  },
  {
    name: 'close_ask',
    description:
      'Withdraw an open item this chat recorded, when you no longer need the user for it (answered in the chat, '
      + 'or no longer relevant).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'The item number.' },
        reason: { type: 'string', description: 'Optional: why it is no longer needed.' },
        chat: CHAT_PROPERTY,
      },
      required: ['id'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>) {
  if (!tools.some((tool) => tool.name === name)) {
    throw new Error(`Unknown tool: ${name}`);
  }
  if (!apiToken) {
    throw new Error('CLOUDCLI_AGENT_ASKS_MCP_TOKEN is not configured.');
  }

  const response = await fetch(`${apiUrl}/tools/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...args,
      // Claude Code tells its tool processes which session they serve.
      providerSessionId: process.env.CLAUDE_CODE_SESSION_ID || undefined,
      projectPath: process.cwd(),
    }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  // A server without these routes (an older release after a rollback) answers with a page, not JSON.
  const body = await response.json().catch(() => ({ success: false })) as { success?: boolean; data?: unknown; error?: unknown };
  if (!response.ok || body.success === false) {
    const error = body.error;
    const message = typeof error === 'string'
      ? error
      : (error as { message?: string } | undefined)?.message;
    throw new Error(message || `CloudCLI did not accept the request (HTTP ${response.status}). The running CloudCLI release may not have this feature.`);
  }
  return { content: [{ type: 'text', text: JSON.stringify(body.data, null, 2) }] };
}

async function handleMessage(message: JsonRpcRequest) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'cloudcli-asks', version: '1.0.0' },
    };
  }

  if (message.method === 'tools/list') {
    return { tools };
  }

  if (message.method === 'tools/call') {
    const params = message.params || {};
    const name = typeof params.name === 'string' ? params.name : '';
    const args = (params.arguments && typeof params.arguments === 'object'
      ? params.arguments
      : {}) as Record<string, unknown>;
    try {
      return await callTool(name, args);
    } catch (error) {
      // A tool failure is a result the agent can read and act on, not a protocol error.
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  }

  if (message.method === 'ping') {
    return {};
  }

  if (message.method.startsWith('notifications/')) {
    return undefined;
  }

  throw new Error(`Unsupported method: ${message.method}`);
}

function writeMessage(message: Record<string, unknown>) {
  // MCP stdio transport: one JSON-RPC message per line.
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let newlineIndex: number;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const rawMessage = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!rawMessage) {
      continue;
    }

    void (async () => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(rawMessage) as JsonRpcRequest;
      } catch {
        return;
      }
      try {
        const result = await handleMessage(request);
        if (request.id !== undefined) {
          writeMessage({ jsonrpc: '2.0', id: request.id, result });
        }
      } catch (error) {
        if (request.id !== undefined) {
          writeMessage({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
          });
        }
      }
    })();
  }
});
