import { pool } from '../../db/pool';
import { AppError } from '../../lib/AppError';
import { getStorageProvider } from '../../providers/storage';
import type { CreateSellerProfileInput, UpdateSellerProfileInput } from './sellers.schema';
import type {
  AdminSellerListItem,
  PublicSellerProfile,
  SellerDocumentType,
  SellerOwnProfile,
  SellerStatus,
} from './sellers.types';

interface SellerRow {
  user_id: string;
  shop_name: string;
  description: string | null;
  zone: string;
  address: string | null;
  status: SellerStatus;
  rating_avg: string;
  rating_count: number;
  id_document_url: string | null;
  sanitary_doc_url: string | null;
  facility_photo_url: string | null;
  business_document_url: string | null;
  rejection_reason: string | null;
  verified_at: Date | null;
}

interface AdminSellerRow extends SellerRow {
  full_name: string;
  phone: string;
  created_at: Date;
}

const SELLER_COLUMNS = `user_id, shop_name, description, zone, address, status,
  rating_avg, rating_count, id_document_url, sanitary_doc_url, facility_photo_url,
  business_document_url, rejection_reason, verified_at`;

function toOwnProfile(row: SellerRow): SellerOwnProfile {
  return {
    userId: row.user_id,
    shopName: row.shop_name,
    description: row.description,
    zone: row.zone,
    address: row.address,
    status: row.status,
    isVerified: row.status === 'verified',
    ratingAvg: Number(row.rating_avg),
    ratingCount: row.rating_count,
    hasIdentityDocument: row.id_document_url !== null,
    hasSanitaryDocument: row.sanitary_doc_url !== null,
    hasFacilityPhoto: row.facility_photo_url !== null,
    hasBusinessDocument: row.business_document_url !== null,
    rejectionReason: row.rejection_reason,
    verifiedAt: row.verified_at ? row.verified_at.toISOString() : null,
  };
}

function toPublicProfile(row: SellerRow): PublicSellerProfile {
  return {
    userId: row.user_id,
    shopName: row.shop_name,
    description: row.description,
    zone: row.zone,
    status: row.status,
    isVerified: row.status === 'verified',
    ratingAvg: Number(row.rating_avg),
    ratingCount: row.rating_count,
  };
}

async function findSellerRow(userId: string): Promise<SellerRow | null> {
  const result = await pool.query<SellerRow>(
    `SELECT ${SELLER_COLUMNS} FROM seller_profiles WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function createProfile(
  userId: string,
  input: CreateSellerProfileInput,
): Promise<SellerOwnProfile> {
  const existing = await findSellerRow(userId);
  if (existing) {
    throw AppError.conflict('Un profil vendeur existe deja pour ce compte.');
  }

  // Creation du profil et promotion du role dans une meme transaction : on ne
  // veut jamais un is_seller=TRUE sans profil, ni l'inverse.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO seller_profiles (user_id, shop_name, description, zone, address)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, input.shop_name, input.description ?? null, input.zone, input.address ?? null],
    );
    await client.query('UPDATE users SET is_seller = TRUE, updated_at = now() WHERE id = $1', [
      userId,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const row = await findSellerRow(userId);
  if (!row) {
    throw new AppError(500, 'Profil vendeur introuvable apres creation.', 'erreur_interne');
  }
  return toOwnProfile(row);
}

export async function updateProfile(
  userId: string,
  input: UpdateSellerProfileInput,
): Promise<SellerOwnProfile> {
  const assignments: string[] = [];
  const values: unknown[] = [];

  const assign = (column: string, value: unknown): void => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (input.shop_name !== undefined) assign('shop_name', input.shop_name);
  if (input.description !== undefined) assign('description', input.description);
  if (input.zone !== undefined) assign('zone', input.zone);
  if (input.address !== undefined) assign('address', input.address);

  if (assignments.length === 0) {
    return getOwnProfile(userId);
  }

  values.push(userId);
  const result = await pool.query<SellerRow>(
    `UPDATE seller_profiles SET ${assignments.join(', ')} WHERE user_id = $${values.length}
     RETURNING ${SELLER_COLUMNS}`,
    values,
  );

  if (!result.rows[0]) {
    throw AppError.notFound('Profil vendeur introuvable.');
  }
  return toOwnProfile(result.rows[0]);
}

export interface SellerDocumentFiles {
  identity?: Express.Multer.File;
  sanitary?: Express.Multer.File;
  facility?: Express.Multer.File;
  business?: Express.Multer.File;
}

export async function saveDocuments(
  userId: string,
  files: SellerDocumentFiles,
): Promise<SellerOwnProfile> {
  const row = await findSellerRow(userId);
  if (!row) {
    throw AppError.notFound("Profil vendeur introuvable. Creez d'abord votre profil.");
  }

  if (!files.identity) {
    throw AppError.badRequest("La piece d'identite est obligatoire.", [
      { champ: 'identity_document', message: 'Fichier requis.' },
    ]);
  }
  if (!files.facility) {
    throw AppError.badRequest("La photo de l'installation est obligatoire.", [
      { champ: 'facility_photo', message: 'Fichier requis.' },
    ]);
  }
  if (!files.business) {
    throw AppError.badRequest(
      'Le justificatif professionnel (carte de mareyeur ou RCCM) est obligatoire.',
      [{ champ: 'business_document', message: 'Fichier requis.' }],
    );
  }

  const storage = getStorageProvider();
  const category = `sellers/${userId}`;

  const identity = await storage.saveFile({
    buffer: files.identity.buffer,
    originalName: files.identity.originalname,
    mimeType: files.identity.mimetype,
    category,
  });
  const facility = await storage.saveFile({
    buffer: files.facility.buffer,
    originalName: files.facility.originalname,
    mimeType: files.facility.mimetype,
    category,
  });
  const sanitary = files.sanitary
    ? await storage.saveFile({
        buffer: files.sanitary.buffer,
        originalName: files.sanitary.originalname,
        mimeType: files.sanitary.mimetype,
        category,
      })
    : null;
  const business = await storage.saveFile({
    buffer: files.business.buffer,
    originalName: files.business.originalname,
    mimeType: files.business.mimetype,
    category,
  });

  const result = await pool.query<SellerRow>(
    `UPDATE seller_profiles
        SET id_document_url = $2,
            facility_photo_url = $3,
            sanitary_doc_url = COALESCE($4, sanitary_doc_url),
            business_document_url = $5
      WHERE user_id = $1
      RETURNING ${SELLER_COLUMNS}`,
    [userId, identity.key, facility.key, sanitary ? sanitary.key : null, business.key],
  );

  if (!result.rows[0]) {
    throw AppError.notFound('Profil vendeur introuvable.');
  }
  return toOwnProfile(result.rows[0]);
}

export async function getOwnProfile(userId: string): Promise<SellerOwnProfile> {
  const row = await findSellerRow(userId);
  if (!row) {
    throw AppError.notFound('Profil vendeur introuvable.');
  }
  return toOwnProfile(row);
}

export async function getPublicProfile(userId: string): Promise<PublicSellerProfile> {
  const row = await findSellerRow(userId);
  if (!row) {
    throw AppError.notFound('Profil vendeur introuvable.');
  }
  return toPublicProfile(row);
}

export async function listForAdmin(status?: SellerStatus): Promise<AdminSellerListItem[]> {
  const params: unknown[] = [];
  let where = '';
  if (status) {
    params.push(status);
    where = 'WHERE sp.status = $1';
  }

  const result = await pool.query<AdminSellerRow>(
    `SELECT sp.user_id, sp.shop_name, sp.description, sp.zone, sp.address, sp.status,
            sp.rating_avg, sp.rating_count, sp.id_document_url, sp.sanitary_doc_url,
            sp.facility_photo_url, sp.business_document_url, sp.rejection_reason, sp.verified_at,
            sp.created_at, u.full_name, u.phone
       FROM seller_profiles sp
       JOIN users u ON u.id = sp.user_id
       ${where}
      ORDER BY sp.created_at DESC`,
    params,
  );

  return result.rows.map((row) => ({
    ...toOwnProfile(row),
    fullName: row.full_name,
    phone: row.phone,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function verifySeller(userId: string, adminId: string): Promise<SellerOwnProfile> {
  const result = await pool.query<SellerRow>(
    `UPDATE seller_profiles
        SET status = 'verified', verified_by = $2, verified_at = now(), rejection_reason = NULL
      WHERE user_id = $1
      RETURNING ${SELLER_COLUMNS}`,
    [userId, adminId],
  );
  if (!result.rows[0]) {
    throw AppError.notFound('Profil vendeur introuvable.');
  }
  return toOwnProfile(result.rows[0]);
}

export async function rejectSeller(
  userId: string,
  adminId: string,
  reason: string,
): Promise<SellerOwnProfile> {
  const result = await pool.query<SellerRow>(
    `UPDATE seller_profiles
        SET status = 'rejected', verified_by = $2, rejection_reason = $3
      WHERE user_id = $1
      RETURNING ${SELLER_COLUMNS}`,
    [userId, adminId, reason],
  );
  if (!result.rows[0]) {
    throw AppError.notFound('Profil vendeur introuvable.');
  }
  return toOwnProfile(result.rows[0]);
}

export async function suspendSeller(userId: string): Promise<SellerOwnProfile> {
  const result = await pool.query<SellerRow>(
    `UPDATE seller_profiles SET status = 'suspended' WHERE user_id = $1
     RETURNING ${SELLER_COLUMNS}`,
    [userId],
  );
  if (!result.rows[0]) {
    throw AppError.notFound('Profil vendeur introuvable.');
  }
  return toOwnProfile(result.rows[0]);
}

// Regle metier reutilisable par le module annonces : seul un vendeur verifie peut
// publier une annonce active (un statut pending/suspended/rejected est refuse).
export async function assertSellerCanPublish(userId: string): Promise<void> {
  const row = await findSellerRow(userId);
  if (!row) {
    throw AppError.forbidden('Vous devez creer un profil vendeur avant de publier une annonce.');
  }
  if (row.status !== 'verified') {
    throw AppError.forbidden('Votre compte vendeur doit etre verifie pour publier une annonce.');
  }
}

export async function getSellerDocumentKey(
  userId: string,
  type: SellerDocumentType,
): Promise<string | null> {
  const row = await findSellerRow(userId);
  if (!row) {
    throw AppError.notFound('Profil vendeur introuvable.');
  }
  switch (type) {
    case 'identity':
      return row.id_document_url;
    case 'sanitary':
      return row.sanitary_doc_url;
    case 'facility':
      return row.facility_photo_url;
    case 'business':
      return row.business_document_url;
  }
}
