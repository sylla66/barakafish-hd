import type { Request, Response } from 'express';

import { AppError } from '../../lib/AppError';
import { updateMeSchema } from './users.schema';
import { updateUser } from './users.service';

// GET /me : renvoie le profil de l'utilisateur authentifie (place sur req.user
// par le middleware requireAuth).
export function getMeHandler(req: Request, res: Response): void {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  res.status(200).json({ user: req.user });
}

// PATCH /me : met a jour les champs de profil autorises.
export async function patchMeHandler(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  const input = updateMeSchema.parse(req.body);

  const user = await updateUser(req.user.id, {
    fullName: input.full_name,
    email: input.email,
    city: input.city,
    isBusiness: input.is_business,
    businessName: input.business_name,
  });

  res.status(200).json({ user });
}
