import { pool } from '../db/pool';
import { transitionOrder } from '../modules/orders/orders.service';

// Delai de paiement d'une commande avant annulation automatique.
export const PAYMENT_EXPIRY_MINUTES = 30;

const DEFAULT_INTERVAL_MS = 60_000;

// Annule les commandes restees impayees au-dela du delai (remise en stock via
// transitionOrder, seule fonction autorisee a changer orders.status).
export async function cancelExpiredPendingOrders(now: Date = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - PAYMENT_EXPIRY_MINUTES * 60_000);
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM orders WHERE status = 'pending_payment' AND created_at < $1",
    [threshold],
  );

  let cancelled = 0;
  for (const row of result.rows) {
    try {
      await transitionOrder(
        row.id,
        'cancelled',
        { kind: 'system' },
        `Annulation automatique : paiement non recu dans les ${PAYMENT_EXPIRY_MINUTES} minutes.`,
      );
      cancelled += 1;
    } catch (error) {
      console.error('[scheduler] echec de l annulation de la commande', row.id, error);
    }
  }
  return cancelled;
}

// Libere les fonds des commandes livrees dont le delai de litige est depasse
// (auto_release_at = delivered_at + 48 h).
export async function releaseDeliveredOrders(now: Date = new Date()): Promise<number> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM orders
      WHERE status = 'delivered' AND auto_release_at IS NOT NULL AND auto_release_at <= $1`,
    [now],
  );

  let released = 0;
  for (const row of result.rows) {
    try {
      await transitionOrder(
        row.id,
        'released',
        { kind: 'system' },
        'Liberation automatique des fonds apres 48 h sans litige.',
      );
      released += 1;
    } catch (error) {
      console.error('[scheduler] echec de la liberation de la commande', row.id, error);
    }
  }
  return released;
}

export async function runOrderJobs(now: Date = new Date()): Promise<void> {
  await cancelExpiredPendingOrders(now);
  await releaseDeliveredOrders(now);
}

// Tache planifiee equivalente a node-cron, sans dependance supplementaire : un
// intervalle qui repete les deux traitements. On desinscrit le timer pour ne pas
// bloquer l'arret du process.
export function startOrdersScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): () => void {
  const timer = setInterval(() => {
    void runOrderJobs().catch((error) => {
      console.error('[scheduler] erreur inattendue', error);
    });
  }, intervalMs);
  timer.unref();

  return () => clearInterval(timer);
}
