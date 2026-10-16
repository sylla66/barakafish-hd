import { createHmac } from 'node:crypto';
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
import { env } from '../src/config/env';
import { closePool, pool } from '../src/db/pool';

const app = createApp();

const usedPhones = new Set<string>();
const createdUserIds = new Set<string>();
let phoneCounter = 0;

// Plage de telephones dediee a ce fichier (vitest execute les fichiers en parallele).
function nextPhone(): string {
  phoneCounter += 1;
  const phone = `+2217${String(75_000_000 + phoneCounter)}`;
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
  const userId = res.body.user.id as string;
  createdUserIds.add(userId);
  return { token: res.body.token as string, userId };
}

async function createAdmin(): Promise<{ token: string; userId: string }> {
  const account = await createUser('Admin Litiges');
  await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [account.userId]);
  return account;
}

async function createSeller(): Promise<{ token: string; userId: string }> {
  const account = await createUser('Vendeur Litiges');
  await request(app)
    .post('/sellers/profile')
    .set(authHeader(account.token))
    .send({ shop_name: 'Poissonnerie Litiges', zone: 'Dakar' });
  await pool.query("UPDATE seller_profiles SET status = 'verified' WHERE user_id = $1", [account.userId]);
  return account;
}

async function insertListing(sellerId: string, quantity: number, price: number): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO listings
       (seller_id, species_id, title, state, caught_or_frozen_on, storage_conditions,
        quantity_kg, min_order_kg, price_per_kg, zone, status)
     VALUES ($1, $2, 'Lot de thiof', 'fresh', CURRENT_DATE, 'glace', $3, 1, $4, 'Dakar', 'active')
     RETURNING id`,
    [sellerId, thiofId, quantity, price],
  );
  return result.rows[0].id;
}

interface OrderSummary {
  id: string;
  totalAmount: number;
  subtotal: number;
  sellerPayout: number;
  commissionAmount: number;
}

async function createOrder(buyerToken: string, listingId: string, quantityKg: number): Promise<OrderSummary> {
  const res = await request(app)
    .post('/orders')
    .set(authHeader(buyerToken))
    .send({ listing_id: listingId, quantity_kg: quantityKg, delivery_address: 'Rue 10', delivery_zone: 'Dakar' });
  return res.body.order;
}

async function payOrder(buyerToken: string, orderId: string, totalAmount: number): Promise<void> {
  const initiated = await request(app).post(`/orders/${orderId}/pay`).set(authHeader(buyerToken)).send({});
  const reference = initiated.body.payment.providerReference as string;

  const payload = JSON.stringify({
    provider_reference: reference,
    status: 'succeeded',
    amount: totalAmount,
  });
  const signature = createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET).update(payload).digest('hex');
  await request(app)
    .post('/webhooks/payment')
    .set('Content-Type', 'application/json')
    .set('x-signature', signature)
    .send(payload);
}

async function toDelivered(orderId: string, sellerToken: string): Promise<void> {
  await request(app).post(`/orders/${orderId}/ship`).set(authHeader(sellerToken)).send();
  await request(app).post(`/orders/${orderId}/deliver`).set(authHeader(sellerToken)).send();
}

async function testImage(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .png()
    .toBuffer();
}

async function openDispute(
  buyerToken: string,
  orderId: string,
  overrides: { reason?: string; description?: string; withPhoto?: boolean } = {},
) {
  const req = request(app).post(`/orders/${orderId}/dispute`).set(authHeader(buyerToken));
  req.field('reason', overrides.reason ?? 'produit_avarie');
  req.field('description', overrides.description ?? 'Le poisson recu etait avarie et non conforme.');
  if (overrides.withPhoto !== false) {
    req.attach('photo', await testImage(), { filename: 'litige.png', contentType: 'image/png' });
  }
  return req;
}

async function paymentsOf(orderId: string): Promise<Record<string, unknown>[]> {
  const res = await pool.query('SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at', [orderId]);
  return res.rows;
}

async function payoutOf(orderId: string): Promise<Record<string, unknown> | null> {
  const res = await pool.query('SELECT * FROM payouts WHERE order_id = $1', [orderId]);
  return res.rows[0] ?? null;
}

async function orderStatus(orderId: string): Promise<string> {
  const res = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
  return res.rows[0].status;
}

// Cree une commande livree et payee, prete a recevoir un litige.
async function setupDeliveredPaidOrder(): Promise<{
  seller: { token: string; userId: string };
  buyer: { token: string; userId: string };
  order: OrderSummary;
}> {
  const seller = await createSeller();
  const buyer = await createUser('Acheteur Litige');
  const listingId = await insertListing(seller.userId, 50, 3000);
  const order = await createOrder(buyer.token, listingId, 5);
  await payOrder(buyer.token, order.id, order.totalAmount);
  await toDelivered(order.id, seller.token);
  return { seller, buyer, order };
}

let thiofId: number;

beforeAll(async () => {
  const result = await pool.query<{ id: number }>("SELECT id FROM species WHERE name_fr = 'Thiof'");
  thiofId = result.rows[0].id;
});

afterAll(async () => {
  const userIds = [...createdUserIds];
  if (userIds.length > 0) {
    const orders = await pool.query<{ id: string }>(
      'SELECT id FROM orders WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])',
      [userIds],
    );
    const orderIds = orders.rows.map((row) => row.id);
    await pool.query('DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
    if (orderIds.length > 0) {
      await pool.query('DELETE FROM disputes WHERE order_id = ANY($1::uuid[])', [orderIds]);
      await pool.query('DELETE FROM payouts WHERE order_id = ANY($1::uuid[])', [orderIds]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1::uuid[])', [orderIds]);
    }
    await pool.query('DELETE FROM orders WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])', [
      userIds,
    ]);
    await pool.query('DELETE FROM listings WHERE seller_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM seller_profiles WHERE user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  }
  const phones = [...usedPhones];
  if (phones.length > 0) {
    await pool.query('DELETE FROM otp_codes WHERE phone = ANY($1::text[])', [phones]);
  }
  await closePool();
  await rm(path.resolve('./.test-uploads'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
    () => undefined,
  );
});

describe('POST /orders/:id/dispute', () => {
  it('ouvre un litige sur une commande livree et suspend la liberation', async () => {
    const { buyer, order } = await setupDeliveredPaidOrder();

    const res = await openDispute(buyer.token, order.id);

    expect(res.status).toBe(201);
    expect(res.body.dispute).toMatchObject({
      orderId: order.id,
      reason: 'produit_avarie',
      status: 'open',
      refundAmount: null,
    });
    expect(res.body.dispute.evidence).toHaveLength(1);
    expect(res.body.dispute.evidence[0].photoUrl).toMatch(/\/disputes\/evidence\/.+\/photo/);
    expect(await orderStatus(order.id)).toBe('disputed');
    // Aucun versement tant que le litige n'est pas tranche.
    expect(await payoutOf(order.id)).toBeNull();

    const fetched = await request(app).get(`/orders/${order.id}/dispute`).set(authHeader(buyer.token));
    expect(fetched.status).toBe(200);
    expect(fetched.body.dispute.id).toBe(res.body.dispute.id);
  });

  it('accepte un litige des l expedition (avant livraison)', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Shipped');
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    await payOrder(buyer.token, order.id, order.totalAmount);
    await request(app).post(`/orders/${order.id}/ship`).set(authHeader(seller.token)).send();

    const res = await openDispute(buyer.token, order.id);
    expect(res.status).toBe(201);
    expect(await orderStatus(order.id)).toBe('disputed');
  });

  it('refuse un litige hors delai (48 h apres livraison)', async () => {
    const { buyer, order } = await setupDeliveredPaidOrder();
    await pool.query("UPDATE orders SET auto_release_at = now() - interval '1 hour' WHERE id = $1", [order.id]);

    const res = await openDispute(buyer.token, order.id);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/delai/i);
    expect(await orderStatus(order.id)).toBe('delivered');
  });

  it('refuse un litige avant l expedition', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Paid');
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    await payOrder(buyer.token, order.id, order.totalAmount);

    const res = await openDispute(buyer.token, order.id);
    expect(res.status).toBe(409);
  });

  it('refuse un litige sans photo', async () => {
    const { buyer, order } = await setupDeliveredPaidOrder();

    const res = await openDispute(buyer.token, order.id, { withPhoto: false });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/photo/i);
  });

  it('refuse un litige ouvert par un tiers', async () => {
    const { order } = await setupDeliveredPaidOrder();
    const stranger = await createUser('Etranger Litige');

    const res = await openDispute(stranger.token, order.id);
    expect(res.status).toBe(403);
  });
});

describe('POST /disputes/:id/evidence', () => {
  it('permet au vendeur puis a l acheteur d ajouter des preuves', async () => {
    const { seller, buyer, order } = await setupDeliveredPaidOrder();
    const created = await openDispute(buyer.token, order.id);
    const disputeId = created.body.dispute.id as string;

    const sellerEvidence = await request(app)
      .post(`/disputes/${disputeId}/evidence`)
      .set(authHeader(seller.token))
      .field('message', 'La marchandise etait fraiche au depart.')
      .attach('photo', await testImage(), { filename: 'preuve.png', contentType: 'image/png' });

    expect(sellerEvidence.status).toBe(201);
    expect(sellerEvidence.body.evidence).toMatchObject({
      authorRole: 'seller',
      message: 'La marchandise etait fraiche au depart.',
    });
    expect(sellerEvidence.body.evidence.photoUrl).toMatch(
      /\/disputes\/evidence\/.+\/photo/,
    );

    const buyerEvidence = await request(app)
      .post(`/disputes/${disputeId}/evidence`)
      .set(authHeader(buyer.token))
      .field('message', 'Voici une photo supplementaire.');

    expect(buyerEvidence.status).toBe(201);
    expect(buyerEvidence.body.evidence.authorRole).toBe('buyer');

    const photo = await request(app)
      .get(sellerEvidence.body.evidence.photoUrl as string)
      .set(authHeader(buyer.token));
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toMatch(/image\/jpeg/);
  });

  it('refuse une preuve ajoutee par un tiers', async () => {
    const { buyer, order } = await setupDeliveredPaidOrder();
    const created = await openDispute(buyer.token, order.id);
    const stranger = await createUser('Etranger Preuve');

    const res = await request(app)
      .post(`/disputes/${created.body.dispute.id}/evidence`)
      .set(authHeader(stranger.token))
      .field('message', 'Je ne suis pas concerne.');

    expect(res.status).toBe(403);
  });

  it('refuse une preuve vide (ni message ni photo)', async () => {
    const { buyer, order } = await setupDeliveredPaidOrder();
    const created = await openDispute(buyer.token, order.id);

    const res = await request(app)
      .post(`/disputes/${created.body.dispute.id}/evidence`)
      .set(authHeader(buyer.token));

    expect(res.status).toBe(400);
  });
});

describe('GET /admin/disputes', () => {
  it('liste les litiges filtres par statut et renvoie le detail', async () => {
    const admin = await createAdmin();
    const { buyer, order } = await setupDeliveredPaidOrder();
    const created = await openDispute(buyer.token, order.id);
    const disputeId = created.body.dispute.id as string;

    const list = await request(app).get('/admin/disputes').query({ status: 'open' }).set(authHeader(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.disputes.some((d: { id: string }) => d.id === disputeId)).toBe(true);

    const detail = await request(app).get(`/admin/disputes/${disputeId}`).set(authHeader(admin.token));
    expect(detail.status).toBe(200);
    expect(detail.body.dispute.id).toBe(disputeId);
    expect(detail.body.order.id).toBe(order.id);
    expect(detail.body.orderHistory.length).toBeGreaterThan(0);
    expect(detail.body.sellerHistory).toMatchObject({ windowDays: 30 });

    const forbidden = await request(app).get('/admin/disputes').set(authHeader(buyer.token));
    expect(forbidden.status).toBe(403);
  });
});

describe('POST /admin/disputes/:id/resolve', () => {
  it('rembourse la totalite au titre d une decision refund', async () => {
    const admin = await createAdmin();
    const { buyer, order } = await setupDeliveredPaidOrder();
    const created = await openDispute(buyer.token, order.id);
    const disputeId = created.body.dispute.id as string;

    const res = await request(app)
      .post(`/admin/disputes/${disputeId}/resolve`)
      .set(authHeader(admin.token))
      .send({ decision: 'refund', note: 'Produit avarie confirme.' });

    expect(res.status).toBe(200);
    expect(res.body.dispute.status).toBe('resolved_refund');
    expect(res.body.dispute.refundAmount).toBe(order.totalAmount);
    expect(await orderStatus(order.id)).toBe('refunded');

    const payments = await paymentsOf(order.id);
    expect(payments[0]).toMatchObject({ status: 'refunded', refunded_amount: order.totalAmount });
    expect(await payoutOf(order.id)).toBeNull();
  });

  it('rembourse une partie et libere le reste au vendeur, au franc pres', async () => {
    const admin = await createAdmin();
    const { seller, buyer, order } = await setupDeliveredPaidOrder();
    const created = await openDispute(buyer.token, order.id);
    const disputeId = created.body.dispute.id as string;

    const refund = 5000;
    const res = await request(app)
      .post(`/admin/disputes/${disputeId}/resolve`)
      .set(authHeader(admin.token))
      .send({ decision: 'partial', refund_amount: refund, note: 'Qualite partiellement conforme.' });

    expect(res.status).toBe(200);
    expect(res.body.dispute.status).toBe('resolved_partial');
    expect(res.body.dispute.refundAmount).toBe(refund);
    expect(await orderStatus(order.id)).toBe('released');

    const payments = await paymentsOf(order.id);
    expect(payments[0]).toMatchObject({ status: 'succeeded', refunded_amount: refund });

    const payout = await payoutOf(order.id);
    expect(payout).toMatchObject({
      seller_id: seller.userId,
      amount: order.sellerPayout - refund,
      status: 'sent',
    });
    // Verifications au franc pres : commission inchangee, reste au vendeur.
    expect(order.subtotal).toBe(15000);
    expect(order.commissionAmount).toBe(900);
    expect(order.sellerPayout).toBe(14100);
    expect(payout?.amount).toBe(9100);
  });

  it('libere la totalite au vendeur au titre d une decision release', async () => {
    const admin = await createAdmin();
    const { seller, buyer, order } = await setupDeliveredPaidOrder();
    const created = await openDispute(buyer.token, order.id);
    const disputeId = created.body.dispute.id as string;

    const res = await request(app)
      .post(`/admin/disputes/${disputeId}/resolve`)
      .set(authHeader(admin.token))
      .send({ decision: 'release', note: 'Litige non fonde.' });

    expect(res.status).toBe(200);
    expect(res.body.dispute.status).toBe('resolved_release');
    expect(res.body.dispute.refundAmount).toBeNull();
    expect(await orderStatus(order.id)).toBe('released');

    const payments = await paymentsOf(order.id);
    expect(payments[0]).toMatchObject({ status: 'succeeded', refunded_amount: 0 });

    const payout = await payoutOf(order.id);
    expect(payout).toMatchObject({ seller_id: seller.userId, amount: order.sellerPayout, status: 'sent' });
  });

  it('refuse une decision partielle sans montant', async () => {
    const admin = await createAdmin();
    const { buyer, order } = await setupDeliveredPaidOrder();
    const created = await openDispute(buyer.token, order.id);

    const res = await request(app)
      .post(`/admin/disputes/${created.body.dispute.id}/resolve`)
      .set(authHeader(admin.token))
      .send({ decision: 'partial' });

    expect(res.status).toBe(422);
  });

  it('refuse une seconde decision sur un litige deja resolu', async () => {
    const admin = await createAdmin();
    const { buyer, order } = await setupDeliveredPaidOrder();
    const created = await openDispute(buyer.token, order.id);
    const disputeId = created.body.dispute.id as string;

    await request(app)
      .post(`/admin/disputes/${disputeId}/resolve`)
      .set(authHeader(admin.token))
      .send({ decision: 'release' });

    const again = await request(app)
      .post(`/admin/disputes/${disputeId}/resolve`)
      .set(authHeader(admin.token))
      .send({ decision: 'refund' });

    expect(again.status).toBe(409);
  });
});

describe('Suspension automatique du vendeur', () => {
  it('suspend le vendeur apres 3 litiges fondes et notifie l admin', async () => {
    const admin = await createAdmin();
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Recidive');

    for (let i = 0; i < 3; i += 1) {
      const listingId = await insertListing(seller.userId, 50, 3000);
      const order = await createOrder(buyer.token, listingId, 5);
      await payOrder(buyer.token, order.id, order.totalAmount);
      await toDelivered(order.id, seller.token);
      const created = await openDispute(buyer.token, order.id);
      const res = await request(app)
        .post(`/admin/disputes/${created.body.dispute.id}/resolve`)
        .set(authHeader(admin.token))
        .send({ decision: 'refund' });
      expect(res.status).toBe(200);
    }

    const profile = await pool.query<{ status: string }>(
      'SELECT status FROM seller_profiles WHERE user_id = $1',
      [seller.userId],
    );
    expect(profile.rows[0].status).toBe('suspended');

    const notifications = await pool.query(
      `SELECT * FROM notifications
        WHERE template = 'dispute.seller_suspended' AND payload->>'seller_id' = $1`,
      [seller.userId],
    );
    expect(notifications.rowCount).toBeGreaterThan(0);
    expect(notifications.rows[0]).toMatchObject({ channel: 'push' });
  });
});
