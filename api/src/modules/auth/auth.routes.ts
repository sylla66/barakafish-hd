import { Router } from 'express';

import { asyncHandler } from '../../lib/asyncHandler';
import { requestOtpHandler, verifyOtpHandler } from './auth.controller';

export const authRouter = Router();

authRouter.post('/request-otp', asyncHandler(requestOtpHandler));
authRouter.post('/verify-otp', asyncHandler(verifyOtpHandler));
