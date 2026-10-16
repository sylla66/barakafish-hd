import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/AppError';
import { pool } from '../../db/pool';
import type { AuthUser } from '../users/users.types';

const updatePrefsSchema = z.object({
  notifications_enabled: z.boolean().optional(),
  email_notifications: z.boolean().optional(),
});

export async function updateMyPreferencesHandler(req: Request, res: Response): Promise<void> {
  const user = req.user as AuthUser | undefined;
  if (!user) throw AppError.unauthorized();
  const input = updatePrefsSchema.parse(req.body);
  await pool.query(
    `UPDATE users SET preferences = COALESCE(preferences, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
    [JSON.stringify(input), user.id],
  );
  res.status(200).json({ ok: true });
}
