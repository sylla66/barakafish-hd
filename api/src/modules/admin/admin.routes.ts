import { Router } from 'express';

import { asyncHandler } from '../../lib/asyncHandler';
import { requireAuth, requireRole } from '../../middleware/auth';
import {
  getDisputeHandler,
  listDisputesHandler,
  resolveDisputeHandler,
} from '../disputes/disputes.controller';
import { retryPayoutHandler } from '../payments/payments.controller';
import {
  listSellersHandler,
  rejectSellerHandler,
  suspendSellerHandler,
  verifySellerHandler,
} from './admin.controller';

// Back-office : reserve aux administrateurs.
export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('admin'));

adminRouter.get('/sellers', asyncHandler(listSellersHandler));
adminRouter.post('/sellers/:id/verify', asyncHandler(verifySellerHandler));
adminRouter.post('/sellers/:id/reject', asyncHandler(rejectSellerHandler));
adminRouter.post('/sellers/:id/suspend', asyncHandler(suspendSellerHandler));

// Nouvelle tentative de versement apres un echec (sequestre, etape 7).
adminRouter.post('/payouts/:id/retry', asyncHandler(retryPayoutHandler));

// Litiges (etape 9) : suivi et decision.
adminRouter.get('/disputes', asyncHandler(listDisputesHandler));
adminRouter.get('/disputes/:id', asyncHandler(getDisputeHandler));
adminRouter.post('/disputes/:id/resolve', asyncHandler(resolveDisputeHandler));
