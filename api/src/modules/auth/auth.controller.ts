import type { Request, Response } from 'express';

import { requestOtpSchema, verifyOtpSchema } from './auth.schema';
import { requestOtp, verifyOtp } from './auth.service';

export async function requestOtpHandler(req: Request, res: Response): Promise<void> {
  const { phone } = requestOtpSchema.parse(req.body);
  const result = await requestOtp(phone);

  res.status(200).json({
    message: `Un code de verification a ete envoye (valable ${result.expiresInMinutes} minutes).`,
    expires_in_minutes: result.expiresInMinutes,
  });
}

export async function verifyOtpHandler(req: Request, res: Response): Promise<void> {
  const input = verifyOtpSchema.parse(req.body);
  const { token, user } = await verifyOtp(input);

  res.status(200).json({ token, user });
}
