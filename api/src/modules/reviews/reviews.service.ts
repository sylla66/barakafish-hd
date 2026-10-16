import type { AuthUser } from '../users/users.types';
import { pool } from '../../db/pool';
import { AppError } from '../../lib/AppError';
import { processImage } from '../../lib/image';
import { getStorageProvider } from '../../providers/storage';
import {
  reviewCursorSchema,
  type CreateReviewInput,
  type ListReviewsQuery,
  type ReviewCursor,
} from './reviews.schema';
import type { Review, ReviewListResult } from './reviews.types';

// Un avis ne peut etre laisse que lorsque l'acheteur a confirme la reception
// (ou que les fonds sont deja liberes).
const REVIEWABLE_STATUSES = new Set(['confirmed', 'released']);

interface ReviewRow {
  id: string;
  order_id: string;
  buyer_id: string;
  buyer_name: string;
  seller_id: string;
  listing_title: string;
  rating: number;
  comment: string | null;
  photo_url: string | null;
  created_at: Date;
}

interface OrderCheckRow {
  id: string;
  buyer_id: string;
  seller_id: string;
  status: string;
}

const REVIEW_SELECT = `
  SELECT r.id, r.order_id, r.buyer_id, u.full_name AS buyer_name, r.seller_id,
         l.title AS listing_title, r.rating, r.comment, r.photo_url, r.created_at
    FROM reviews r
    JOIN users u ON u.id = r.buyer_id
    JOIN orders o ON o.id = r.order_id
    JOIN listings l ON l.id = o.listing_id`;

function toReview(row: ReviewRow): Review {
  return {
    id: row.id,
    orderId: row.order_id,
    buyerId: row.buyer_id,
    buyerName: row.buyer_name,
    sellerId: row.seller_id,
    listingTitle: row.listing_title,
    rating: row.rating,
    comment: row.comment,
    photoUrl: row.photo_url ? `/reviews/${row.id}/photo` : null,
    createdAt: row.created_at.toISOString(),
  };
}

function encodeCursor(cursor: ReviewCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): ReviewCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return reviewCursorSchema.parse(parsed);
  } catch {
    throw AppError.badRequest('Curseur de pagination invalide.');
  }
}

async function loadReview(reviewId: string): Promise<Review> {
  const result = await pool.query<ReviewRow>(`${REVIEW_SELECT} WHERE r.id = $1`, [reviewId]);
  if (!result.rows[0]) {
    throw AppError.notFound('Avis introuvable.');
  }
  return toReview(result.rows[0]);
}

async function saveReviewPhoto(orderId: string, file: Express.Multer.File): Promise<string> {
  let processed: Buffer;
  try {
    processed = await processImage(file.buffer);
  } catch {
    throw AppError.badRequest("La photo de l'avis est illisible (image invalide).");
  }
  const { key } = await getStorageProvider().saveFile({
    buffer: processed,
    originalName: file.originalname,
    mimeType: 'image/jpeg',
    category: `reviews/${orderId}`,
  });
  return key;
}

// Cree un avis pour une commande de l'acheteur connecte, puis recalcule la note
// moyenne du vendeur dans la meme transaction. Un seul avis par commande
// (contrainte UNIQUE sur reviews.order_id).
export async function createReview(
  user: AuthUser,
  orderId: string,
  input: CreateReviewInput,
  file?: Express.Multer.File,
): Promise<Review> {
  const orderResult = await pool.query<OrderCheckRow>(
    'SELECT id, buyer_id, seller_id, status FROM orders WHERE id = $1',
    [orderId],
  );
  const order = orderResult.rows[0];
  if (!order) {
    throw AppError.notFound('Commande introuvable.');
  }
  if (order.buyer_id !== user.id) {
    throw AppError.forbidden('Vous ne pouvez noter que vos propres commandes.');
  }
  if (!REVIEWABLE_STATUSES.has(order.status)) {
    throw AppError.conflict('Vous pourrez laisser un avis une fois la reception confirmee.');
  }

  const existing = await pool.query('SELECT 1 FROM reviews WHERE order_id = $1', [orderId]);
  if ((existing.rowCount ?? 0) > 0) {
    throw AppError.conflict('Un avis a deja ete laisse pour cette commande.');
  }

  const comment = input.comment && input.comment.length > 0 ? input.comment : null;
  const photoKey = file ? await saveReviewPhoto(orderId, file) : null;

  const client = await pool.connect();
  let reviewId: string;
  try {
    await client.query('BEGIN');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO reviews (order_id, buyer_id, seller_id, rating, comment, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [orderId, user.id, order.seller_id, input.rating, comment, photoKey],
    );
    reviewId = inserted.rows[0].id;

    // Recalcul de la note du vendeur a partir de tous ses avis (regle : la note
    // reste coherente meme apres plusieurs commandes).
    await client.query(
      `UPDATE seller_profiles sp
          SET rating_avg = COALESCE(sub.avg, 0),
              rating_count = COALESCE(sub.cnt, 0)
         FROM (
           SELECT ROUND(AVG(rating)::numeric, 2) AS avg, COUNT(*)::int AS cnt
             FROM reviews WHERE seller_id = $1
         ) sub
        WHERE sp.user_id = $1`,
      [order.seller_id],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    // 23505 = violation de la contrainte UNIQUE(order_id) : avis deja depose.
    if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505') {
      throw AppError.conflict('Un avis a deja ete laisse pour cette commande.');
    }
    throw error;
  } finally {
    client.release();
  }

  return loadReview(reviewId);
}

// Liste paginee (curseur keyset) des avis d'un vendeur, du plus recent au plus
// ancien. Lecture publique (fiche vendeur).
export async function listSellerReviews(
  sellerId: string,
  query: ListReviewsQuery,
): Promise<ReviewListResult> {
  const seller = await pool.query('SELECT 1 FROM seller_profiles WHERE user_id = $1', [sellerId]);
  if (seller.rowCount === 0) {
    throw AppError.notFound('Profil vendeur introuvable.');
  }

  const params: unknown[] = [sellerId];
  const conditions: string[] = ['r.seller_id = $1'];

  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    params.push(cursor.v, cursor.id);
    conditions.push(
      `(r.created_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
    );
  }

  params.push(query.limit + 1);
  const limitPlaceholder = `$${params.length}`;

  const result = await pool.query<ReviewRow>(
    `${REVIEW_SELECT}
      WHERE ${conditions.join(' AND ')}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${limitPlaceholder}`,
    params,
  );

  const hasMore = result.rows.length > query.limit;
  const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;

  let nextCursor: string | null = null;
  if (hasMore && rows.length > 0) {
    const last = rows[rows.length - 1];
    nextCursor = encodeCursor({ v: last.created_at.toISOString(), id: last.id });
  }

  return { reviews: rows.map(toReview), nextCursor };
}

// Cle de stockage de la photo d'un avis, pour la route publique de service.
export async function getReviewPhotoKey(reviewId: string): Promise<string | null> {
  const result = await pool.query<{ photo_url: string | null }>(
    'SELECT photo_url FROM reviews WHERE id = $1',
    [reviewId],
  );
  return result.rows[0]?.photo_url ?? null;
}
