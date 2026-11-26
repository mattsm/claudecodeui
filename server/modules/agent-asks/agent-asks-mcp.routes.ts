import express from 'express';
import type { Request, Response } from 'express';

import { agentAsksService } from '@/modules/agent-asks/agent-asks.service.js';
import type { AgentAskOrigin } from '@/modules/agent-asks/agent-asks.service.js';
import { AppError, asyncHandler, createApiSuccessResponse, secretsMatch } from '@/shared/utils.js';

const router = express.Router();

function readBearerToken(header: unknown): string | null {
  if (typeof header !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(\S.*)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

const readOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

router.use((req, res, next) => {
  const token = readBearerToken(req.headers.authorization);
  if (!token || !secretsMatch(token, agentAsksService.getMcpToken())) {
    res.status(401).json({ success: false, error: 'Invalid agent tools token.' });
    return;
  }
  next();
});

router.post(
  '/tools/:toolName',
  asyncHandler(async (req: Request, res: Response) => {
    const input = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const origin: AgentAskOrigin = {
      providerSessionId: readOptionalString(input.providerSessionId),
      chat: readOptionalString(input.chat),
      projectPath: readOptionalString(input.projectPath),
    };

    switch (req.params.toolName) {
      case 'ask_user':
        res.json(createApiSuccessResponse(agentAsksService.create({
          kind: input.kind,
          title: input.title,
          details: input.details,
          options: input.options,
          origin,
        })));
        return;
      case 'list_asks':
        res.json(createApiSuccessResponse(agentAsksService.listForOrigin(origin)));
        return;
      case 'close_ask':
        res.json(createApiSuccessResponse(agentAsksService.withdraw(input.id, input.reason, origin)));
        return;
      default:
        throw new AppError(`Unknown tool "${req.params.toolName}".`, {
          code: 'AGENT_ASK_UNKNOWN_TOOL',
          statusCode: 404,
        });
    }
  }),
);

export default router;
