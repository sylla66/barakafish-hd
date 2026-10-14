import { randomInt } from 'node:crypto';

import { pool } from '../../db/pool';
import { AppError } from '../../lib/AppError';
import { compareSecret, hashSecret } from '../../lib/hashing';
import { signToken } from '../../lib/jwt';
import { getOtpProvider } from '../../providers/otp';
import { createUser, findUserByPhone } from '../users/users.service';
import type { AuthUser } from '../users/users.types';
import type { VerifyOtpInput } from './auth.schema';

export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_REQUESTS_PER_HOUR = 3;

interface OtpRow {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: Date;
}

function generateOtpCode(): string {
  // 6 chiffres, y compris les codes commencant par 0 (ex. 004521).
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export interface RequestOtpResult {
  expiresInMinutes: number;
}

// Demande d'un code : verification de la limite de debit (3/heure/numero) puis
// generation, stockage du hash et envoi via le fournisseur configure.
export async function requestOtp(phone: string): Promise<RequestOtpResult> {
  const countResult = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM otp_codes
      WHERE phone = $1 AND created_at > now() - interval '1 hour'`,
    [phone],
  );

  if ((countResult.rows[0]?.count ?? 0) >= OTP_MAX_REQUESTS_PER_HOUR) {
    throw new AppError(
      429,
      'Trop de demandes de code. Vous pourrez en demander un nouveau dans une heure.',
      'trop_de_demandes',
    );
  }

  const code = generateOtpCode();
  const codeHash = await hashSecret(code);

  await pool.query(
    `INSERT INTO otp_codes (phone, code_hash, expires_at)
     VALUES ($1, $2, now() + interval '${OTP_TTL_MINUTES} minutes')`,
    [phone, codeHash],
  );

  await getOtpProvider().sendOtp(phone, code);

  return { expiresInMinutes: OTP_TTL_MINUTES };
}

export interface VerifyOtpResult {
  token: string;
  user: AuthUser;
}

// Verification d'un code : usage unique, expiration a 5 minutes, blocage apres
// 5 tentatives erronees. Cree l'utilisateur a la premiere connexion.
export async function verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResult> {
  const { phone, code, full_name: fullName } = input;

  const result = await pool.query<OtpRow>(
    `SELECT id, code_hash, attempts, expires_at
       FROM otp_codes
      WHERE phone = $1 AND used_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [phone],
  );

  const otp = result.rows[0];

  if (!otp) {
    throw AppError.badRequest('Aucun code valide. Demandez un nouveau code.');
  }

  if (otp.expires_at.getTime() < Date.now()) {
    throw AppError.badRequest('Ce code a expire. Demandez un nouveau code.');
  }

  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    throw new AppError(429, 'Trop de tentatives. Demandez un nouveau code.', 'trop_de_tentatives');
  }

  const matches = await compareSecret(code, otp.code_hash);

  if (!matches) {
    await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
    throw AppError.badRequest('Code incorrect.');
  }

  await pool.query('UPDATE otp_codes SET used_at = now() WHERE id = $1', [otp.id]);

  const user = await findOrCreateUser(phone, fullName);
  const token = signToken({ sub: user.id, phone: user.phone });

  return { token, user };
}

async function findOrCreateUser(phone: string, fullName?: string): Promise<AuthUser> {
  const existing = await findUserByPhone(phone);
  if (existing) {
    return existing;
  }

  if (!fullName) {
    throw AppError.badRequest('Le nom complet est obligatoire pour une premiere inscription.', [
      { champ: 'full_name', message: 'Champ obligatoire pour une premiere inscription.' },
    ]);
  }

  return createUser({ phone, fullName });
}
