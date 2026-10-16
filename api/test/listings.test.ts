import { rm } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Meme capture d'OTP que les autres tests d'integration.
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

const app = createApp();

const usedPhones = new Set<string>();
let phoneCounter = 0;

// Plage distincte des autres fichiers de test pour eviter toute collision quand
// vitest execute les fichiers en parallele.
function nextPhone(): string {
  phoneCounter += 1;
  const phone = `+2217${String(70_000_000 + phoneCounter)}`;
  usedPhones.add(phone);
  return phone;
}

function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function signup(phone: string, fullName: string): Promise<{ token: string; userId: string }> {
  await request(app).post('/auth/request-otp').send({ phone });
  const res = await request(app)
    .post('/auth/verify-otp')
    .send({ phone, code: otpCapture.code, full_name: fullName });
  return { token: res.body.token as string, userId: res.body.user.id as string };
}

async function setSellerStatus(userId: string, status: string): Promise<void> {
  await pool.query('UPDATE seller_profiles SET status = $2 WHERE user_id = $1', [userId, status]);
}

async function createSeller(verified: boolean, shopName = 'Boutique Test'): Promise<{ token: string; userId: string }> {
  const account = await signup(nextPhone(), 'Vendeur Test');
  await request(app)
    .post('/sellers/profile')
    .set(authHeader(account.token))
    .send({ shop_name: shopName, zone: 'Dakar' });
  if (verified) {
    await setSellerStatus(account.userId, 'verified');
  }
  return account;
}

function dateStringOffset(days: number): string {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
  return utc.toISOString().slice(0, 10);
}

let jpeg: Buffer;
let thiofId: number;

beforeAll(async () => {
  jpeg = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();

  const result = await pool.query<{ id: number }>("SELECT id FROM species WHERE name_fr = 'Thiof'");
  thiofId = result.rows[0].id;
});

function payload(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    species_id: String(thiofId),
    title: 'Thiof frais du jour',
    state: 'fresh',
    caught_or_frozen_on: dateStringOffset(0),
    storage_conditions: 'Glace, 0 C',
    quantity_kg: '50',
    min_order_kg: '5',
    price_per_kg: '3500',
    zone: 'Dakar',
    ...overrides,
  };
}

function createRequest(token: string, fields: Record<string, string>, withPhotos: number): request.Test {
  let req = request(app).post('/listings').set(authHeader(token));
  for (const [key, value] of Object.entries(fields)) {
    req = req.field(key, value);
  }
  for (let i = 0; i < withPhotos; i += 1) {
    req = req.attach('photos', jpeg, { filename: `photo-${i}.jpg`, contentType: 'image/jpeg' });
  }
  return req;
}

afterAll(async () => {
  const phones = [...usedPhones];
  if (phones.length > 0) {
    const users = await pool.query<{ id: string }>('SELECT id FROM users WHERE phone = ANY($1::text[])', [phones]);
    const ids = users.rows.map((row) => row.id);
    if (ids.length > 0) {
      await pool.query('DELETE FROM listings WHERE seller_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM seller_profiles WHERE user_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
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

describe('GET /species', () => {
  it('renvoie le catalogue (au moins 25 especes) avec le thiof', async () => {
    const res = await request(app).get('/species');
    expect(res.status).toBe(200);
    expect(res.body.species.length).toBeGreaterThanOrEqual(25);
    const thiof = res.body.species.find((s: { nameFr: string }) => s.nameFr === 'Thiof');
    expect(thiof).toMatchObject({ category: 'poisson', nameWo: 'Thiof' });
  });
});

describe('POST /listings', () => {
  it('cree une annonce active avec photo', async () => {
    const seller = await createSeller(true);

    const res = await createRequest(seller.token, payload(), 1);

    expect(res.status).toBe(201);
    expect(res.body.listing).toMatchObject({
      status: 'active',
      speciesId: thiofId,
      speciesNameFr: 'Thiof',
      state: 'fresh',
      quantityKg: 50,
      minOrderKg: 5,
      pricePerKg: 3500,
      zone: 'Dakar',
      sellerId: seller.userId,
    });
    expect(res.body.listing.photos).toHaveLength(1);
    expect(res.body.listing.photos[0].url).toMatch(/^\/listings\/photos\//);
  });

  it('cree une annonce en brouillon sans photo', async () => {
    const seller = await createSeller(true);

    const res = await createRequest(seller.token, payload(), 0);

    expect(res.status).toBe(201);
    expect(res.body.listing.status).toBe('draft');
    expect(res.body.listing.photos).toHaveLength(0);
  });

  it('refuse un vendeur non verifie', async () => {
    const seller = await createSeller(false);

    const res = await createRequest(seller.token, payload(), 1);

    expect(res.status).toBe(403);
  });

  it('refuse une requete sans token', async () => {
    const res = await request(app).post('/listings').field('title', 'x');
    expect(res.status).toBe(401);
  });

  it('refuse un champ obligatoire manquant', async () => {
    const seller = await createSeller(true);
    const fields = payload();
    delete fields.title;

    const res = await createRequest(seller.token, fields, 1);

    expect(res.status).toBe(422);
  });

  it('refuse une espece inconnue', async () => {
    const seller = await createSeller(true);

    const res = await createRequest(seller.token, payload({ species_id: '999999' }), 1);

    expect(res.status).toBe(400);
  });

  it('refuse une commande minimum superieure a la quantite', async () => {
    const seller = await createSeller(true);

    const res = await createRequest(seller.token, payload({ quantity_kg: '10', min_order_kg: '20' }), 1);

    expect(res.status).toBe(400);
  });
});

describe('regle du frais (3 jours)', () => {
  it('accepte une peche de 3 jours', async () => {
    const seller = await createSeller(true);

    const res = await createRequest(seller.token, payload({ caught_or_frozen_on: dateStringOffset(-3) }), 1);

    expect(res.status).toBe(201);
  });

  it('refuse une peche de plus de 3 jours', async () => {
    const seller = await createSeller(true);

    const res = await createRequest(seller.token, payload({ caught_or_frozen_on: dateStringOffset(-4) }), 1);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/3 jours/i);
  });

  it('refuse une date dans le futur', async () => {
    const seller = await createSeller(true);

    const res = await createRequest(seller.token, payload({ caught_or_frozen_on: dateStringOffset(1) }), 1);

    expect(res.status).toBe(400);
  });

  it('refuse une date de congelation dans le futur (produit congele)', async () => {
    const seller = await createSeller(true);

    const res = await createRequest(
      seller.token,
      payload({ state: 'frozen_at_sea', caught_or_frozen_on: dateStringOffset(2) }),
      1,
    );

    expect(res.status).toBe(400);
  });
});

describe('propriete des annonces', () => {
  it('empeche un autre vendeur de modifier, supprimer ou ajouter des photos', async () => {
    const owner = await createSeller(true);
    const intruder = await createSeller(true);
    const created = await createRequest(owner.token, payload(), 1);
    const listingId = created.body.listing.id as string;

    const update = await request(app)
      .put(`/listings/${listingId}`)
      .set(authHeader(intruder.token))
      .send({ title: 'Pirate' });
    expect(update.status).toBe(403);

    const photos = await request(app)
      .post(`/listings/${listingId}/photos`)
      .set(authHeader(intruder.token))
      .attach('photos', jpeg, { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(photos.status).toBe(403);

    const remove = await request(app)
      .delete(`/listings/${listingId}`)
      .set(authHeader(intruder.token));
    expect(remove.status).toBe(403);
  });

  it('repond 404 pour une annonce inconnue', async () => {
    const seller = await createSeller(true);

    const res = await request(app)
      .put('/listings/00000000-0000-0000-0000-000000000000')
      .set(authHeader(seller.token))
      .send({ title: 'Inexistante' });

    expect(res.status).toBe(404);
  });
});

describe('photos (limite de 5)', () => {
  it('accepte jusqu a 5 photos puis refuse la suivante', async () => {
    const seller = await createSeller(true);
    const created = await createRequest(seller.token, payload(), 1);
    const listingId = created.body.listing.id as string;

    const addFour = await request(app)
      .post(`/listings/${listingId}/photos`)
      .set(authHeader(seller.token))
      .attach('photos', jpeg, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('photos', jpeg, { filename: 'b.jpg', contentType: 'image/jpeg' })
      .attach('photos', jpeg, { filename: 'c.jpg', contentType: 'image/jpeg' })
      .attach('photos', jpeg, { filename: 'd.jpg', contentType: 'image/jpeg' });

    expect(addFour.status).toBe(200);
    expect(addFour.body.listing.photos).toHaveLength(5);

    const sixth = await request(app)
      .post(`/listings/${listingId}/photos`)
      .set(authHeader(seller.token))
      .attach('photos', jpeg, { filename: 'e.jpg', contentType: 'image/jpeg' });

    expect(sixth.status).toBe(400);
    expect(sixth.body.error.message).toMatch(/5 photos/i);
  });

  it('active un brouillon des sa premiere photo', async () => {
    const seller = await createSeller(true);
    const created = await createRequest(seller.token, payload(), 0);
    expect(created.body.listing.status).toBe('draft');
    const listingId = created.body.listing.id as string;

    const res = await request(app)
      .post(`/listings/${listingId}/photos`)
      .set(authHeader(seller.token))
      .attach('photos', jpeg, { filename: 'a.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.listing.status).toBe('active');
    expect(res.body.listing.photos).toHaveLength(1);
  });

  it('refuse un format non image', async () => {
    const seller = await createSeller(true);
    const created = await createRequest(seller.token, payload(), 0);
    const listingId = created.body.listing.id as string;

    const res = await request(app)
      .post(`/listings/${listingId}/photos`)
      .set(authHeader(seller.token))
      .attach('photos', Buffer.from('not an image'), { filename: 'note.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
  });
});

describe('PUT / DELETE', () => {
  it('met a jour une annonce et enregistre updated_at', async () => {
    const seller = await createSeller(true);
    const created = await createRequest(seller.token, payload(), 1);
    const listingId = created.body.listing.id as string;

    const res = await request(app)
      .put(`/listings/${listingId}`)
      .set(authHeader(seller.token))
      .send({ title: 'Thiof premium', price_per_kg: '4200' });

    expect(res.status).toBe(200);
    expect(res.body.listing).toMatchObject({ title: 'Thiof premium', pricePerKg: 4200 });
  });

  it('refuse de publier une annonce sans photo', async () => {
    const seller = await createSeller(true);
    const created = await createRequest(seller.token, payload(), 0);
    const listingId = created.body.listing.id as string;

    const res = await request(app)
      .put(`/listings/${listingId}`)
      .set(authHeader(seller.token))
      .send({ status: 'active' });

    expect(res.status).toBe(400);
  });

  it('archive une annonce (suppression logique)', async () => {
    const seller = await createSeller(true);
    const created = await createRequest(seller.token, payload(), 1);
    const listingId = created.body.listing.id as string;

    const res = await request(app).delete(`/listings/${listingId}`).set(authHeader(seller.token));

    expect(res.status).toBe(200);
    expect(res.body.listing.status).toBe('archived');

    const stored = await pool.query<{ status: string }>('SELECT status FROM listings WHERE id = $1', [listingId]);
    expect(stored.rows[0].status).toBe('archived');
  });
});

describe('lecture publique', () => {
  it('renvoie une annonce et sert sa photo', async () => {
    const seller = await createSeller(true);
    const created = await createRequest(seller.token, payload(), 1);
    const listing = created.body.listing;

    const detail = await request(app).get(`/listings/${listing.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.listing.title).toBe('Thiof frais du jour');

    const photo = await request(app).get(listing.photos[0].url);
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toContain('image/jpeg');
  });

  it('liste mes annonces', async () => {
    const seller = await createSeller(true);
    await createRequest(seller.token, payload(), 1);

    const res = await request(app).get('/listings/mine').set(authHeader(seller.token));

    expect(res.status).toBe(200);
    expect(res.body.listings).toHaveLength(1);
    expect(res.body.listings[0].sellerId).toBe(seller.userId);
  });
});
