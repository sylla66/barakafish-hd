import { rm } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';
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
import { transitionOrder } from '../src/modules/orders/orders.service';
import type { TransitionActor } from '../src/modules/orders/orders.types';

const app = createApp();

const usedPhones = new Set<string>();
let phoneCounter = 0;

function nextPhone(): string {
  phoneCounter += 1;
  const phone = `+2217${String(79_000_000 + phoneCounter)}`;
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
  const account = await createUser('Vendeur Avis');
  await request(app)
    .post('/sellers/profile')
    .set(authHeader(account.token))
    .send({ shop_name: 'Poissonnerie Avis', zone: 'Dakar' });
  if (verified) {
    await pool.query("UPDATE seller_profiles SET status = 'verified' WHERE user_id = $1", [account.userId]);
  }
  return account;
}

async function insertListing(sellerId: string, quantity = 50): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO listings
       (seller_id, species_id, title, state, caught_or_frozen_on, storage_conditions,
        quantity_kg, min_order_kg, price_per_kg, zone, status)
     VALUES ($1, $2, 'Lot de thiof', 'fresh', CURRENT_DATE, 'glace', $3, 1, 3000, 'Dakar', 'active')
     RETURNING id`,
    [sellerId, thiofId, quantity],
  );
  return result.rows[0].id;
}

function orderBody(listingId: string, quantityKg: number): Record<string, unknown> {
  return { listing_id: listingId, quantity_kg: quantityKg, delivery_address: 'Rue 10', delivery_zone: 'Dakar' };
}

function buyerActor(userId: string): TransitionActor {
  return { kind: 'user', id: userId, isAdmin: false, isSeller: false, isBuyer: true };
}

function sellerActor(userId: string, isSeller = true): TransitionActor {
  return { kind: 'user', id: userId, isAdmin: false, isSeller, isBuyer: false };
}

async function testImage(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 180, b: 90 } } })
    .png()
    .toBuffer();
}

// Cree une commande livree (paid -> shipped -> delivered) prete a etre confirmee.
async function setupDeliveredOrder(): Promise<{
  seller: { token: string; userId: string };
  buyer: { token: string; userId: string };
  orderId: string;
}> {
  const seller = await createSeller();
  const buyer = await createUser('Acheteur Avis');
  const listingId = await insertListing(seller.userId);
  const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 5));
  const orderId = created.body.order.id as string;

  await transitionOrder(orderId, 'paid', { kind: 'system' });
  await transitionOrder(orderId, 'shipped', sellerActor(seller.userId));
  await transitionOrder(orderId, 'delivered', sellerActor(seller.userId));

  return { seller, buyer, orderId };
}

async function confirmOrder(orderId: string, buyerId: string): Promise<void> {
  await transitionOrder(orderId, 'confirmed', buyerActor(buyerId));
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
      await pool.query('DELETE FROM reviews WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM orders WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])', [userIds]);
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

describe('POST /orders/:id/confirm-receipt', () => {
  it('confirme la reception avec photo et libere immediatement les fonds', async () => {
    const { buyer, orderId } = await setupDeliveredOrder();
    const image = await testImage();

    const res = await request(app)
      .post(`/orders/${orderId}/confirm-receipt`)
      .set(authHeader(buyer.token))
      .attach('photo', image, { filename: 'reception.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('released');
    expect(res.body.order.buyerConfirmedAt).not.toBeNull();
    expect(res.body.order.releasedAt).not.toBeNull();
    expect(res.body.order.receiptPhotoUrl).toBe(`/orders/${orderId}/receipt-photo`);

    const photo = await request(app)
      .get(`/orders/${orderId}/receipt-photo`)
      .set(authHeader(buyer.token));
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toMatch(/image\/jpeg/);
  });

  it('confirme la reception sans photo', async () => {
    const { buyer, orderId } = await setupDeliveredOrder();

    const res = await request(app)
      .post(`/orders/${orderId}/confirm-receipt`)
      .set(authHeader(buyer.token));

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('released');
    expect(res.body.order.receiptPhotoUrl).toBeNull();
  });

  it('refuse la confirmation avant la livraison', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur CR1');
    const listingId = await insertListing(seller.userId);
    const created = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 5));
    const orderId = created.body.order.id as string;

    const res = await request(app)
      .post(`/orders/${orderId}/confirm-receipt`)
      .set(authHeader(buyer.token));

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/livraison/i);
  });

  it('refuse la confirmation par le vendeur', async () => {
    const { seller, orderId } = await setupDeliveredOrder();

    const res = await request(app)
      .post(`/orders/${orderId}/confirm-receipt`)
      .set(authHeader(seller.token));

    expect(res.status).toBe(403);
  });

  it('refuse la confirmation par un tiers', async () => {
    const { orderId } = await setupDeliveredOrder();
    const stranger = await createUser('Etranger CR');

    const res = await request(app)
      .post(`/orders/${orderId}/confirm-receipt`)
      .set(authHeader(stranger.token));

    expect(res.status).toBe(403);
  });
});

describe('POST /orders/:id/review', () => {
  it('accepte un avis sur une commande confirmee avec photo et commentaire', async () => {
    const { buyer, seller, orderId } = await setupDeliveredOrder();
    await confirmOrder(orderId, buyer.userId);
    const image = await testImage();

    const res = await request(app)
      .post(`/orders/${orderId}/review`)
      .set(authHeader(buyer.token))
      .field('rating', '5')
      .field('comment', 'Produit tres frais, livraison rapide.')
      .attach('photo', image, { filename: 'avis.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.review).toMatchObject({
      orderId,
      sellerId: seller.userId,
      rating: 5,
      comment: 'Produit tres frais, livraison rapide.',
      buyerName: 'Acheteur Avis',
    });
    expect(res.body.review.photoUrl).toBe(`/reviews/${res.body.review.id}/photo`);

    const photo = await request(app).get(`/reviews/${res.body.review.id}/photo`);
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toMatch(/image\/jpeg/);
  });

  it('accepte un avis sur une commande dont les fonds sont deja liberes', async () => {
    const { buyer, orderId } = await setupDeliveredOrder();
    await confirmOrder(orderId, buyer.userId);
    await transitionOrder(orderId, 'released', { kind: 'system' });

    const res = await request(app)
      .post(`/orders/${orderId}/review`)
      .set(authHeader(buyer.token))
      .field('rating', '4');

    expect(res.status).toBe(201);
    expect(res.body.review.rating).toBe(4);
    expect(res.body.review.comment).toBeNull();
  });

  it('refuse un avis avant la confirmation de reception', async () => {
    const { buyer, orderId } = await setupDeliveredOrder();

    const res = await request(app)
      .post(`/orders/${orderId}/review`)
      .set(authHeader(buyer.token))
      .field('rating', '5');

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/reception confirmee/i);
  });

  it('refuse un deuxieme avis sur la meme commande', async () => {
    const { buyer, orderId } = await setupDeliveredOrder();
    await confirmOrder(orderId, buyer.userId);

    const first = await request(app)
      .post(`/orders/${orderId}/review`)
      .set(authHeader(buyer.token))
      .field('rating', '5');
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/orders/${orderId}/review`)
      .set(authHeader(buyer.token))
      .field('rating', '1');

    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/deja/i);
  });

  it('refuse un avis laisse par un autre acheteur', async () => {
    const { buyer, orderId } = await setupDeliveredOrder();
    await confirmOrder(orderId, buyer.userId);
    const other = await createUser('Autre Acheteur');

    const res = await request(app)
      .post(`/orders/${orderId}/review`)
      .set(authHeader(other.token))
      .field('rating', '5');

    expect(res.status).toBe(403);
  });

  it('refuse une note hors bornes', async () => {
    const { buyer, orderId } = await setupDeliveredOrder();
    await confirmOrder(orderId, buyer.userId);

    const tooHigh = await request(app)
      .post(`/orders/${orderId}/review`)
      .set(authHeader(buyer.token))
      .field('rating', '6');
    expect(tooHigh.status).toBe(422);

    const tooLow = await request(app)
      .post(`/orders/${orderId}/review`)
      .set(authHeader(buyer.token))
      .field('rating', '0');
    expect(tooLow.status).toBe(422);
  });

  it('refuse un commentaire de plus de 500 caracteres', async () => {
    const { buyer, orderId } = await setupDeliveredOrder();
    await confirmOrder(orderId, buyer.userId);

    const res = await request(app)
      .post(`/orders/${orderId}/review`)
      .set(authHeader(buyer.token))
      .field('rating', '5')
      .field('comment', 'a'.repeat(501));

    expect(res.status).toBe(422);
  });

  it('recalcule la note moyenne et le nombre d avis du vendeur', async () => {
    const seller = await createSeller();
    const buyerA = await createUser('Acheteur Note A');
    const buyerB = await createUser('Acheteur Note B');

    const listingA = await insertListing(seller.userId);
    const orderARes = await request(app).post('/orders').set(authHeader(buyerA.token)).send(orderBody(listingA, 3));
    const orderA = orderARes.body.order.id as string;
    await transitionOrder(orderA, 'paid', { kind: 'system' });
    await transitionOrder(orderA, 'shipped', sellerActor(seller.userId));
    await transitionOrder(orderA, 'delivered', sellerActor(seller.userId));
    await confirmOrder(orderA, buyerA.userId);

    const listingB = await insertListing(seller.userId);
    const orderBRes = await request(app).post('/orders').set(authHeader(buyerB.token)).send(orderBody(listingB, 3));
    const orderB = orderBRes.body.order.id as string;
    await transitionOrder(orderB, 'paid', { kind: 'system' });
    await transitionOrder(orderB, 'shipped', sellerActor(seller.userId));
    await transitionOrder(orderB, 'delivered', sellerActor(seller.userId));
    await confirmOrder(orderB, buyerB.userId);

    await request(app).post(`/orders/${orderA}/review`).set(authHeader(buyerA.token)).field('rating', '5');
    await request(app).post(`/orders/${orderB}/review`).set(authHeader(buyerB.token)).field('rating', '3');

    const profile = await request(app).get(`/sellers/${seller.userId}`);
    expect(profile.status).toBe(200);
    expect(profile.body.profile.ratingAvg).toBe(4);
    expect(profile.body.profile.ratingCount).toBe(2);

    const list = await request(app).get(`/sellers/${seller.userId}/reviews`);
    expect(list.status).toBe(200);
    expect(list.body.reviews).toHaveLength(2);
  });
});

describe('GET /sellers/:id/reviews', () => {
  it('pagine les avis d un vendeur par curseur', async () => {
    const seller = await createSeller();
    const created: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const buyer = await createUser(`Acheteur Page ${i}`);
      const listingId = await insertListing(seller.userId);
      const orderRes = await request(app).post('/orders').set(authHeader(buyer.token)).send(orderBody(listingId, 2));
      const orderId = orderRes.body.order.id as string;
      await transitionOrder(orderId, 'paid', { kind: 'system' });
      await transitionOrder(orderId, 'shipped', sellerActor(seller.userId));
      await transitionOrder(orderId, 'delivered', sellerActor(seller.userId));
      await confirmOrder(orderId, buyer.userId);
      const review = await request(app)
        .post(`/orders/${orderId}/review`)
        .set(authHeader(buyer.token))
        .field('rating', '5');
      created.push(review.body.review.id as string);
    }

    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const query: Record<string, string | number> = { limit: 2 };
      if (cursor) query.cursor = cursor;
      const res = await request(app).get(`/sellers/${seller.userId}/reviews`).query(query);
      expect(res.status).toBe(200);
      for (const review of res.body.reviews as Array<{ id: string }>) {
        seen.add(review.id);
      }
      cursor = res.body.next_cursor as string | null;
      if (!cursor) break;
    }

    expect(seen.size).toBe(3);
    expect([...created].every((id) => seen.has(id))).toBe(true);
  });

  it('renvoie 404 pour un vendeur inconnu', async () => {
    const res = await request(app).get('/sellers/00000000-0000-0000-0000-000000000000/reviews');
    expect(res.status).toBe(404);
  });
});
