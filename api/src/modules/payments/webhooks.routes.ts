import { Router } from 'express';

import { asyncHandler } from '../../lib/asyncHandler';
import { paymentWebhookHandler } from './payments.controller';

// Webhooks fournisseurs : monte sur /webhooks. Le corps doit rester BRUT
// (express.raw configure dans app.ts) pour verifier la signature HMAC.
export const webhooksRouter = Router();

webhooksRouter.post('/payment', asyncHandler(paymentWebhookHandler));
