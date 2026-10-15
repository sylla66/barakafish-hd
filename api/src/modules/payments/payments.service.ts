import { pool } from '../../db/pool';
import { AppError } from '../../lib/AppError';
import { getPaymentProvider, type PaymentEvent } from '../../providers/payment';
import { onOrderTransition } from '../orders/orders.hooks';
import { getOrder, transitionOrder } from '../orders/orders.service';
import type { Order } from '../orders/orders.types';
import type { AuthUser } from '../users/users.types';
import type {
  Payment,
  PaymentEventOutcome,
  PaymentStatus,
  PaymentWithOrder,
  Payout,
  PayoutStatus,
} from './payments.types';

interface PaymentRow {
  id: string;
  order_id: string;
  provider: string;
  provider_reference: string;
  amount: number;
  status: PaymentStatus;
  paid_at: Date | null;
  refunded_amount: number;
  created_at: Date;
}

interface PaymentOrderRow extends PaymentRow {
  order_status: string;
  order_total: number;
  listing_title: string;
}

interface PayoutRow {
  id: string;
  order_id: string;
  seller_id: string;
  amount: number;
  provider_reference: string | null;
  status: PayoutStatus;
  sent_at: Date | null;
  created_at: Date;
  shop_name?: string;
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    orderId: row.order_id,
    provider: row.provider,
    providerReference: row.provider_reference,
    amount: row.amount,
    status: row.status,
    paidAt: isoOrNull(row.paid_at),
    refundedAmount: row.refunded_amount,
    createdAt: row.created_at.toISOString(),
  };
}

function toPayout(row: PayoutRow): Payout {
  return {
    id: row.id,
    orderId: row.order_id,
    sellerId: row.seller_id,
    amount: row.amount,
    providerReference: row.provider_reference,
    status: row.status,
    sentAt: isoOrNull(row.sent_at),
    createdAt: row.created_at.toISOString(),
  };
}

// ===== Initiation du paiement (POST /orders/:id/pay) =====

export async function initiateOrderPayment(
  user: AuthUser,
  orderId: string,
): Promise<{ payment: Payment; paymentUrl: string }> {
  // getOrder renvoie 404 si la commande n'appartient pas a l'utilisateur.
  const order = await getOrder(user.id, false, orderId);
  if (order.status !== 'pending_payment') {
    throw AppError.conflict('Cette commande ne peut plus etre payee.');
  }

  const provider = getPaymentProvider();
  const initiated = await provider.initiatePayment(
    { id: order.id, totalAmount: order.totalAmount, listingTitle: order.listingTitle },
    { id: user.id, fullName: user.fullName, phone: user.phone },
  );

  const inserted = await pool.query<PaymentRow>(
    `INSERT INTO payments (order_id, provider, provider_reference, amount, status)
     VALUES ($1, $2, $3, $4, 'initiated')
     RETURNING id, order_id, provider, provider_reference, amount, status, paid_at, refunded_amount, created_at`,
    [order.id, provider.name, initiated.providerReference, order.totalAmount],
  );

  return { payment: toPayment(inserted.rows[0]), paymentUrl: initiated.redirectUrl };
}

// ===== Reception d'un evenement de paiement (webhook / simulation) =====

// Idempotence (regle 5) : le verrouillage de la ligne de paiement + le test de
// statut garantissent qu'un webhook rejoue ne modifie rien et ne declenche pas
// de seconde transition.
export async function handlePaymentEvent(event: PaymentEvent): Promise<PaymentEventOutcome> {
  const client = await pool.connect();
  let paymentId = '';
  let orderId = '';
  let outcome: PaymentEventOutcome = 'ignored';

  try {
    await client.query('BEGIN');

    const result = await client.query<{
      id: string;
      order_id: string;
      status: PaymentStatus;
      amount: number;
      order_total: number;
    }>(
      `SELECT p.id, p.order_id, p.status, p.amount, o.total_amount AS order_total
         FROM payments p
         JOIN orders o ON o.id = p.order_id
        WHERE p.provider_reference = $1
        FOR UPDATE OF p`,
      [event.providerReference],
    );
    const row = result.rows[0];
    if (!row) {
      throw AppError.notFound('Aucun paiement ne correspond a cette reference.');
    }
    paymentId = row.id;
    orderId = row.order_id;

    if (row.status === 'succeeded') {
      // Deja traite : on n'y touche pas.
      outcome = 'ignored';
    } else if (row.status === 'failed' && event.status === 'failed') {
      outcome = 'ignored';
    } else if (event.status === 'succeeded' && event.amount !== Number(row.order_total)) {
      throw AppError.badRequest(
        `Montant de paiement incorrect : ${event.amount} FCFA recus, ${row.order_total} FCFA attendus.`,
      );
    } else {
      const succeeded = event.status === 'succeeded';
      await client.query(
        `UPDATE payments
            SET status = $2,
                paid_at = $3,
                raw_payload = $4
          WHERE id = $1`,
        [row.id, succeeded ? 'succeeded' : 'failed', succeeded ? new Date() : null, event.rawPayload ?? null],
      );
      outcome = succeeded ? 'succeeded' : 'failed';
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (outcome === 'succeeded') {
    try {
      await transitionOrder(orderId, 'paid', { kind: 'system' }, 'Paiement confirme.');
    } catch (error) {
      // Compensation : sans transition (commande expiree, annulee...), le
      // paiement ne peut pas rester « reussi ». Le webhook est rejete pour que
      // le fournisseur signale l'anomalie.
      console.error('[payments] transition vers paid impossible pour la commande', orderId, error);
      await pool.query("UPDATE payments SET status = 'failed' WHERE id = $1", [paymentId]);
      throw error;
    }
  }

  return outcome;
}

// ===== Lecture =====

export async function getPaymentWithOrder(user: AuthUser, reference: string): Promise<PaymentWithOrder> {
  const result = await pool.query<PaymentOrderRow>(
    `SELECT p.id, p.order_id, p.provider, p.provider_reference, p.amount, p.status, p.paid_at,
            p.refunded_amount, p.created_at, o.status AS order_status, o.total_amount AS order_total,
            l.title AS listing_title
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       JOIN listings l ON l.id = o.listing_id
      WHERE p.provider_reference = $1`,
    [reference],
  );
  const row = result.rows[0];
  if (!row) {
    throw AppError.notFound('Paiement introuvable.');
  }
  if (!user.isAdmin && (await findOrderOwner(row.order_id)) !== user.id) {
    // 404 pour ne pas reveler l'existence d'un paiement d'autrui.
    throw AppError.notFound('Paiement introuvable.');
  }

  return {
    ...toPayment(row),
    order: {
      id: row.order_id,
      status: row.order_status as PaymentWithOrder['order']['status'],
      totalAmount: row.order_total,
      listingTitle: row.listing_title,
    },
  };
}

async function findOrderOwner(orderId: string): Promise<string | null> {
  const result = await pool.query<{ buyer_id: string }>('SELECT buyer_id FROM orders WHERE id = $1', [orderId]);
  return result.rows[0]?.buyer_id ?? null;
}

// ===== Simulation du paiement (fournisseur mock) =====

export interface MockPaymentInfo {
  reference: string;
  amount: number;
  title: string;
  status: PaymentStatus;
}

// Reserve au fournisseur mock : aucune authentification (la page est ouverte
// par le payer via son URL de redirection, la reference UUID tient lieu de jeton).
export async function loadMockPayment(reference: string): Promise<MockPaymentInfo> {
  const result = await pool.query<{ provider: string; amount: number; status: PaymentStatus; listing_title: string }>(
    `SELECT p.provider, p.amount, p.status, l.title AS listing_title
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       JOIN listings l ON l.id = o.listing_id
      WHERE p.provider_reference = $1`,
    [reference],
  );
  const row = result.rows[0];
  if (!row || row.provider !== 'mock') {
    throw AppError.notFound('Paiement introuvable.');
  }
  return { reference, amount: row.amount, title: row.listing_title, status: row.status };
}

export async function simulateMockPayment(
  reference: string,
  outcome: 'succeeded' | 'failed',
): Promise<PaymentEventOutcome> {
  const info = await loadMockPayment(reference);
  if (info.status !== 'initiated') {
    // Simulation deja effectuee : rien a refaire (idempotence).
    return 'ignored';
  }
  return handlePaymentEvent({
    provider: 'mock',
    providerReference: reference,
    status: outcome,
    amount: info.amount,
    rawPayload: { simulated: true, outcome },
  });
}

// ===== Versement au vendeur (apres liberation du sequestre) =====

async function executePayout(payoutId: string, amount: number, seller: { userId: string; shopName: string }): Promise<Payout> {
  const provider = getPaymentProvider();
  // Reference stable : une nouvelle tentative reutilise la meme, le fournisseur
  // reste ainsi lui-meme idempotent.
  const reference = `payout_${payoutId}`;

  try {
    const result = await provider.payout(seller, amount, reference);
    if (!result.sent) {
      throw new Error('versement refuse par le fournisseur');
    }
    await pool.query(
      "UPDATE payouts SET status = 'sent', sent_at = now(), provider_reference = $2 WHERE id = $1",
      [payoutId, reference],
    );
  } catch (error) {
    console.error('[payments] echec du versement', payoutId, error);
    await pool.query("UPDATE payouts SET status = 'failed', provider_reference = $2 WHERE id = $1", [
      payoutId,
      reference,
    ]);
  }

  return getPayoutOrFail(payoutId);
}

async function getPayoutOrFail(payoutId: string): Promise<Payout> {
  const result = await pool.query<PayoutRow>(
    `SELECT id, order_id, seller_id, amount, provider_reference, status, sent_at, created_at
       FROM payouts WHERE id = $1`,
    [payoutId],
  );
  const row = result.rows[0];
  if (!row) {
    throw AppError.notFound('Versement introuvable.');
  }
  return toPayout(row);
}

// La liberation cree (une seule fois) la ligne de versement puis appelle le
// fournisseur. Aucun versement avant « released » (AGENTS.md, regle 3).
async function releaseFunds(order: Order): Promise<void> {
  const paymentResult = await pool.query<PaymentRow>(
    `SELECT id, order_id, provider, provider_reference, amount, status, paid_at, refunded_amount, created_at
       FROM payments
      WHERE order_id = $1 AND status IN ('succeeded', 'refunded')
      ORDER BY created_at DESC
      LIMIT 1`,
    [order.id],
  );
  const payment = paymentResult.rows[0];
  if (!payment) {
    // Liberation sans paiement : court-circuit des tests, jamais atteint en
    // production (une commande doit passer par « paid »).
    console.warn('[payments] commande liberee sans paiement reussi, versement ignore :', order.id);
    return;
  }

  // L'eventuel remboursement partiel est sorti du sequestre : il est retire du
  // versement du vendeur.
  const amount = Math.max(0, order.sellerPayout - payment.refunded_amount);
  if (amount <= 0) {
    return;
  }

  const existing = await pool.query<PayoutRow>('SELECT * FROM payouts WHERE order_id = $1', [order.id]);
  let payout = existing.rows[0];

  if (!payout) {
    const inserted = await pool.query<PayoutRow>(
      `INSERT INTO payouts (order_id, seller_id, amount, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (order_id) DO NOTHING
       RETURNING *`,
      [order.id, order.sellerId, amount],
    );
    if (inserted.rows[0]) {
      payout = inserted.rows[0];
    } else {
      const again = await pool.query<PayoutRow>('SELECT * FROM payouts WHERE order_id = $1', [order.id]);
      payout = again.rows[0];
    }
  }

  if (!payout || payout.status === 'sent') {
    return;
  }
  if (payout.status === 'failed') {
    // Nouvelle tentative manuelle, reservee a l'admin (POST /admin/payouts/:id/retry).
    return;
  }

  await executePayout(payout.id, payout.amount, { userId: payout.seller_id, shopName: order.seller.shopName });
}

export async function retryPayout(payoutId: string): Promise<Payout> {
  const result = await pool.query<PayoutRow & { shop_name: string }>(
    `SELECT p.*, spp.shop_name
       FROM payouts p
       JOIN seller_profiles spp ON spp.user_id = p.seller_id
      WHERE p.id = $1`,
    [payoutId],
  );
  const row = result.rows[0];
  if (!row) {
    throw AppError.notFound('Versement introuvable.');
  }
  if (row.status === 'sent') {
    throw AppError.conflict('Ce versement a deja ete effectue.');
  }

  return executePayout(row.id, row.amount, { userId: row.seller_id, shopName: row.shop_name });
}

// ===== Remboursement (quand la commande passe a « refunded ») =====

async function refundBuyer(order: Order): Promise<void> {
  const paymentResult = await pool.query<PaymentRow>(
    `SELECT id, order_id, provider, provider_reference, amount, status, paid_at, refunded_amount, created_at
       FROM payments
      WHERE order_id = $1 AND status IN ('succeeded', 'refunded')
      ORDER BY created_at DESC
      LIMIT 1`,
    [order.id],
  );
  const payment = paymentResult.rows[0];
  if (!payment) {
    // Court-circuit des tests : remboursement d'une commande jamais payee.
    return;
  }

  const remaining = payment.amount - payment.refunded_amount;
  if (remaining <= 0) {
    return;
  }

  // Montant fixe par l'etape 9 (decision admin) : total si aucun litige, sinon
  // remboursement partiel plafonne au reste du.
  const dispute = await pool.query<{ refund_amount: number | null }>(
    `SELECT refund_amount FROM disputes
      WHERE order_id = $1 AND refund_amount IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [order.id],
  );
  const requested = dispute.rows[0]?.refund_amount ?? remaining;
  const amount = Math.min(requested, remaining);

  const provider = getPaymentProvider();
  try {
    const result = await provider.refund(payment.id, amount);
    if (!result.refunded) {
      throw new Error('remboursement refuse par le fournisseur');
    }
    await pool.query(
      `UPDATE payments
          SET refunded_amount = refunded_amount + $2,
              status = CASE WHEN refunded_amount + $2 >= amount THEN 'refunded' ELSE status END
        WHERE id = $1`,
      [payment.id, amount],
    );
  } catch (error) {
    // L'ordre est deja « refunded » : l'echec est journalise pour une reprise
    // manuelle par l'admin (aucun remboursement perdu silencieusement).
    console.error('[payments] echec du remboursement pour la commande', order.id, error);
  }
}

// ===== Enregistrement des effets de bord sur la machine a etats =====

let hooksRegistered = false;

function registerPaymentHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;

  onOrderTransition(async (event) => {
    if (event.to === 'released') {
      await releaseFunds(event.order);
    }
    if (event.to === 'refunded') {
      await refundBuyer(event.order);
    }
  });
}

registerPaymentHooks();
