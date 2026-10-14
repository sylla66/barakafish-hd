import { pool } from '../../db/pool';
import { AppError } from '../../lib/AppError';
import type { AuthUser } from './users.types';

interface UserRow {
  id: string;
  phone: string;
  full_name: string;
  email: string | null;
  is_buyer: boolean;
  is_seller: boolean;
  is_admin: boolean;
  is_business: boolean;
  business_name: string | null;
  city: string | null;
}

const USER_COLUMNS = `id, phone, full_name, email,
  is_buyer, is_seller, is_admin, is_business, business_name, city`;

function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    phone: row.phone,
    fullName: row.full_name,
    email: row.email,
    isBuyer: row.is_buyer,
    isSeller: row.is_seller,
    isAdmin: row.is_admin,
    isBusiness: row.is_business,
    businessName: row.business_name,
    city: row.city,
  };
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  const result = await pool.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function findUserByPhone(phone: string): Promise<AuthUser | null> {
  const result = await pool.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE phone = $1`, [phone]);
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function createUser(input: { phone: string; fullName: string }): Promise<AuthUser> {
  const result = await pool.query<UserRow>(
    `INSERT INTO users (phone, full_name) VALUES ($1, $2) RETURNING ${USER_COLUMNS}`,
    [input.phone, input.fullName],
  );
  return mapUser(result.rows[0]);
}

export interface UpdateProfileInput {
  fullName?: string;
  email?: string;
  city?: string;
  isBusiness?: boolean;
  businessName?: string;
}

export async function updateUser(id: string, input: UpdateProfileInput): Promise<AuthUser> {
  const assignments: string[] = [];
  const values: unknown[] = [];

  const assign = (column: string, value: unknown): void => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (input.fullName !== undefined) assign('full_name', input.fullName);
  if (input.email !== undefined) assign('email', input.email);
  if (input.city !== undefined) assign('city', input.city);
  if (input.isBusiness !== undefined) assign('is_business', input.isBusiness);
  if (input.businessName !== undefined) assign('business_name', input.businessName);

  if (assignments.length === 0) {
    const existing = await findUserById(id);
    if (!existing) throw AppError.notFound('Utilisateur introuvable.');
    return existing;
  }

  assignments.push('updated_at = now()');
  values.push(id);

  const result = await pool.query<UserRow>(
    `UPDATE users SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING ${USER_COLUMNS}`,
    values,
  );

  if (!result.rows[0]) throw AppError.notFound('Utilisateur introuvable.');
  return mapUser(result.rows[0]);
}
