-- Marketplace de poissons et fruits de mer — schéma PostgreSQL (MVP)
-- Montants en FCFA (XOF), stockés en entiers.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===== Types =====
CREATE TYPE user_role AS ENUM ('buyer', 'seller', 'admin');
CREATE TYPE seller_status AS ENUM ('pending', 'verified', 'suspended', 'rejected');
CREATE TYPE product_state AS ENUM ('fresh', 'frozen_at_sea', 'frozen');
CREATE TYPE listing_status AS ENUM ('draft', 'active', 'sold_out', 'archived');
CREATE TYPE order_status AS ENUM (
  'pending_payment', 'paid', 'shipped', 'delivered',
  'confirmed', 'released', 'disputed', 'refunded', 'cancelled'
);
CREATE TYPE payment_status AS ENUM ('initiated', 'succeeded', 'failed', 'refunded');
CREATE TYPE dispute_status AS ENUM ('open', 'under_review', 'resolved_refund', 'resolved_partial', 'resolved_release');
CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'cancelled');

-- ===== Utilisateurs =====
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  email         TEXT,
  is_buyer      BOOLEAN NOT NULL DEFAULT TRUE,
  is_seller     BOOLEAN NOT NULL DEFAULT FALSE,
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  is_business   BOOLEAN NOT NULL DEFAULT FALSE,  -- acheteur professionnel (B2B)
  business_name TEXT,
  city          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  attempts   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_otp_phone ON otp_codes (phone, created_at DESC);

CREATE TABLE seller_profiles (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  shop_name          TEXT NOT NULL,
  description        TEXT,
  zone               TEXT NOT NULL,            -- ex. Dakar, Mbour, Joal, Saint-Louis
  address            TEXT,
  status             seller_status NOT NULL DEFAULT 'pending',
  id_document_url    TEXT,                     -- accessible aux admins uniquement
  sanitary_doc_url   TEXT,                     -- agrément sanitaire, si applicable
  facility_photo_url TEXT,
  verified_at        TIMESTAMPTZ,
  verified_by        UUID REFERENCES users(id),
  rating_avg         NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count       INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Catalogue =====
CREATE TABLE species (
  id          SERIAL PRIMARY KEY,
  name_fr     TEXT NOT NULL UNIQUE,            -- ex. Thiof, Crevette, Capitaine, Poulpe
  name_wo     TEXT,                            -- nom wolof (optionnel)
  category    TEXT NOT NULL                    -- poisson, crustacé, mollusque, céphalopode
);

CREATE TABLE listings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id           UUID NOT NULL REFERENCES seller_profiles(user_id),
  species_id          INT NOT NULL REFERENCES species(id),
  title               TEXT NOT NULL,
  description         TEXT,
  state               product_state NOT NULL,
  caught_or_frozen_on DATE NOT NULL,           -- date de pêche (frais) ou de congélation
  storage_conditions  TEXT NOT NULL,           -- ex. glace, chambre froide -18°C
  quantity_kg         NUMERIC(10,2) NOT NULL CHECK (quantity_kg > 0),
  min_order_kg        NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (min_order_kg > 0),
  price_per_kg        INT NOT NULL CHECK (price_per_kg > 0),
  zone                TEXT NOT NULL,
  status              listing_status NOT NULL DEFAULT 'draft',
  is_sponsored        BOOLEAN NOT NULL DEFAULT FALSE,
  sponsored_until     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_listings_search ON listings (status, zone, species_id, state);
CREATE INDEX idx_listings_seller ON listings (seller_id);

CREATE TABLE listing_photos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  position   INT NOT NULL DEFAULT 0
);

-- ===== Commandes =====
CREATE TABLE orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id             UUID NOT NULL REFERENCES users(id),
  seller_id            UUID NOT NULL REFERENCES seller_profiles(user_id),
  listing_id           UUID NOT NULL REFERENCES listings(id),
  quantity_kg          NUMERIC(10,2) NOT NULL CHECK (quantity_kg > 0),
  unit_price           INT NOT NULL,                  -- prix/kg figé à la commande
  subtotal             INT NOT NULL,                  -- quantity_kg * unit_price
  delivery_fee         INT NOT NULL DEFAULT 0,
  commission_rate_bps  INT NOT NULL,                  -- ex. 500 = 5 %, figé à la commande
  commission_amount    INT NOT NULL,
  total_amount         INT NOT NULL,                  -- subtotal + delivery_fee
  seller_payout        INT NOT NULL,                  -- subtotal - commission_amount
  status               order_status NOT NULL DEFAULT 'pending_payment',
  delivery_address     TEXT,
  delivery_zone        TEXT,
  delivered_at         TIMESTAMPTZ,
  auto_release_at      TIMESTAMPTZ,                   -- libération auto 48 h après livraison
  buyer_confirmed_at   TIMESTAMPTZ,
  released_at          TIMESTAMPTZ,
  receipt_photo_url    TEXT,                          -- photo de réception
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_buyer ON orders (buyer_id, created_at DESC);
CREATE INDEX idx_orders_seller ON orders (seller_id, created_at DESC);
CREATE INDEX idx_orders_status ON orders (status);

CREATE TABLE order_status_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status order_status,
  to_status   order_status NOT NULL,
  actor_id    UUID REFERENCES users(id),             -- NULL = système
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_history ON order_status_history (order_id, created_at);

-- ===== Paiements (séquestre) =====
CREATE TABLE payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES orders(id),
  provider           TEXT NOT NULL,                  -- wave, orange_money, agrégateur...
  provider_reference TEXT UNIQUE,                    -- clé d'idempotence des webhooks
  amount             INT NOT NULL,
  status             payment_status NOT NULL DEFAULT 'initiated',
  paid_at            TIMESTAMPTZ,
  refunded_amount    INT NOT NULL DEFAULT 0,
  raw_payload        JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_order ON payments (order_id);

CREATE TABLE payouts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL UNIQUE REFERENCES orders(id),
  seller_id          UUID NOT NULL REFERENCES seller_profiles(user_id),
  amount             INT NOT NULL,
  provider_reference TEXT UNIQUE,
  status             TEXT NOT NULL DEFAULT 'pending',  -- pending, sent, failed
  sent_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Avis =====
CREATE TABLE reviews (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL UNIQUE REFERENCES orders(id),  -- un avis par commande
  buyer_id   UUID NOT NULL REFERENCES users(id),
  seller_id  UUID NOT NULL REFERENCES seller_profiles(user_id),
  rating     INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT,
  photo_url  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reviews_seller ON reviews (seller_id);

-- ===== Litiges =====
CREATE TABLE disputes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id),
  opened_by       UUID NOT NULL REFERENCES users(id),
  reason          TEXT NOT NULL,                      -- ex. non conforme, produit avarié, retard
  description     TEXT NOT NULL,
  status          dispute_status NOT NULL DEFAULT 'open',
  refund_amount   INT,
  resolution_note TEXT,
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_disputes_order ON disputes (order_id);
CREATE INDEX idx_disputes_status ON disputes (status);

CREATE TABLE dispute_evidence (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES users(id),
  photo_url  TEXT,
  message    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Abonnements (V2, table prête) =====
CREATE TABLE subscription_plans (
  id                  SERIAL PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,           -- seller_free, seller_pro, seller_premium, buyer_pro
  name                TEXT NOT NULL,
  monthly_price       INT NOT NULL DEFAULT 0,
  commission_rate_bps INT,                            -- commission appliquée avec ce plan
  max_active_listings INT                             -- NULL = illimité
);

CREATE TABLE subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  plan_id    INT NOT NULL REFERENCES subscription_plans(id),
  status     subscription_status NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  renews_at  TIMESTAMPTZ,
  ended_at   TIMESTAMPTZ
);

-- ===== Notifications =====
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  channel    TEXT NOT NULL,                           -- sms, whatsapp, push
  template   TEXT NOT NULL,
  payload    JSONB,
  sent_at    TIMESTAMPTZ,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Données initiales =====
INSERT INTO subscription_plans (code, name, monthly_price, commission_rate_bps, max_active_listings) VALUES
  ('seller_free',    'Vendeur Gratuit',  0,     600, 5),
  ('seller_pro',     'Vendeur Pro',      12000, 400, NULL),
  ('seller_premium', 'Vendeur Premium',  40000, 300, NULL),
  ('buyer_pro',      'Acheteur Pro',     10000, NULL, NULL);
