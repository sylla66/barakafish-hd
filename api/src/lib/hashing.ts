import bcrypt from 'bcryptjs';

// bcryptjs (implementation pure JS de bcrypt) : evite la compilation native de
// `bcrypt` sous Windows tout en produisant des hachages compatibles.
const SALT_ROUNDS = 10;

export function hashSecret(value: string): Promise<string> {
  return bcrypt.hash(value, SALT_ROUNDS);
}

export function compareSecret(value: string, hash: string): Promise<boolean> {
  return bcrypt.compare(value, hash);
}
