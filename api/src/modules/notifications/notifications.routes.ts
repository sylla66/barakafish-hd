import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';
import { updateMyPreferencesHandler } from './notifications.controller';

const router = Router();

router.patch('/me', requireAuth, asyncHandler(updateMyPreferencesHandler));

export default router;
