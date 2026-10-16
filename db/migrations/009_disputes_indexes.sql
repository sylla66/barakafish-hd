-- Migration 009 : index et integrite pour le module litiges (etape 9).
-- 1. Le fil de preuves est toujours lu par litige (dispute_evidence.dispute_id).
--    La cle etrangere ne cree pas d'index automatiquement dans PostgreSQL.
-- 2. Le compteur de litiges fondes par vendeur filtre sur le statut de resolution
--    et la date de resolution (fenetre glissante de 30 jours par defaut).
-- 3. Une notification appartient a son destinataire : sa suppression suit celle
--    du compte (la suspension automatique notifie tous les admins, y compris
--    pendant les tests parallels ou des comptes ephemeres sont supprimes).

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_dispute ON dispute_evidence (dispute_id);

CREATE INDEX IF NOT EXISTS idx_disputes_status_resolved_at ON disputes (status, resolved_at);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
