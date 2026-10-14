-- Migration 003 : justificatif professionnel du vendeur.
-- Un seul emplacement (carte de mareyeur OU registre de commerce / RCCM), en
-- complement de la piece d'identite et du document sanitaire.

ALTER TABLE seller_profiles
  ADD COLUMN IF NOT EXISTS business_document_url TEXT;
