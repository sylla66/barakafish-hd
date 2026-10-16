import type { AuthUser } from '../users/users.types';
import { pool } from '../../db/pool';
import { AppError } from '../../lib/AppError';
import { processImage } from '../../lib/image';
import { getStorageProvider } from '../../providers/storage';
import { runOrderTransitionHooks } from './orders.hooks';
import {
  DEFAULT_COMMISSION_RATE_BPS,
  computeOrderAmounts,
} from './orders.pricing';
import type { CreateOrderInput } from './orders.schema';
import type { Order, OrderHistoryEntry, OrderStatus, TransitionActor } from './orders.types';
import { allowedTransitions, canTransition, isKnownTransition, type ActorKind } from './stateMachine';

// Delai laisse a l'acheteur pour ouvrir un litige apres livraison (AGENTS.md).
export const AUTO_RELEASE_HOURS = 48;

interface OrderRow {
  id: string;
  buyer_id: string;
  seller_id: string;
  listing_id: string;
  quantity_kg: string;
  unit_price: number;
  subtotal: number;
  delivery_fee: number;
  commission_rate_bps: number;
  commission_amount: number;
  total_amount: number;
  seller_payout: number;
  status: OrderStatus;
  delivery_address: string | null;
  delivery_zone: string | null;
  delivered_at: Date | null;
  auto_release_at: Date | null;
  buyer_confirmed_at: Date | null;
  released_at: Date | null;
  receipt_photo_url: string | null;
  created_at: Date;
  updated_at: Date;
  listing_title: string;
  species_name_fr: string;
  shop_name: string;
  seller_verified: boolean;
}

// Verrou de ligne sans jointure (FOR UPDATE ne doit porter que sur la commande).
interface OrderLockRow {
  id: string;
  buyer_id: string;
  seller_id: string;
  listing_id: string;
  quantity_kg: string;
  status: OrderStatus;
  auto_release_at: Date | null;
}

interface ListingLockRow {
  id: string;
  seller_id: string;
  price_per_kg: number;
  quantity_kg: string;
  min_order_kg: string;
  status: string;
}

interface HistoryRow {
  id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_id: string | null;
  note: string | null;
  created_at: Date;
}

const ORDER_SELECT = `
  SELECT o.id, o.buyer_id, o.seller_id, o.listing_id, o.quantity_kg, o.unit_price, o.subtotal,
         o.delivery_fee, o.commission_rate_bps, o.commission_amount, o.total_amount, o.seller_payout,
         o.status, o.delivery_address, o.delivery_zone, o.delivered_at, o.auto_release_at,
         o.buyer_confirmed_at, o.released_at, o.receipt_photo_url, o.created_at, o.updated_at,
         l.title AS listing_title, sp.name_fr AS species_name_fr,
         spp.shop_name, (spp.status = 'verified') AS seller_verified
    FROM orders o
    JOIN listings l ON l.id = o.listing_id
    JOIN species sp ON sp.id = l.species_id
    JOIN seller_profiles spp ON spp.user_id = o.seller_id`;

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toOrder(row: OrderRow, role: Order['role'], history: OrderHistoryEntry[]): Order {
  return {
    id: row.id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    listingId: row.listing_id,
    listingTitle: row.listing_title,
    speciesNameFr: row.species_name_fr,
    quantityKg: Number(row.quantity_kg),
    unitPrice: row.unit_price,
    subtotal: row.subtotal,
    deliveryFee: row.delivery_fee,
    commissionRateBps: row.commission_rate_bps,
    commissionAmount: row.commission_amount,
    totalAmount: row.total_amount,
    sellerPayout: row.seller_payout,
    status: row.status,
    deliveryAddress: row.delivery_address,
    deliveryZone: row.delivery_zone,
    deliveredAt: isoOrNull(row.delivered_at),
    autoReleaseAt: isoOrNull(row.auto_release_at),
    buyerConfirmedAt: isoOrNull(row.buyer_confirmed_at),
    releasedAt: isoOrNull(row.released_at),
    receiptPhotoUrl: row.receipt_photo_url ? `/orders/${row.id}/receipt-photo` : null,
    seller: {
      userId: row.seller_id,
      shopName: row.shop_name,
      isVerified: row.seller_verified,
    },
    role,
    history,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toHistoryEntry(row: HistoryRow): OrderHistoryEntry {
  return {
    id: row.id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorId: row.actor_id,
    note: row.note,
    createdAt: row.created_at.toISOString(),
  };
}

async function fetchHistory(orderId: string): Promise<OrderHistoryEntry[]> {
  const result = await pool.query<HistoryRow>(
    `SELECT id, from_status, to_status, actor_id, note, created_at
       FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC, id ASC`,
    [orderId],
  );
  return result.rows.map(toHistoryEntry);
}

async function findOrderRow(orderId: string): Promise<OrderRow | null> {
  const result = await pool.query<OrderRow>(`${ORDER_SELECT} WHERE o.id = $1`, [orderId]);
  return result.rows[0] ?? null;
}

async function loadOrder(orderId: string, role: Order['role']): Promise<Order> {
  const row = await findOrderRow(orderId);
  if (!row) {
    throw AppError.notFound('Commande introuvable.');
  }
  return toOrder(row, role, await fetchHistory(orderId));
}

// Traduit l'acteur en role vis-a-vis de la commande, ou 'stranger' si l'acteur
// n'a rien a voir avec elle.
function resolveActorKind(row: OrderLockRow, actor: TransitionActor): string {
  if (actor.kind === 'system') return 'system';
  if (actor.isAdmin) return 'admin';
  if (actor.isSeller && actor.id === row.seller_id) return 'seller';
  if (actor.id === row.buyer_id) return 'buyer';
  return 'stranger';
}

function roleFromKind(kind: string): Order['role'] {
  if (kind === 'buyer' || kind === 'seller') return kind;
  return 'admin';
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

async function resolveCommissionRate(sellerId: string): Promise<number> {
  const result = await pool.query<{ commission_rate_bps: number | null }>(
    `SELECT p.commission_rate_bps
       FROM subscriptions s
       JOIN subscription_plans p ON p.id = s.plan_id
      WHERE s.user_id = $1 AND s.status = 'active'
      ORDER BY s.started_at DESC
      LIMIT 1`,
    [sellerId],
  );
  return result.rows[0]?.commission_rate_bps ?? DEFAULT_COMMISSION_RATE_BPS;
}

// ===== Transition d'etat (regle 1 : unique point d'ecriture de orders.status) =====

export async function transitionOrder(
  orderId: string,
  newStatus: OrderStatus,
  actor: TransitionActor,
  note?: string,
): Promise<Order> {
  const client = await pool.connect();
  let resolvedKind = 'system';
  let from: OrderStatus = 'pending_payment';

  try {
    await client.query('BEGIN');

    const locked = await client.query<OrderLockRow>(
      'SELECT id, buyer_id, seller_id, listing_id, quantity_kg, status, auto_release_at FROM orders WHERE id = $1 FOR UPDATE',
      [orderId],
    );
    const row = locked.rows[0];
    if (!row) {
      throw AppError.notFound('Commande introuvable.');
    }

    from = row.status;
    const actorKind = resolveActorKind(row, actor);
    if (actorKind === 'stranger') {
      throw AppError.forbidden("Vous n'avez pas acces a cette commande.");
    }
    resolvedKind = actorKind;

    if (!isKnownTransition(from, newStatus)) {
      throw AppError.conflict(`Transition interdite de « ${from} » vers « ${newStatus} ».`);
    }
    if (!canTransition(from, newStatus, actorKind as ActorKind)) {
      throw AppError.forbidden("Vous n'avez pas le droit d'effectuer cette transition.");
    }

    // Delai de litige : passe auto_release_at, la liberation est automatique.
    if (
      from === 'delivered' &&
      newStatus === 'disputed' &&
      row.auto_release_at !== null &&
      row.auto_release_at.getTime() <= Date.now()
    ) {
      throw AppError.badRequest('Le delai de litige de 48 heures est depasse.');
    }

    const updates: string[] = ['status = $2', 'updated_at = now()'];
    const values: unknown[] = [orderId, newStatus];

    if (newStatus === 'delivered') {
      updates.push('delivered_at = now()', `auto_release_at = now() + interval '${AUTO_RELEASE_HOURS} hours'`);
    }
    if (newStatus === 'confirmed') {
      updates.push('buyer_confirmed_at = now()');
    }
    if (newStatus === 'released') {
      updates.push('released_at = now()');
    }

    await client.query(`UPDATE orders SET ${updates.join(', ')} WHERE id = $1`, values);

    // Annulation : la quantite reservee retourne dans le stock de l'annonce.
    if (newStatus === 'cancelled') {
      await client.query(
        `UPDATE listings
            SET quantity_kg = quantity_kg + $2,
                status = CASE WHEN status = 'sold_out' THEN 'active' ELSE status END,
                updated_at = now()
          WHERE id = $1`,
        [row.listing_id, Number(row.quantity_kg)],
      );
    }

    await client.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, actor_id, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, from, newStatus, actor.kind === 'user' ? actor.id : null, note ?? null],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const order = await loadOrder(orderId, roleFromKind(resolvedKind));
  // Effets de bord (versement, remboursement...) executes apres le COMMIT.
  await runOrderTransitionHooks({ order, from, to: newStatus, note: note ?? null });
  return order;
}

// ===== Creation de commande =====

export async function createOrder(buyerId: string, input: CreateOrderInput): Promise<Order> {
  const quantity = Math.round(input.quantity_kg * 100) / 100;
  const client = await pool.connect();
  let orderId: string;

  try {
    await client.query('BEGIN');

    const listingResult = await client.query<ListingLockRow>(
      `SELECT id, seller_id, price_per_kg, quantity_kg, min_order_kg, status
         FROM listings WHERE id = $1 FOR UPDATE`,
      [input.listing_id],
    );
    const listing = listingResult.rows[0];
    if (!listing) {
      throw AppError.notFound('Annonce introuvable.');
    }
    if (listing.seller_id === buyerId) {
      throw AppError.badRequest('Vous ne pouvez pas commander votre propre annonce.');
    }
    if (listing.status !== 'active') {
      throw AppError.badRequest("Cette annonce n'est plus disponible.");
    }

    const available = Number(listing.quantity_kg);
    const minOrder = Number(listing.min_order_kg);
    if (quantity < minOrder) {
      throw AppError.badRequest(`La quantite minimum de commande est de ${minOrder} kg.`);
    }
    if (quantity > available) {
      throw AppError.badRequest(`Quantite insuffisante : ${available} kg disponible(s).`);
    }

    const deliveryFee = 0;
    const commissionRateBps = await resolveCommissionRate(listing.seller_id);
    const amounts = computeOrderAmounts(quantity, listing.price_per_kg, deliveryFee, commissionRateBps);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO orders
         (buyer_id, seller_id, listing_id, quantity_kg, unit_price, subtotal, delivery_fee,
          commission_rate_bps, commission_amount, total_amount, seller_payout, status,
          delivery_address, delivery_zone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_payment', $12, $13)
       RETURNING id`,
      [
        buyerId,
        listing.seller_id,
        listing.id,
        quantity,
        listing.price_per_kg,
        amounts.subtotal,
        deliveryFee,
        amounts.commissionRateBps,
        amounts.commissionAmount,
        amounts.totalAmount,
        amounts.sellerPayout,
        input.delivery_address,
        input.delivery_zone,
      ],
    );
    orderId = inserted.rows[0].id;

    // Reservation du stock dans la meme transaction (le verrou FOR UPDATE garantit
    // qu'une commande concurrente relira la quantite deja decrementee).
    const reserved = await client.query(
      `UPDATE listings
          SET quantity_kg = quantity_kg - $2,
              status = CASE WHEN quantity_kg - $2 <= 0 THEN 'sold_out' ELSE status END,
              updated_at = now()
        WHERE id = $1 AND quantity_kg >= $2`,
      [listing.id, quantity],
    );
    if (reserved.rowCount === 0) {
      throw AppError.conflict('Quantite insuffisante.');
    }

    await client.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, actor_id, note)
       VALUES ($1, NULL, 'pending_payment', $2, $3)`,
      [orderId, buyerId, 'Commande creee.'],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return loadOrder(orderId, 'buyer');
}

// ===== Lecture =====

export async function listOrders(userId: string): Promise<Order[]> {
  const result = await pool.query<OrderRow>(
    `${ORDER_SELECT}
      WHERE o.buyer_id = $1 OR o.seller_id = $1
      ORDER BY o.created_at DESC`,
    [userId],
  );

  return result.rows.map((row) =>
    toOrder(row, row.buyer_id === userId ? 'buyer' : 'seller', []),
  );
}

export async function getOrder(userId: string, isAdmin: boolean, orderId: string): Promise<Order> {
  const row = await findOrderRow(orderId);
  if (!row) {
    throw AppError.notFound('Commande introuvable.');
  }
  if (!isAdmin && row.buyer_id !== userId && row.seller_id !== userId) {
    // 404 (et non 403) pour ne pas reveler l'existence d'une commande d'autrui.
    throw AppError.notFound('Commande introuvable.');
  }

  const role: Order['role'] = isAdmin ? 'admin' : row.buyer_id === userId ? 'buyer' : 'seller';
  return toOrder(row, role, await fetchHistory(orderId));
}

// ===== Actions exposees =====

export async function shipOrder(user: AuthUser, orderId: string): Promise<Order> {
  return transitionOrder(orderId, 'shipped', actorFromUser(user));
}

export async function deliverOrder(user: AuthUser, orderId: string): Promise<Order> {
  return transitionOrder(orderId, 'delivered', actorFromUser(user));
}

export async function cancelOrder(user: AuthUser, orderId: string): Promise<Order> {
  return transitionOrder(orderId, 'cancelled', actorFromUser(user), 'Annulation par l\'acheteur.');
}

// Confirmation de reception par l'acheteur (etape 8) : enregistre la photo de
// reception optionnelle, fait passer la commande a 'confirmed' puis libere
// immediatement les fonds (AGENTS.md regle 3). Seul l'acheteur peut confirmer.
export async function confirmReceipt(
  user: AuthUser,
  orderId: string,
  file?: Express.Multer.File,
): Promise<Order> {
  const row = await findOrderRow(orderId);
  if (!row) {
    throw AppError.notFound('Commande introuvable.');
  }
  if (row.buyer_id !== user.id) {
    throw AppError.forbidden("Seul l'acheteur peut confirmer la reception.");
  }
  if (row.status !== 'delivered') {
    throw AppError.conflict("La reception ne peut etre confirmee qu'apres la livraison.");
  }

  if (file) {
    let processed: Buffer;
    try {
      processed = await processImage(file.buffer);
    } catch {
      throw AppError.badRequest('La photo de reception est illisible (image invalide).');
    }
    const { key } = await getStorageProvider().saveFile({
      buffer: processed,
      originalName: file.originalname,
      mimeType: 'image/jpeg',
      category: `receipts/${orderId}`,
    });
    await pool.query('UPDATE orders SET receipt_photo_url = $2, updated_at = now() WHERE id = $1', [
      orderId,
      key,
    ]);
  }

  await transitionOrder(
    orderId,
    'confirmed',
    actorFromUser(user),
    "Reception confirmee par l'acheteur.",
  );

  // La confirmation de reception vaut liberation immediate des fonds. Si cette
  // seconde transition echoue, la commande reste 'confirmed' (coherente) : le
  // versement pourra etre repris manuellement depuis le back-office.
  try {
    return await transitionOrder(
      orderId,
      'released',
      { kind: 'system' },
      'Liberation des fonds apres confirmation de reception.',
    );
  } catch (error) {
    console.error('[orders] liberation impossible apres confirmation', orderId, error);
    return loadOrder(orderId, 'buyer');
  }
}

// Cle de stockage de la photo de reception, pour la route de service protegee
// (accessible a l'acheteur, au vendeur et aux admins).
export async function getReceiptPhotoKey(user: AuthUser, orderId: string): Promise<string | null> {
  const row = await findOrderRow(orderId);
  if (!row) {
    throw AppError.notFound('Commande introuvable.');
  }
  if (!user.isAdmin && row.buyer_id !== user.id && row.seller_id !== user.id) {
    throw AppError.notFound('Commande introuvable.');
  }
  return row.receipt_photo_url;
}

export { allowedTransitions };
