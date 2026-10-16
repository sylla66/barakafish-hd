import { pool } from '../../db/pool';
import { env } from '../../config/env';
import { AppError } from '../../lib/AppError';
import { processImage } from '../../lib/image';
import { getStorageProvider } from '../../providers/storage';
import { getOrder, transitionOrder } from '../orders/orders.service';
import type { Order, OrderHistoryEntry, TransitionActor } from '../orders/orders.types';
import { refundOrderPartially } from '../payments/payments.service';
import { suspendSeller } from '../sellers/sellers.service';
import type { AuthUser } from '../users/users.types';
import type { AddEvidenceInput, CreateDisputeInput, ListDisputesQuery, ResolveDisputeInput } from './disputes.schema';
import type {
  AdminDisputeDetail,
  AdminDisputeListItem,
  Dispute,
  DisputeEvidence,
  DisputeReason,
  DisputeStatus,
  SellerDisputeHistory,
  SellerDisputeHistoryEntry,
} from './disputes.types';

// Un litige ne peut etre ouvert que sur une commande expediee ou livree (etape 9).
const OPENABLE_FROM = new Set(['shipped', 'delivered']);

// Statuts pour lesquels une partie peut encore ajouter des preuves.
const EVIDENCE_OPEN_STATUSES = new Set<DisputeStatus>(['open', 'under_review']);

// Un litige est « fonde » quand la resolution favorise l'acheteur : il compte
// dans le compteur de suspension du vendeur.
const FOUNDED_STATUSES: DisputeStatus[] = ['resolved_refund', 'resolved_partial'];

interface OrderCheckRow {
  id: string;
  buyer_id: string;
  seller_id: string;
  status: string;
  auto_release_at: Date | null;
  total_amount: number;
}

interface DisputeRow {
  id: string;
  order_id: string;
  opened_by: string;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  refund_amount: number | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
}

interface DisputeWithOrderRow extends DisputeRow {
  buyer_id: string;
  seller_id: string;
  order_status: string;
}

interface EvidenceRow {
  id: string;
  dispute_id: string;
  author_id: string;
  author_name: string;
  author_role: 'buyer' | 'seller';
  photo_url: string | null;
  message: string | null;
  created_at: Date;
}

interface DisputeListRow {
  id: string;
  order_id: string;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  refund_amount: number | null;
  created_at: Date;
  resolved_at: Date | null;
  buyer_id: string;
  buyer_name: string;
  seller_id: string;
  seller_shop_name: string;
  order_status: string;
  order_total_amount: number;
}

const DISPUTE_COLUMNS = `d.id, d.order_id, d.opened_by, d.reason, d.description, d.status,
  d.refund_amount, d.resolution_note, d.resolved_by, d.resolved_at, d.created_at`;

const EVIDENCE_SELECT = `
  SELECT e.id, e.dispute_id, e.author_id, u.full_name AS author_name,
         CASE WHEN e.author_id = o.buyer_id THEN 'buyer' ELSE 'seller' END AS author_role,
         e.photo_url, e.message, e.created_at
    FROM dispute_evidence e
    JOIN users u ON u.id = e.author_id
    JOIN disputes d ON d.id = e.dispute_id
    JOIN orders o ON o.id = d.order_id`;

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toEvidence(row: EvidenceRow): DisputeEvidence {
  return {
    id: row.id,
    disputeId: row.dispute_id,
    authorId: row.author_id,
    authorName: row.author_name,
    authorRole: row.author_role,
    photoUrl: row.photo_url ? `/disputes/evidence/${row.id}/photo` : null,
    message: row.message,
    createdAt: row.created_at.toISOString(),
  };
}

function toDispute(row: DisputeRow, evidence: DisputeEvidence[]): Dispute {
  return {
    id: row.id,
    orderId: row.order_id,
    openedBy: row.opened_by,
    reason: row.reason,
    description: row.description,
    status: row.status,
    refundAmount: row.refund_amount,
    resolutionNote: row.resolution_note,
    resolvedBy: row.resolved_by,
    resolvedAt: isoOrNull(row.resolved_at),
    createdAt: row.created_at.toISOString(),
    evidence,
  };
}

function actorFromUser(user: AuthUser): TransitionActor {
  return {
    kind: 'user',
    id: user.id,
    isAdmin: user.isAdmin,
    isSeller: user.isSeller,
    isBuyer: user.isBuyer,
  };
}

async function loadEvidence(disputeId: string): Promise<DisputeEvidence[]> {
  const result = await pool.query<EvidenceRow>(
    `${EVIDENCE_SELECT} WHERE e.dispute_id = $1 ORDER BY e.created_at ASC, e.id ASC`,
    [disputeId],
  );
  return result.rows.map(toEvidence);
}

async function loadDispute(disputeId: string): Promise<Dispute> {
  const result = await pool.query<DisputeRow>(
    `SELECT ${DISPUTE_COLUMNS} FROM disputes d WHERE d.id = $1`,
    [disputeId],
  );
  const row = result.rows[0];
  if (!row) {
    throw AppError.notFound('Litige introuvable.');
  }
  return toDispute(row, await loadEvidence(disputeId));
}

async function findOrderCheck(orderId: string): Promise<OrderCheckRow | null> {
  const result = await pool.query<OrderCheckRow>(
    'SELECT id, buyer_id, seller_id, status, auto_release_at, total_amount FROM orders WHERE id = $1',
    [orderId],
  );
  return result.rows[0] ?? null;
}

async function findDisputeWithOrder(disputeId: string): Promise<DisputeWithOrderRow | null> {
  const result = await pool.query<DisputeWithOrderRow>(
    `SELECT ${DISPUTE_COLUMNS}, o.buyer_id, o.seller_id, o.status AS order_status
       FROM disputes d
       JOIN orders o ON o.id = d.order_id
      WHERE d.id = $1`,
    [disputeId],
  );
  return result.rows[0] ?? null;
}

async function savePhoto(category: string, file: Express.Multer.File, label: string): Promise<string> {
  let processed: Buffer;
  try {
    processed = await processImage(file.buffer);
  } catch {
    throw AppError.badRequest(`${label} est illisible (image invalide).`);
  }
  const { key } = await getStorageProvider().saveFile({
    buffer: processed,
    originalName: file.originalname,
    mimeType: 'image/jpeg',
    category,
  });
  return key;
}

// ===== Ouverture d'un litige (POST /orders/:id/dispute) =====

export async function openDispute(
  user: AuthUser,
  orderId: string,
  input: CreateDisputeInput,
  file?: Express.Multer.File,
): Promise<Dispute> {
  const order = await findOrderCheck(orderId);
  if (!order) {
    throw AppError.notFound('Commande introuvable.');
  }
  if (order.buyer_id !== user.id) {
    throw AppError.forbidden("Seul l'acheteur peut ouvrir un litige sur cette commande.");
  }
  if (!OPENABLE_FROM.has(order.status)) {
    throw AppError.conflict("Un litige ne peut etre ouvert qu'apres l'expedition de la commande.");
  }
  // Delai de 48 h apres livraison : passe auto_release_at, la liberation est
  // automatique et le litige n'est plus possible.
  if (order.auto_release_at !== null && order.auto_release_at.getTime() <= Date.now()) {
    throw AppError.badRequest('Le delai de litige de 48 heures est depasse.');
  }
  if (!file) {
    throw AppError.badRequest('Au moins une photo est obligatoire pour ouvrir un litige.', [
      { champ: 'photo', message: 'Fichier requis.' },
    ]);
  }

  const photoKey = await savePhoto(`disputes/${orderId}`, file, 'La photo du litige');

  const client = await pool.connect();
  let disputeId: string;
  try {
    await client.query('BEGIN');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO disputes (order_id, opened_by, reason, description, status)
       VALUES ($1, $2, $3, $4, 'open')
       RETURNING id`,
      [orderId, user.id, input.reason, input.description],
    );
    disputeId = inserted.rows[0].id;

    // La photo initiale est enregistree comme premiere preuve du litige.
    await client.query(
      `INSERT INTO dispute_evidence (dispute_id, author_id, photo_url, message)
       VALUES ($1, $2, $3, $4)`,
      [disputeId, user.id, photoKey, input.description],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // La transition suspend la liberation automatique (la commande n'est plus
  // « delivered » pour le planificateur). En cas d'echec, on retire le litige
  // pour ne pas laisser une trace sans changement d'etat.
  try {
    await transitionOrder(orderId, 'disputed', actorFromUser(user), "Litige ouvert par l'acheteur.");
  } catch (error) {
    await pool.query('DELETE FROM disputes WHERE id = $1', [disputeId]);
    throw error;
  }

  return loadDispute(disputeId);
}

// Litige en cours d'une commande, pour l'ecran de suivi (acheteur, vendeur, admin).
export async function getOrderDispute(user: AuthUser, orderId: string): Promise<Dispute> {
  const order = await findOrderCheck(orderId);
  if (!order) {
    throw AppError.notFound('Commande introuvable.');
  }
  if (!user.isAdmin && order.buyer_id !== user.id && order.seller_id !== user.id) {
    // 404 pour ne pas reveler l'existence d'une commande d'autrui.
    throw AppError.notFound('Commande introuvable.');
  }

  const result = await pool.query<{ id: string }>(
    'SELECT id FROM disputes WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
    [orderId],
  );
  if (!result.rows[0]) {
    throw AppError.notFound('Aucun litige pour cette commande.');
  }
  return loadDispute(result.rows[0].id);
}

// ===== Ajout de preuves (POST /disputes/:id/evidence) =====

export async function addEvidence(
  user: AuthUser,
  disputeId: string,
  input: AddEvidenceInput,
  file?: Express.Multer.File,
): Promise<DisputeEvidence> {
  const dispute = await findDisputeWithOrder(disputeId);
  if (!dispute) {
    throw AppError.notFound('Litige introuvable.');
  }
  if (user.id !== dispute.buyer_id && user.id !== dispute.seller_id) {
    throw AppError.forbidden('Seules les parties du litige peuvent ajouter des preuves.');
  }
  if (!EVIDENCE_OPEN_STATUSES.has(dispute.status)) {
    throw AppError.conflict('Ce litige est deja resolu.');
  }

  const message = input.message && input.message.length > 0 ? input.message : null;
  if (!message && !file) {
    throw AppError.badRequest('Ajoutez un message ou une photo.', [
      { champ: 'message', message: 'Message ou photo requis.' },
    ]);
  }

  const photoKey = file ? await savePhoto(`disputes/${disputeId}`, file, 'La preuve') : null;

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO dispute_evidence (dispute_id, author_id, photo_url, message)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [disputeId, user.id, photoKey, message],
  );

  const result = await pool.query<EvidenceRow>(`${EVIDENCE_SELECT} WHERE e.id = $1`, [inserted.rows[0].id]);
  return toEvidence(result.rows[0]);
}

// Cle de stockage d'une preuve photo, pour la route de service protegee.
export async function getEvidencePhotoKey(
  user: AuthUser,
  evidenceId: string,
): Promise<string | null> {
  const result = await pool.query<{ photo_url: string | null; buyer_id: string; seller_id: string }>(
    `SELECT e.photo_url, o.buyer_id, o.seller_id
       FROM dispute_evidence e
       JOIN disputes d ON d.id = e.dispute_id
       JOIN orders o ON o.id = d.order_id
      WHERE e.id = $1`,
    [evidenceId],
  );
  const row = result.rows[0];
  if (!row) {
    throw AppError.notFound('Preuve introuvable.');
  }
  if (!user.isAdmin && user.id !== row.buyer_id && user.id !== row.seller_id) {
    throw AppError.forbidden('Acces refuse a cette preuve.');
  }
  return row.photo_url;
}

// ===== Back-office admin =====

export async function listForAdmin(query: ListDisputesQuery): Promise<AdminDisputeListItem[]> {
  const params: unknown[] = [];
  let where = '';
  if (query.status) {
    params.push(query.status);
    where = 'WHERE d.status = $1';
  }

  const result = await pool.query<DisputeListRow>(
    `SELECT d.id, d.order_id, d.reason, d.description, d.status, d.refund_amount,
            d.created_at, d.resolved_at, o.buyer_id, bu.full_name AS buyer_name,
            o.seller_id, sp.shop_name AS seller_shop_name, o.status AS order_status,
            o.total_amount AS order_total_amount
       FROM disputes d
       JOIN orders o ON o.id = d.order_id
       JOIN users bu ON bu.id = o.buyer_id
       JOIN seller_profiles sp ON sp.user_id = o.seller_id
       ${where}
      ORDER BY d.created_at DESC`,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    reason: row.reason,
    description: row.description,
    status: row.status,
    refundAmount: row.refund_amount,
    createdAt: row.created_at.toISOString(),
    resolvedAt: isoOrNull(row.resolved_at),
    buyerId: row.buyer_id,
    buyerName: row.buyer_name,
    sellerId: row.seller_id,
    sellerShopName: row.seller_shop_name,
    orderStatus: row.order_status as Order['status'],
    orderTotalAmount: row.order_total_amount,
  }));
}

async function loadSellerHistory(sellerId: string): Promise<SellerDisputeHistory> {
  const profile = await pool.query<{ shop_name: string; rating_avg: string; rating_count: number }>(
    'SELECT shop_name, rating_avg, rating_count FROM seller_profiles WHERE user_id = $1',
    [sellerId],
  );
  const profileRow = profile.rows[0];

  const counts = await pool.query<{ total: string; in_window: string }>(
    `SELECT
        count(*) FILTER (WHERE d.status = ANY($2::dispute_status[]))::text AS total,
        count(*) FILTER (
          WHERE d.status = ANY($2::dispute_status[])
            AND d.resolved_at >= now() - make_interval(days => $3)
        )::text AS in_window
       FROM disputes d
       JOIN orders o ON o.id = d.order_id
      WHERE o.seller_id = $1`,
    [sellerId, FOUNDED_STATUSES, env.DISPUTE_SUSPEND_WINDOW_DAYS],
  );

  const recent = await pool.query<{
    id: string;
    order_id: string;
    reason: DisputeReason;
    status: DisputeStatus;
    created_at: Date;
    resolved_at: Date | null;
  }>(
    `SELECT d.id, d.order_id, d.reason, d.status, d.created_at, d.resolved_at
       FROM disputes d
       JOIN orders o ON o.id = d.order_id
      WHERE o.seller_id = $1
      ORDER BY d.created_at DESC
      LIMIT 10`,
    [sellerId],
  );

  const recentEntries: SellerDisputeHistoryEntry[] = recent.rows.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    resolvedAt: isoOrNull(row.resolved_at),
  }));

  return {
    sellerId,
    shopName: profileRow?.shop_name ?? '',
    ratingAvg: profileRow ? Number(profileRow.rating_avg) : 0,
    ratingCount: profileRow?.rating_count ?? 0,
    foundedTotal: Number(counts.rows[0].total),
    foundedInWindow: Number(counts.rows[0].in_window),
    windowDays: env.DISPUTE_SUSPEND_WINDOW_DAYS,
    recent: recentEntries,
  };
}

export async function getForAdmin(admin: AuthUser, disputeId: string): Promise<AdminDisputeDetail> {
  const dispute = await loadDispute(disputeId);
  const order = await getOrder(admin.id, true, dispute.orderId);

  const historyResult = await pool.query<{
    id: string;
    from_status: OrderHistoryEntry['fromStatus'];
    to_status: OrderHistoryEntry['toStatus'];
    actor_id: string | null;
    note: string | null;
    created_at: Date;
  }>(
    `SELECT id, from_status, to_status, actor_id, note, created_at
       FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC, id ASC`,
    [dispute.orderId],
  );
  const orderHistory: OrderHistoryEntry[] = historyResult.rows.map((row) => ({
    id: row.id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorId: row.actor_id,
    note: row.note,
    createdAt: row.created_at.toISOString(),
  }));

  return { dispute, order, orderHistory, sellerHistory: await loadSellerHistory(order.sellerId) };
}

// Suspension automatique du vendeur au-dela du seuil de litiges fondes.
async function maybeSuspendSeller(sellerId: string): Promise<void> {
  const counts = await pool.query<{ in_window: string }>(
    `SELECT count(*)::text AS in_window
       FROM disputes d
       JOIN orders o ON o.id = d.order_id
      WHERE o.seller_id = $1
        AND d.status = ANY($2::dispute_status[])
        AND d.resolved_at >= now() - make_interval(days => $3)`,
    [sellerId, FOUNDED_STATUSES, env.DISPUTE_SUSPEND_WINDOW_DAYS],
  );
  const foundedInWindow = Number(counts.rows[0].in_window);
  if (foundedInWindow < env.DISPUTE_SUSPEND_THRESHOLD) {
    return;
  }

  const profile = await pool.query<{ status: string }>(
    'SELECT status FROM seller_profiles WHERE user_id = $1',
    [sellerId],
  );
  if (!profile.rows[0] || profile.rows[0].status === 'suspended') {
    return;
  }

  await suspendSeller(sellerId);

  // Notification a l'admin (table notifications, etape 10 branchera l'envoi reel).
  await pool.query(
    `INSERT INTO notifications (user_id, channel, template, payload, sent_at)
     SELECT id, 'push', $1, $2::jsonb, now() FROM users WHERE is_admin = TRUE`,
    [
      'dispute.seller_suspended',
      JSON.stringify({
        seller_id: sellerId,
        founded_disputes: foundedInWindow,
        threshold: env.DISPUTE_SUSPEND_THRESHOLD,
        window_days: env.DISPUTE_SUSPEND_WINDOW_DAYS,
      }),
    ],
  );
}

// ===== Decision admin (POST /admin/disputes/:id/resolve) =====

export async function resolveDispute(
  admin: AuthUser,
  disputeId: string,
  input: ResolveDisputeInput,
): Promise<AdminDisputeDetail> {
  const dispute = await findDisputeWithOrder(disputeId);
  if (!dispute) {
    throw AppError.notFound('Litige introuvable.');
  }
  if (!EVIDENCE_OPEN_STATUSES.has(dispute.status)) {
    throw AppError.conflict('Ce litige a deja ete resolu.');
  }
  if (dispute.order_status !== 'disputed') {
    throw AppError.conflict("La commande n'est plus en litige.");
  }

  const total = Number(
    (await pool.query<{ total_amount: number }>('SELECT total_amount FROM orders WHERE id = $1', [
      dispute.order_id,
    ])).rows[0].total_amount,
  );

  const note = input.note && input.note.length > 0 ? input.note : null;
  let newStatus: DisputeStatus;
  let refundAmount: number | null = null;

  if (input.decision === 'refund') {
    newStatus = 'resolved_refund';
    refundAmount = total;
  } else if (input.decision === 'partial') {
    refundAmount = input.refund_amount ?? 0;
    if (refundAmount <= 0 || refundAmount >= total) {
      throw AppError.badRequest(
        `Le remboursement partiel doit etre compris entre 1 et ${total - 1} FCFA.`,
      );
    }
    newStatus = 'resolved_partial';
  } else {
    newStatus = 'resolved_release';
    refundAmount = null;
  }

  const actor = actorFromUser(admin);

  // La ligne de litige est ecrite avant d'appliquer les effets financiers :
  // refundBuyer (via « refunded ») lit disputes.refund_amount, et le
  // remboursement partiel explicite precede la liberation du reste au vendeur.
  await pool.query(
    `UPDATE disputes
        SET status = $2, refund_amount = $3, resolution_note = $4, resolved_by = $5, resolved_at = now()
      WHERE id = $1`,
    [disputeId, newStatus, refundAmount, note, admin.id],
  );

  try {
    if (input.decision === 'refund') {
      await transitionOrder(dispute.order_id, 'refunded', actor, note ?? 'Remboursement total du litige.');
    } else if (input.decision === 'partial') {
      // Rembourse une part, puis libere le reste au vendeur (releaseFunds deduit
      // le montant deja rembourse du versement).
      await refundOrderPartially(dispute.order_id, refundAmount ?? 0);
      await transitionOrder(dispute.order_id, 'released', actor, note ?? 'Remboursement partiel du litige.');
    } else {
      await transitionOrder(dispute.order_id, 'released', actor, note ?? 'Litige rejete, liberation au vendeur.');
    }
  } catch (error) {
    // Compensation : la commande n'a pas avance, on remet le litige en attente.
    await pool.query(
      `UPDATE disputes
          SET status = 'open', refund_amount = NULL, resolution_note = NULL,
              resolved_by = NULL, resolved_at = NULL
        WHERE id = $1`,
      [disputeId],
    );
    throw error;
  }

  if (newStatus !== 'resolved_release') {
    await maybeSuspendSeller(dispute.seller_id);
  }

  return getForAdmin(admin, disputeId);
}
