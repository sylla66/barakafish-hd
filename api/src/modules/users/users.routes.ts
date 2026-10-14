import { Router } from 'express';

import { asyncHandler } from '../../lib/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { getMeHandler, patchMeHandler } from './users.controller';

// Toutes les routes /me exigent un jeton valide.
export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get('/', getMeHandler);
usersRouter.patch('/', asyncHandler(patchMeHandler));
