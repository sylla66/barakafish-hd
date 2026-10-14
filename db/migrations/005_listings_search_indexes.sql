-- Migration 005 : index pour la recherche du catalogue (etape 5).
-- La recherche ne porte que sur les annonces 'active' : on utilise des index
-- partiels pour rester compacts, et l'ordre sponsored-first est servi par un
-- index dedie sur la mise en avant des annonces sponsorisees.

-- Recherche textuelle (titre + nom d'espece) : pg_trgm accelere les ILIKE '%terme%'.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Tri par date (cas par defaut) sur les annonces actives.
CREATE INDEX idx_listings_active_created
  ON listings (created_at DESC)
  WHERE status = 'active';

-- Tri et filtrage par prix.
CREATE INDEX idx_listings_active_price
  ON listings (price_per_kg)
  WHERE status = 'active';

-- Filtres espece / etat.
CREATE INDEX idx_listings_active_species_state
  ON listings (species_id, state)
  WHERE status = 'active';

-- Filtre par zone.
CREATE INDEX idx_listings_active_zone
  ON listings (zone)
  WHERE status = 'active';

-- Mise en avant des annonces sponsorisees non expirees (tri sponsored-first).
CREATE INDEX idx_listings_sponsored_until
  ON listings (sponsored_until DESC)
  WHERE is_sponsored AND sponsored_until IS NOT NULL;

-- Recherche par titre d'annonce.
CREATE INDEX idx_listings_title_trgm
  ON listings USING gin (title gin_trgm_ops);

-- Recherche par nom d'espece (francais et wolof).
CREATE INDEX idx_species_name_fr_trgm
  ON species USING gin (name_fr gin_trgm_ops);

CREATE INDEX idx_species_name_wo_trgm
  ON species USING gin (name_wo gin_trgm_ops);
