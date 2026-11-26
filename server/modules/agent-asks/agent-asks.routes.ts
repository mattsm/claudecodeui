import express from 'express';
import type { Request, Response } from 'express';

import { agentAsksService } from '@/modules/agent-asks/agent-asks.service.js';
import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

const router = express.Router();

// With a session id: that chat's open and recently closed items. Without one:
// the open items of every chat.
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    res.json(createApiSuccessResponse(
      sessionId ? agentAsksService.listForSession(sessionId) : agentAsksService.listOpen(),
    ));
  }),
);

router.post(
  '/:id/resolve',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(createApiSuccessResponse(
      agentAsksService.resolve(req.params.id, { action: body.action, answer: body.answer }),
    ));
  }),
);

export default router;
