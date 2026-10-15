import { createHmac } from 'node:crypto';
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
import { env } from '../src/config/env';
import { closePool, pool } from '../src/db/pool';
import { mockPaymentControl } from '../src/providers/payment/mock-payment-provider';
import { transitionOrder } from '../src/modules/orders/orders.service';
import type { TransitionActor } from '../src/modules/orders/orders.types';

const app = createApp();

const usedPhones = new Set<string>();
let phoneCounter = 0;

// Plage de telephones dediee a ce fichier (vitest execute les fichiers en parallele).
function nextPhone(): string {
  phoneCounter += 1;
  const phone = `+2217${String(78_000_000 + phoneCounter)}`;
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

async function createAdmin(): Promise<{ token: string; userId: string }> {
  const account = await createUser('Admin Paiements');
  await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [account.userId]);
  return account;
}

async function createSeller(): Promise<{ token: string; userId: string }> {
  const account = await createUser('Vendeur Paiements');
  await request(app)
    .post('/sellers/profile')
    .set(authHeader(account.token))
    .send({ shop_name: 'Poissonnerie Paiements', zone: 'Dakar' });
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

async function createOrder(
  buyerToken: string,
  listingId: string,
  quantityKg: number,
): Promise<{ id: string; totalAmount: number; sellerPayout: number }> {
  const res = await request(app)
    .post('/orders')
    .set(authHeader(buyerToken))
    .send({ listing_id: listingId, quantity_kg: quantityKg, delivery_address: 'Rue 10', delivery_zone: 'Dakar' });
  return res.body.order;
}

async function initiatePayment(
  buyerToken: string,
  orderId: string,
): Promise<{ payment: { id: string; providerReference: string; amount: number; status: string }; paymentUrl: string }> {
  const res = await request(app).post(`/orders/${orderId}/pay`).set(authHeader(buyerToken)).send({});
  return res.body;
}

function signatureOf(raw: string): string {
  return createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET).update(raw).digest('hex');
}

interface WebhookOptions {
  signature?: string | null;
}

async function sendWebhook(payload: Record<string, unknown>, options: WebhookOptions = {}) {
  const raw = JSON.stringify(payload);
  const req = request(app).post('/webhooks/payment').set('Content-Type', 'application/json');
  if (options.signature !== null) {
    req.set('x-signature', options.signature ?? signatureOf(raw));
  }
  return req.send(raw);
}

async function orderStatus(orderId: string): Promise<string> {
  const res = await pool.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
  return res.rows[0].status;
}

async function paymentsOf(orderId: string): Promise<Record<string, unknown>[]> {
  const res = await pool.query('SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at', [orderId]);
  return res.rows;
}

async function payoutOf(orderId: string): Promise<Record<string, unknown> | null> {
  const res = await pool.query('SELECT * FROM payouts WHERE order_id = $1', [orderId]);
  return res.rows[0] ?? null;
}

async function paidHistoryCount(orderId: string): Promise<number> {
  const res = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM order_status_history WHERE order_id = $1 AND to_status = 'paid'",
    [orderId],
  );
  return Number(res.rows[0].count);
}

async function toDelivered(orderId: string, sellerToken: string): Promise<void> {
  await request(app).post(`/orders/${orderId}/ship`).set(authHeader(sellerToken)).send();
  await request(app).post(`/orders/${orderId}/deliver`).set(authHeader(sellerToken)).send();
}

function adminActor(userId: string): TransitionActor {
  return { kind: 'user', id: userId, isAdmin: true, isSeller: false, isBuyer: true };
}

// Paye une commande via le webhook mock : renvoie la reference du paiement.
async function payOrder(buyerToken: string, orderId: string, totalAmount: number): Promise<string> {
  const { payment } = await initiatePayment(buyerToken, orderId);
  await sendWebhook({
    provider_reference: payment.providerReference,
    status: 'succeeded',
    amount: totalAmount,
  });
  return payment.providerReference;
}

let thiofId: number;

beforeAll(async () => {
  const result = await pool.query<{ id: number }>("SELECT id FROM species WHERE name_fr = 'Thiof'");
  thiofId = result.rows[0].id;
});

afterAll(async () => {
  mockPaymentControl.failPayout = false;
  const phones = [...usedPhones];
  if (phones.length > 0) {
    const users = await pool.query<{ id: string }>('SELECT id FROM users WHERE phone = ANY($1::text[])', [phones]);
    const userIds = users.rows.map((row) => row.id);
    if (userIds.length > 0) {
      const orders = await pool.query<{ id: string }>(
        'SELECT id FROM orders WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])',
        [userIds],
      );
      const orderIds = orders.rows.map((row) => row.id);
      if (orderIds.length > 0) {
        await pool.query('DELETE FROM payouts WHERE order_id = ANY($1::uuid[])', [orderIds]);
        await pool.query('DELETE FROM payments WHERE order_id = ANY($1::uuid[])', [orderIds]);
        await pool.query('DELETE FROM disputes WHERE order_id = ANY($1::uuid[])', [orderIds]);
      }
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

describe('POST /orders/:id/pay', () => {
  it('cree un paiement initiated et renvoie une URL de paiement', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Paiement');
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);

    const res = await request(app).post(`/orders/${order.id}/pay`).set(authHeader(buyer.token)).send({});

    expect(res.status).toBe(201);
    expect(res.body.payment).toMatchObject({
      status: 'initiated',
      provider: 'mock',
      amount: order.totalAmount,
    });
    expect(res.body.payment.providerReference).toEqual(expect.any(String));
    expect(res.body.paymentUrl).toContain(`/payments/mock/${res.body.payment.providerReference}`);
    expect(await orderStatus(order.id)).toBe('pending_payment');
  });

  it('refuse le paiement d une commande qui n est plus en attente', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Deja Paye');
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    await payOrder(buyer.token, order.id, order.totalAmount);

    const res = await request(app).post(`/orders/${order.id}/pay`).set(authHeader(buyer.token)).send({});

    expect(res.status).toBe(409);
  });
});

describe('POST /webhooks/payment', () => {
  it('valide le paiement, passe la commande a paid et ne verse rien avant released', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Webhook');
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    const { payment } = await initiatePayment(buyer.token, order.id);

    const res = await sendWebhook({
      provider_reference: payment.providerReference,
      status: 'succeeded',
      amount: order.totalAmount,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, status: 'succeeded' });
    expect(await orderStatus(order.id)).toBe('paid');

    const payments = await paymentsOf(order.id);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ status: 'succeeded', paid_at: expect.anything() });

    const history = await request(app).get(`/orders/${order.id}`).set(authHeader(buyer.token));
    const paidEntry = history.body.order.history.find((entry: { toStatus: string }) => entry.toStatus === 'paid');
    expect(paidEntry).toBeDefined();
    expect(paidEntry.actorId).toBeNull();

    // Les fonds ne sont jamais verses avant « released » (regle 3).
    expect(await payoutOf(order.id)).toBeNull();
  });

  it('ignore un webhook recu deux fois (idempotence par provider_reference)', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Double');
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    const reference = await payOrder(buyer.token, order.id, order.totalAmount);

    const first = await sendWebhook({
      provider_reference: reference,
      status: 'succeeded',
      amount: order.totalAmount,
    });
    const second = await sendWebhook({
      provider_reference: reference,
      status: 'succeeded',
      amount: order.totalAmount,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('ignored');
    expect(await paymentsOf(order.id)).toHaveLength(1);
    expect(await paidHistoryCount(order.id)).toBe(1);
    expect(await orderStatus(order.id)).toBe('paid');
  });

  it('rejette un webhook dont la signature est invalide', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Signature');
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    const { payment } = await initiatePayment(buyer.token, order.id);

    const raw = JSON.stringify({
      provider_reference: payment.providerReference,
      status: 'succeeded',
      amount: order.totalAmount,
    });
    const bad = await sendWebhook(JSON.parse(raw), { signature: '0'.repeat(64) });
    const missing = await sendWebhook(JSON.parse(raw), { signature: null });

    expect(bad.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(await paymentsOf(order.id)).toMatchObject([{ status: 'initiated' }]);
    expect(await orderStatus(order.id)).toBe('pending_payment');
  });

  it('rejette un webhook dont le montant ne correspond pas au total', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Montant');
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    const { payment } = await initiatePayment(buyer.token, order.id);

    const res = await sendWebhook({
      provider_reference: payment.providerReference,
      status: 'succeeded',
      amount: order.totalAmount + 500,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('incorrect');
    expect(await paymentsOf(order.id)).toMatchObject([{ status: 'initiated' }]);
    expect(await orderStatus(order.id)).toBe('pending_payment');
    expect(await paidHistoryCount(order.id)).toBe(0);
  });

  it('enregistre un echec de paiement sans faire avancer la commande', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Echec');
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    const { payment } = await initiatePayment(buyer.token, order.id);

    const res = await sendWebhook({
      provider_reference: payment.providerReference,
      status: 'failed',
      amount: order.totalAmount,
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    expect(await paymentsOf(order.id)).toMatchObject([{ status: 'failed', paid_at: null }]);
    expect(await orderStatus(order.id)).toBe('pending_payment');
    expect(await paidHistoryCount(order.id)).toBe(0);
  });

  it('rejette un webhook pour une reference inconnue', async () => {
    const res = await sendWebhook({
      provider_reference: 'reference-inexistante',
      status: 'succeeded',
      amount: 1000,
    });

    expect(res.status).toBe(404);
  });
});

describe('Page de simulation du fournisseur mock', () => {
  it('affiche la page de simulation pour un paiement en attente', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Page Mock');
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    const { payment } = await initiatePayment(buyer.token, order.id);

    const res = await request(app).get(`/payments/mock/${payment.providerReference}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain(payment.providerReference);
    expect(res.text).toContain(String(order.totalAmount));
  });

  it('confirme le paiement simule et redirige vers la page de retour', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Simulation');
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    const { payment } = await initiatePayment(buyer.token, order.id);

    const res = await request(app)
      .post(`/payments/mock/${payment.providerReference}/simulate`)
      .type('form')
      .send({ outcome: 'succeeded' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`/paiement/${payment.providerReference}`);
    expect(await orderStatus(order.id)).toBe('paid');

    // Un second clic ne change rien (idempotence).
    const again = await request(app)
      .post(`/payments/mock/${payment.providerReference}/simulate`)
      .type('form')
      .send({ outcome: 'succeeded' });
    expect(again.status).toBe(302);
    expect(await paidHistoryCount(order.id)).toBe(1);
  });
});

describe('Liberation des fonds et versement', () => {
  it('verse le vendeur quand la commande passe a released', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Liberation');
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    await payOrder(buyer.token, order.id, order.totalAmount);
    expect(await payoutOf(order.id)).toBeNull();

    await toDelivered(order.id, seller.token);
    await transitionOrder(order.id, 'released', { kind: 'system' }, 'Liberation des fonds.');

    const payout = await payoutOf(order.id);
    expect(payout).toMatchObject({
      seller_id: seller.userId,
      amount: order.sellerPayout,
      status: 'sent',
      sent_at: expect.anything(),
    });
    expect(payout.provider_reference).toBe(`payout_${payout.id}`);
    expect(await orderStatus(order.id)).toBe('released');
  });

  it('enregistre un echec de versement puis permet une nouvelle tentative admin', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Echec Versement');
    const admin = await createAdmin();
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    await payOrder(buyer.token, order.id, order.totalAmount);
    await toDelivered(order.id, seller.token);

    mockPaymentControl.failPayout = true;
    try {
      await transitionOrder(order.id, 'released', { kind: 'system' }, 'Liberation des fonds.');
    } finally {
      mockPaymentControl.failPayout = false;
    }

    const failed = await payoutOf(order.id);
    expect(failed).toMatchObject({ status: 'failed', sent_at: null });
    if (!failed) {
      throw new Error('versement introuvable');
    }

    const retryAsAnonymous = await request(app).post(`/admin/payouts/${failed.id}/retry`);
    expect(retryAsAnonymous.status).toBe(401);

    const retry = await request(app).post(`/admin/payouts/${failed.id}/retry`).set(authHeader(admin.token));
    expect(retry.status).toBe(200);
    expect(retry.body.payout).toMatchObject({ status: 'sent', amount: order.sellerPayout });
    expect((await payoutOf(order.id)).sent_at).not.toBeNull();
  });

  it('refuse une nouvelle tentative si le versement est deja effectue', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Verse');
    const admin = await createAdmin();
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    await payOrder(buyer.token, order.id, order.totalAmount);
    await toDelivered(order.id, seller.token);
    await transitionOrder(order.id, 'released', { kind: 'system' }, 'Liberation des fonds.');

    const payout = await payoutOf(order.id);
    const retry = await request(app).post(`/admin/payouts/${payout.id}/retry`).set(authHeader(admin.token));

    expect(retry.status).toBe(409);
  });
});

describe('Remboursement', () => {
  it('rembourse le montant total quand la commande passe a refunded', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Rembourse');
    const admin = await createAdmin();
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    await payOrder(buyer.token, order.id, order.totalAmount);

    await transitionOrder(order.id, 'refunded', adminActor(admin.userId), 'Remboursement total.');

    const payments = await paymentsOf(order.id);
    expect(payments[0]).toMatchObject({
      status: 'refunded',
      refunded_amount: order.totalAmount,
    });
    expect(await orderStatus(order.id)).toBe('refunded');
    expect(await payoutOf(order.id)).toBeNull();
  });

  it('rembourse une partie du montant (decision de litige)', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Partiel');
    const admin = await createAdmin();
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    await payOrder(buyer.token, order.id, order.totalAmount);

    // Decision de l'etape 9 simulee : remboursement partiel de 1 000 FCFA.
    await pool.query(
      `INSERT INTO disputes (order_id, opened_by, reason, description, status, refund_amount, resolved_by, resolved_at)
       VALUES ($1, $2, 'Produit avarie', 'Qualite non conforme', 'resolved_partial', 1000, $3, now())`,
      [order.id, buyer.userId, admin.userId],
    );

    await transitionOrder(order.id, 'refunded', adminActor(admin.userId), 'Remboursement partiel.');

    const payments = await paymentsOf(order.id);
    expect(payments[0]).toMatchObject({
      status: 'succeeded',
      refunded_amount: 1000,
    });
    expect(await orderStatus(order.id)).toBe('refunded');
  });
});

describe('GET /payments/reference/:reference', () => {
  it('renvoie l etat du paiement a l acheteur', async () => {
    const seller = await createSeller();
    const buyer = await createUser('Acheteur Retour');
    const listingId = await insertListing(seller.userId, 50, 3000);
    const order = await createOrder(buyer.token, listingId, 5);
    const reference = await payOrder(buyer.token, order.id, order.totalAmount);

    const res = await request(app)
      .get(`/payments/reference/${reference}`)
      .set(authHeader(buyer.token));

    expect(res.status).toBe(200);
    expect(res.body.payment).toMatchObject({
      providerReference: reference,      status: 'succeeded',
      order: { id: order.id, status: 'paid', totalAmount: order.totalAmount },
    });
  });

  it('exige une authentification', async () => {
    const res = await request(app).get('/payments/reference/n importe quoi');
    expect(res.status).toBe(401);
  });
});
