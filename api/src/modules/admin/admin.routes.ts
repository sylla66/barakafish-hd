import { Router } from 'express';

import { asyncHandler } from '../../lib/asyncHandler';
import { requireAuth, requireRole } from '../../middleware/auth';
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
