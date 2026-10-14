import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '../lib/AppError';
import { verifyToken } from '../lib/jwt';
import { findUserById } from '../modules/users/users.service';
import { hasRole, type AuthUser, type Role } from '../modules/users/users.types';

async function authenticate(req: Request): Promise<AuthUser> {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    throw AppError.unauthorized();
  }

  const token = header.slice('Bearer '.length).trim();

  let subject: string;
  try {
    subject = verifyToken(token).sub;
  } catch {
    throw AppError.unauthorized('Session invalide ou expiree.');
  }

  const user = await findUserById(subject);
  if (!user) {
    throw AppError.unauthorized('Session invalide ou expiree.');
  }

  return user;
}

// Verifie le jeton Bearer puis recharge l'utilisateur depuis la base (l'etat des
// roles peut avoir change depuis l'emission du jeton).
export const requireAuth: RequestHandler = (req, _res, next) => {
  authenticate(req)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(next);
};

// Restreint l'acces aux utilisateurs possedant au moins un des roles demandes.
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      next(AppError.unauthorized());
      return;
    }

    if (!roles.some((role) => hasRole(user, role))) {
      next(AppError.forbidden("Vous n'avez pas les droits necessaires pour cette action."));
      return;
    }

    next();
  };
}
