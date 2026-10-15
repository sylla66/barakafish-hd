-- Migration 007 : une annonce epuisee doit pouvoir atteindre 0 kg.
-- La contrainte initiale (quantity_kg > 0) empechait une commande de vider le
-- stock ; on autorise 0 (l'annonce passe alors au statut 'sold_out').

ALTER TABLE listings DROP CONSTRAINT listings_quantity_kg_check;

ALTER TABLE listings
  ADD CONSTRAINT listings_quantity_kg_check CHECK (quantity_kg >= 0);
