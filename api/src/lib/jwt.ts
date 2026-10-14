import jwt, { type JwtPayload as JsonWebTokenPayload, type SignOptions } from 'jsonwebtoken';

import { env } from '../config/env';

export interface AuthTokenPayload {
  sub: string;
  phone: string;
}

// Duree de vie du jeton pilotee par JWT_EXPIRES_IN (defaut 7 jours).
export function signToken(payload: AuthTokenPayload): string {
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyToken(token: string): AuthTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);

  if (typeof decoded === 'string' || !decoded.sub) {
    throw new Error('Jeton invalide : sujet manquant.');
  }

  const payload = decoded as JsonWebTokenPayload;
  return { sub: String(payload.sub), phone: typeof payload.phone === 'string' ? payload.phone : '' };
}
