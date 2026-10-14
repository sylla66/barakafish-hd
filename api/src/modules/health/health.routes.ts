import { Router } from 'express';

import { getHealthHandler } from './health.controller';

export const healthRouter = Router();

healthRouter.get('/', getHealthHandler);
