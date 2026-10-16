-- Migration 008 : index pour la liste paginee des avis d'un vendeur (etape 8).
-- La liste est triee par date decroissante et paginee par curseur (created_at, id).
-- Cet index remplace idx_reviews_seller cree en 001 (meme prefixe seller_id) en y
-- ajoutant l'ordre de tri.

DROP INDEX IF EXISTS idx_reviews_seller;

CREATE INDEX idx_reviews_seller_created ON reviews (seller_id, created_at DESC, id DESC);
