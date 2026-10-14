-- Migration 002 : motif de rejet d'un profil vendeur.
-- Le statut `rejected` existait déjà mais aucun champ ne permettait de stocker
-- la raison communiquée au vendeur (voir QUESTIONS.md).

ALTER TABLE seller_profiles
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
