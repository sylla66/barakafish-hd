import { Router } from 'express';

import { asyncHandler } from '../../lib/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import {
  getPaymentHandler,
  mockPaymentPageHandler,
  mockPaymentSimulateHandler,
} from './payments.controller';

export const paymentsRouter = Router();

// Page de simulation du fournisseur mock : ouverte au navigateur (pas de jeton
// Bearer possible sur une navigation), protegee par l'unicite de la reference.
paymentsRouter.get('/mock/:reference', asyncHandler(mockPaymentPageHandler));
paymentsRouter.post('/mock/:reference/simulate', asyncHandler(mockPaymentSimulateHandler));

paymentsRouter.get('/reference/:reference', requireAuth, asyncHandler(getPaymentHandler));
