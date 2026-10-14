import type { Request, Response } from 'express';

import { asyncHandler } from '../../lib/asyncHandler';
import { getHealth } from './health.service';

export const getHealthHandler = asyncHandler(async (_req: Request, res: Response) => {
  const health = await getHealth();
  res.status(200).json(health);
});
