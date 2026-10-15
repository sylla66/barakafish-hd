-- Migration 006 : index pour la tache planifiee des commandes (etape 6).
-- Deux balayages : commandes impayees a annuler, commandes livrees a liberer.

CREATE INDEX idx_orders_pending_payment
  ON orders (created_at)
  WHERE status = 'pending_payment';

CREATE INDEX idx_orders_delivered_auto_release
  ON orders (auto_release_at)
  WHERE status = 'delivered';
