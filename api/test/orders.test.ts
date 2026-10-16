import { rm } from 'node:fs/promises';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const otpCapture = vi.hoisted(() => ({ phone: '', code: '' }));

vi.mock('../src/providers/otp', () => ({
  getOtpProvider: () => ({
    name: 'capture',
    sendOtp: async (phone: string, code: string) => {
      otpCapture.phone = phone;
      otpCapture.code = code;
    },
  }),
}));

import { createApp } from '../src/app';
import { closePool, pool } from '../src/db/pool';
import { cancelExpiredPendingOrders, releaseDeliveredOrders } from '../src/jobs/ordersScheduler';
import { computeOrderAmounts } from '../src/modules/orders/orders.pricing';
import { transitionOrder } from '../src/modules/orders/orders.service';
import type { TransitionActor } from '../src/modules/orders/orders.types';

const app = createApp();

const usedPhones = new Set<string>();
let phoneCounter = 0;

function nextPhone(): string {
  phoneCounter += 1;
  const phone = `+2217${String(77_000_000 + phoneCounter)}`;
  usedPhones.add(phone);
  return phone;
}

function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function createUser(fullName: string): Promise<{ token: string; userId: string }> {
  const phone = nextPhone();
  await request(app).post('/auth/request-otp').send({ phone });
  const res = await request(app)
    .post('/auth/verify-otp')
    .send({ phone, code: otpCapture.code, full_name: fullName });
  return { token: res.body.token as string, userId: res.body.user.id as string };
}

async function createSeller(verified = true): Promise<{ token: string; userId: string }> {
  const account = await createUser('Vendeur Commandes');
  await request(app)
    .post('/sellers/profile')
    .set(authHeader(account.token))
    .send({ shop_name: 'Poissonnerie Commandes', zone: 'Dakar' });
  if (verified) {
    await pool.query("UPDATE seller_profiles SET status = 'verified' WHERE user_id = $1", [account.userId]);
  }
  return account;
}

interface ListingOptions {
  quantity?: number;
  minOrder?: number;
  price?: number;
  status?: string;
}

async function insertListing(sellerId: string, options: ListingOptions = {}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO listings
       (seller_id, species_id, title, state, caught_or_frozen_on, storage_conditions,
        quantity_kg, min_order_kg, price_per_kg, zone, status)
     VALUES ($1, $2, 'Lot de thiof', 'fresh', CURRENT_DATE, 'glace', $3, $4, $5, 'Dakar', $6)
     RETURNING id`,
    [
      sellerId,
      thiofId,
      options.quantity ?? 50,
      options.minOrder ?? 1,
      options.price ?? 3000,
      options.status ?? 'active',
    ],
  );
  return result.rows[0].id;
}

function orderBody(listingId: string, quantityKg: number): Record<string, unknown> {
  return { listing_id: listingId, quantity_kg: quantityKg, delivery_address: 'Rue 10', delivery_zone: 'Dakar' };
}

function buyerActor(userId: string): TransitionActor {
  return { kind: 'user', id: userId, isAdmin: false, isSeller: false, isBuyer: true };
}

function adminActor(userId: string): TransitionActor {
  return { kind: 'user', id: userId, isAdmin: true, isSeller: false, isBuyer: true };
}

async function listingQuantity(listingId: string): Promise<number> {
  const res = await pool.query<{ quantity_kg: string }>('SELECT quantity_kg FROM listings WHERE id = $1', [
    listingId,
  ]);
  return Number(res.rows[0].quantity_kg);
}

// Amene une commande a un statut donne en court-circuitant le paiement (etape 7).
async function setStatus(orderId: string, status: string): Promise<void> {
  await transitionOrder(orderId, status as never, { kind: 'system' });
}

let thiofId: number;

beforeAll(async () => {
  const result = await pool.query<{ id: number }>("SELECT id FROM species WHERE name_fr = 'Thiof'");
  thiofId = result.rows[0].id;
});

afterAll(async () => {
  const phones = [...usedPhones];
  if (phones.length > 0) {
    const users = await pool.query<{ id: string }>('SELECT id FROM users WHERE phone = ANY($1::text[])', [phones]);
    const userIds = users.rows.map((row) => row.id);
    if (userIds.length > 0) {
      await pool.query('DELETE FROM orders WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])', [
        userIds,
      ]);
      await pool.query('DELETE FROM listings WHERE seller_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM seller_profiles WHERE user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    }
    await pool.query('DELETE FROM otp_codes WHERE phone = ANY($1::text[])', [phones]);
  }
  await closePool();
  // Dossier d uploads partage par les tests executes en parallele :
  // on tolere une suppression concurrente (ENOTEMPTY).
  await rm(path.resolve('./.test-uploads'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
    () => undefined,
  );
});

describe('POST /orders', () => {
  it('cree une commande en attente de paiement avec les montants calcules', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur 1');
    const listingId = await insertListing(seller.userId, { quantity: 50, price: 3500 });

    const res = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 10));

    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({
      status: 'pending_payment',
      quantityKg: 10,
      unitPrice: 3500,
      subtotal: 35000,
      commissionRateBps: 600,
      commissionAmount: 2100,
      totalAmount: 35000,
      sellerPayout: 32900,
      role: 'buyer',
    });
    expect(res.body.order.history).toHaveLength(1);
    expect(res.body.order.history[0]).toMatchObject({ fromStatus: null, toStatus: 'pending_payment' });
  });

  it('decremente le stock de l annonce dans la meme transaction', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur 2');
    const listingId = await insertListing(seller.userId, { quantity: 20 });

    await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 6));

    expect(await listingQuantity(listingId)).toBe(14);
  });

  it('arrondit les montants a l entier FCFA', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur 3');
    const listingId = await insertListing(seller.userId, { quantity: 10, minOrder: 0.5, price: 3333 });

    const res = await request(app)
      .post('/orders')
      .set(authHeader(buyer.token))
      .send(orderBody(listingId, 0.5));

    expect(res.status).toBe(201);
    // 0,5 x 3333 = 1666,5 -> 1667 ; commission 6 % = 100,02 -> 100.
    expect(res.body.order).toMatchObject({ subtotal: 1667, commissionAmount: 100, sellerPayout: 1567 });
  });

  it('refuse une quantite inferieure a la commande minimum', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur 4');
    const listingId = await insertListing(seller.userId, { quantity: 50, minOrder: 5 });

    const res = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 2));

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/minimum de commande/i);
  });

  it('refuse une quantite superieure au stock disponible', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur 5');
    const listingId = await insertListing(seller.userId, { quantity: 3, minOrder: 1 });

    const res = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 5));

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/insuffisante/i);
  });

  it('refuse de commander sa propre annonce', async () => {
    const seller = await createSeller();
    const listingId = await insertListing(seller.userId, { quantity: 10 });

    const res = await request(app).post('/orders').set(authHeader(seller.token)).send(orderBody(listingId, 2));

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/votre propre annonce/i);
  });

  it('refuse une annonce non active', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur 6');
    const listingId = await insertListing(seller.userId, { quantity: 10, status: 'draft' });

    const res = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 2));

    expect(res.status).toBe(400);
  });

  it('passe l annonce en sold_out quand le stock tombe a zero', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur 7');
    const listingId = await insertListing(seller.userId, { quantity: 4, minOrder: 1 });

    await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 4));

    const res = await pool.query<{ status: string }>('SELECT status FROM listings WHERE id = $1', [listingId]);
    expect(res.rows[0].status).toBe('sold_out');
  });

  it('n accepte qu une seule des deux commandes simultanees sur la derniere quantite', async () => {
    const seller = await createSeller();
    const first = await createUser('Acheteur 8a');
    const second = await createUser('Acheteur 8b');
    const listingId = await insertListing(seller.userId, { quantity: 5, minOrder: 1 });

    const [a, b] = await Promise.all([
      request(app).post('/orders').set(authHeader(first.token)).send(orderBody(listingId, 3)),
      request(app).post('/orders').set(authHeader(second.token)).send(orderBody(listingId, 3)),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]);
    expect(await listingQuantity(listingId)).toBe(2);
  });

  it('exige une authentification', async () => {
    const seller = await createSeller();
    const listingId = await insertListing(seller.userId, { quantity: 10 });

    const res = await request(app).post('/orders').send(orderBody(listingId, 2));
    expect(res.status).toBe(401);
  });
});

describe('transitions autorisees', () => {
  it('pending_payment -> paid (systeme) puis paid -> shipped (vendeur) -> delivered (vendeur)', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur T1');
    const listingId = await insertListing(seller.userId, { quantity: 20 });
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 5));
    const orderId = created.body.order.id as string;

    await setStatus(orderId, 'paid');

    const shipped = await request(app).post(`/orders/${orderId}/ship`).set(authHeader(seller.token));
    expect(shipped.status).toBe(200);
    expect(shipped.body.order.status).toBe('shipped');

    const delivered = await request(app).post(`/orders/${orderId}/deliver`).set(authHeader(seller.token));
    expect(delivered.status).toBe(200);
    expect(delivered.body.order.status).toBe('delivered');
    expect(delivered.body.order.autoReleaseAt).not.toBeNull();
  });

  it('delivered -> confirmed (acheteur) puis confirmed -> released (systeme)', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur T2');
    const listingId = await insertListing(seller.userId, { quantity: 20 });
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 5));
    const orderId = created.body.order.id as string;

    await setStatus(orderId, 'paid');
    await transitionOrder(orderId, 'shipped', { kind: 'user', id: seller.userId, isAdmin: false, isSeller: true, isBuyer: false });
    await transitionOrder(orderId, 'delivered', { kind: 'user', id: seller.userId, isAdmin: false, isSeller: true, isBuyer: false });

    const confirmed = await transitionOrder(orderId, 'confirmed', buyerActor(buyer.userId));
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.buyerConfirmedAt).not.toBeNull();

    const released = await transitionOrder(orderId, 'released', { kind: 'system' });
    expect(released.status).toBe('released');
    expect(released.releasedAt).not.toBeNull();
  });

  it('disputed -> released (admin)', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur T3');
    const admin = await createUser('Admin T3');
    await pool.query('UPDATE users SET is_admin = TRUE WHERE id = $1', [admin.userId]);
    const listingId = await insertListing(seller.userId, { quantity: 20 });
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 5));
    const orderId = created.body.order.id as string;

    await setStatus(orderId, 'paid');
    await transitionOrder(orderId, 'shipped', { kind: 'user', id: seller.userId, isAdmin: false, isSeller: true, isBuyer: false });
    await transitionOrder(orderId, 'delivered', { kind: 'user', id: seller.userId, isAdmin: false, isSeller: true, isBuyer: false });
    await transitionOrder(orderId, 'disputed', buyerActor(buyer.userId));

    const released = await transitionOrder(orderId, 'released', adminActor(admin.userId));
    expect(released.status).toBe('released');
  });
});

describe('transitions interdites et droits', () => {
  it('refuse un acheteur qui tente d expedier', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur D1');
    const listingId = await insertListing(seller.userId, { quantity: 20 });
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 5));
    const orderId = created.body.order.id as string;
    await setStatus(orderId, 'paid');

    const res = await request(app).post(`/orders/${orderId}/ship`).set(authHeader(buyer.token));
    expect(res.status).toBe(403);
  });

  it('refuse une transition inconnue (shipped -> paid)', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur D2');
    const listingId = await insertListing(seller.userId, { quantity: 20 });
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 5));
    const orderId = created.body.order.id as string;
    await setStatus(orderId, 'paid');
    await transitionOrder(orderId, 'shipped', { kind: 'user', id: seller.userId, isAdmin: false, isSeller: true, isBuyer: false });

    await expect(
      transitionOrder(orderId, 'paid', { kind: 'system' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuse un acteur etranger a la commande', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur D3');
    const stranger = await createUser('Etranger D3');
    const listingId = await insertListing(seller.userId, { quantity: 20 });
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 5));
    const orderId = created.body.order.id as string;

    await expect(transitionOrder(orderId, 'cancelled', buyerActor(stranger.userId))).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('refuse un litige apres le delai de 48 heures', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur D4');
    const listingId = await insertListing(seller.userId, { quantity: 20 });
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 5));
    const orderId = created.body.order.id as string;

    await setStatus(orderId, 'paid');
    await transitionOrder(orderId, 'shipped', { kind: 'user', id: seller.userId, isAdmin: false, isSeller: true, isBuyer: false });
    await transitionOrder(orderId, 'delivered', { kind: 'user', id: seller.userId, isAdmin: false, isSeller: true, isBuyer: false });
    await pool.query("UPDATE orders SET auto_release_at = now() - interval '1 hour' WHERE id = $1", [orderId]);

    await expect(transitionOrder(orderId, 'disputed', buyerActor(buyer.userId))).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('annulation', () => {
  it('annule une commande impayee et remet la quantite en stock', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur C1');
    const listingId = await insertListing(seller.userId, { quantity: 10 });
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 4));
    const orderId = created.body.order.id as string;
    expect(await listingQuantity(listingId)).toBe(6);

    const res = await request(app).post(`/orders/${orderId}/cancel`).set(authHeader(buyer.token));

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('cancelled');
    expect(await listingQuantity(listingId)).toBe(10);
  });

  it('refuse au vendeur d annuler la commande de l acheteur', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur C2');
    const listingId = await insertListing(seller.userId, { quantity: 10 });
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 2));
    const orderId = created.body.order.id as string;

    const res = await request(app).post(`/orders/${orderId}/cancel`).set(authHeader(seller.token));
    expect(res.status).toBe(403);
  });

  it('refuse d annuler une commande deja expediee', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur C3');
    const listingId = await insertListing(seller.userId, { quantity: 10 });
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 2));
    const orderId = created.body.order.id as string;
    await setStatus(orderId, 'paid');
    await transitionOrder(orderId, 'shipped', { kind: 'user', id: seller.userId, isAdmin: false, isSeller: true, isBuyer: false });

    const res = await request(app).post(`/orders/${orderId}/cancel`).set(authHeader(buyer.token));
    expect(res.status).toBe(409);
  });
});

describe('GET /orders', () => {
  it('liste les commandes de l acheteur et du vendeur', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur L1');
    const listingId = await insertListing(seller.userId, { quantity: 10 });
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 2));
    const orderId = created.body.order.id as string;

    const buyerList = await request(app).get('/orders').set(authHeader(buyer.token));
    expect(buyerList.status).toBe(200);
    expect(buyerList.body.orders.map((o: { id: string }) => o.id)).toContain(orderId);
    expect(buyerList.body.orders[0].role).toBe('buyer');

    const sellerList = await request(app).get('/orders').set(authHeader(seller.token));
    expect(sellerList.body.orders.map((o: { id: string }) => o.id)).toContain(orderId);
    const found = sellerList.body.orders.find((o: { id: string }) => o.id === orderId);
    expect(found.role).toBe('seller');
  });

  it('renvoie le detail avec l historique et bloque un tiers', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur L2');
    const stranger = await createUser('Etranger L2');
    const listingId = await insertListing(seller.userId, { quantity: 10 });
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 2));
    const orderId = created.body.order.id as string;

    const detail = await request(app).get(`/orders/${orderId}`).set(authHeader(buyer.token));
    expect(detail.status).toBe(200);
    expect(detail.body.order.history).toHaveLength(1);

    const forbidden = await request(app).get(`/orders/${orderId}`).set(authHeader(stranger.token));
    expect(forbidden.status).toBe(404);
  });
});

describe('tache planifiee', () => {
  it('annule les commandes impayees au-dela de 30 minutes et remet le stock', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur S1');
    const listingId = await insertListing(seller.userId, { quantity: 10 });
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 3));
    const orderId = created.body.order.id as string;
    await pool.query("UPDATE orders SET created_at = now() - interval '31 minutes' WHERE id = $1", [orderId]);

    const cancelled = await cancelExpiredPendingOrders();

    expect(cancelled).toBeGreaterThanOrEqual(1);
    const order = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
    expect(order.rows[0].status).toBe('cancelled');
    expect(await listingQuantity(listingId)).toBe(10);
  });

  it('ne touche pas une commande recente', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur S2');
    const listingId = await insertListing(seller.userId, { quantity: 10 });
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 3));
    const orderId = created.body.order.id as string;

    await cancelExpiredPendingOrders();

    const order = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
    expect(order.rows[0].status).toBe('pending_payment');
  });

  it('libere automatiquement les commandes livrees dont auto_release_at est depasse', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur S3');
    const listingId = await insertListing(seller.userId, { quantity: 10 });
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 3));
    const orderId = created.body.order.id as string;

    await setStatus(orderId, 'paid');
    await transitionOrder(orderId, 'shipped', { kind: 'user', id: seller.userId, isAdmin: false, isSeller: true, isBuyer: false });
    await transitionOrder(orderId, 'delivered', { kind: 'user', id: seller.userId, isAdmin: false, isSeller: true, isBuyer: false });
    await pool.query("UPDATE orders SET auto_release_at = now() - interval '1 hour' WHERE id = $1", [orderId]);

    const released = await releaseDeliveredOrders();

    expect(released).toBeGreaterThanOrEqual(1);
    const order = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
    expect(order.rows[0].status).toBe('released');
  });
});

describe('calcul des montants (unitaire)', () => {
  it('arrondit le sous-total, la commission et le payout au FCFA', () => {
    expect(computeOrderAmounts(0.5, 3333, 0, 600)).toEqual({
      subtotal: 1667,
      commissionRateBps: 600,
      commissionAmount: 100,
      totalAmount: 1667,
      sellerPayout: 1567,
    });
    expect(computeOrderAmounts(1, 100, 0, 600)).toMatchObject({ commissionAmount: 6, sellerPayout: 94 });
    expect(computeOrderAmounts(3, 3500, 500, 300)).toMatchObject({
      subtotal: 10500,
      commissionAmount: 315,
      totalAmount: 11000,
      sellerPayout: 10185,
    });
  });
});
