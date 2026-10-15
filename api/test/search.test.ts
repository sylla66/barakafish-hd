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

const app = createApp();

const usedPhones = new Set<string>();
let phoneCounter = 0;
let zoneCounter = 0;

// Plage de telephones et de zones propre a ce fichier : les tests de recherche
// filtrent par zone pour ne voir que leurs propres donnees, meme si vitest
// execute les fichiers en parallele.
function nextPhone(): string {
  phoneCounter += 1;
  const phone = `+2217${String(76_000_000 + phoneCounter)}`;
  usedPhones.add(phone);
  return phone;
}

function nextZone(): string {
  zoneCounter += 1;
  return `TZ5-${zoneCounter}`;
}

function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function createSeller(verified: boolean): Promise<{ token: string; userId: string }> {
  const phone = nextPhone();
  await request(app).post('/auth/request-otp').send({ phone });
  const res = await request(app)
    .post('/auth/verify-otp')
    .send({ phone, code: otpCapture.code, full_name: 'Vendeur Recherche' });
  const account = { token: res.body.token as string, userId: res.body.user.id as string };

  await request(app)
    .post('/sellers/profile')
    .set(authHeader(account.token))
    .send({ shop_name: 'Boutique Recherche', zone: 'Dakar' });

  if (verified) {
    await pool.query("UPDATE seller_profiles SET status = 'verified' WHERE user_id = $1", [account.userId]);
  }
  return account;
}

interface ListingOptions {
  speciesId?: number;
  title?: string;
  state?: string;
  price?: number;
  zone?: string;
  status?: string;
  createdOffsetMinutes?: number;
}

async function insertListing(sellerId: string, options: ListingOptions): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO listings
       (seller_id, species_id, title, state, caught_or_frozen_on, storage_conditions,
        quantity_kg, min_order_kg, price_per_kg, zone, status, created_at)
     VALUES ($1, $2, $3, $4, CURRENT_DATE, 'glace', 100, 1, $5, $6, $7,
             now() - ($8 || ' minutes')::interval)
     RETURNING id`,
    [
      sellerId,
      options.speciesId ?? thiofId,
      options.title ?? 'Annonce de recherche',
      options.state ?? 'fresh',
      options.price ?? 3000,
      options.zone ?? nextZone(),
      options.status ?? 'active',
      options.createdOffsetMinutes ?? 0,
    ],
  );
  return result.rows[0].id;
}

function ids(res: request.Response): string[] {
  return (res.body.listings as { id: string }[]).map((listing) => listing.id);
}

let thiofId: number;
let crevetteId: number;

beforeAll(async () => {
  const species = await pool.query<{ id: number; name_fr: string }>(
    "SELECT id, name_fr FROM species WHERE name_fr IN ('Thiof', 'Crevette')",
  );
  thiofId = species.rows.find((row) => row.name_fr === 'Thiof')!.id;
  crevetteId = species.rows.find((row) => row.name_fr === 'Crevette')!.id;
});

afterAll(async () => {
  const phones = [...usedPhones];
  if (phones.length > 0) {
    const users = await pool.query<{ id: string }>('SELECT id FROM users WHERE phone = ANY($1::text[])', [phones]);
    const userIds = users.rows.map((row) => row.id);
    if (userIds.length > 0) {
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

describe('GET /listings - filtres', () => {
  it('filtre par espece', async () => {
    const seller = await createSeller(true);
    const zone = nextZone();
    const thiof = await insertListing(seller.userId, { zone, speciesId: thiofId });
    await insertListing(seller.userId, { zone, speciesId: crevetteId });

    const res = await request(app).get('/listings').query({ zone, species_id: thiofId });

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([thiof]);
  });

  it('filtre par categorie', async () => {
    const seller = await createSeller(true);
    const zone = nextZone();
    const crevette = await insertListing(seller.userId, { zone, speciesId: crevetteId });
    await insertListing(seller.userId, { zone, speciesId: thiofId });

    const res = await request(app).get('/listings').query({ zone, category: 'crustacé' });

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([crevette]);
  });

  it('filtre par etat', async () => {
    const seller = await createSeller(true);
    const zone = nextZone();
    const frozen = await insertListing(seller.userId, { zone, state: 'frozen' });
    await insertListing(seller.userId, { zone, state: 'fresh' });

    const res = await request(app).get('/listings').query({ zone, state: 'frozen' });

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([frozen]);
  });

  it('filtre par zone', async () => {
    const seller = await createSeller(true);
    const zoneA = nextZone();
    const zoneB = nextZone();
    const inA = await insertListing(seller.userId, { zone: zoneA });
    await insertListing(seller.userId, { zone: zoneB });

    const res = await request(app).get('/listings').query({ zone: zoneA });

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([inA]);
  });

  it('filtre par prix min et max', async () => {
    const seller = await createSeller(true);
    const zone = nextZone();
    await insertListing(seller.userId, { zone, price: 1000 });
    const mid = await insertListing(seller.userId, { zone, price: 3000 });
    await insertListing(seller.userId, { zone, price: 9000 });

    const res = await request(app).get('/listings').query({ zone, price_min: 2000, price_max: 5000 });

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([mid]);
  });

  it('filtre par vendeur verifie', async () => {
    const zone = nextZone();
    const verified = await createSeller(true);
    const pending = await createSeller(false);
    const verifiedListing = await insertListing(verified.userId, { zone });
    const pendingListing = await insertListing(pending.userId, { zone });

    const onlyVerified = await request(app).get('/listings').query({ zone, seller_verified: 'true' });
    expect(ids(onlyVerified)).toEqual([verifiedListing]);

    const onlyUnverified = await request(app).get('/listings').query({ zone, seller_verified: 'false' });
    expect(ids(onlyUnverified)).toEqual([pendingListing]);
  });

  it('recherche textuelle par titre et par nom d espece', async () => {
    const seller = await createSeller(true);
    const zone = nextZone();
    const byTitle = await insertListing(seller.userId, {
      zone,
      speciesId: crevetteId,
      title: 'Lot exceptionnel de thazard',
    });
    const bySpeciesName = await insertListing(seller.userId, { zone, speciesId: thiofId, title: 'Arrivage du matin' });
    await insertListing(seller.userId, { zone, speciesId: crevetteId, title: 'Crevettes fraiches' });

    const resTitle = await request(app).get('/listings').query({ zone, q: 'thazard' });
    expect(ids(resTitle)).toEqual([byTitle]);

    const resSpecies = await request(app).get('/listings').query({ zone, q: 'Thiof' });
    expect(ids(resSpecies)).toEqual([bySpeciesName]);
  });
});

describe('GET /listings - tris', () => {
  it('trie par prix croissant puis decroissant', async () => {
    const seller = await createSeller(true);
    const zone = nextZone();
    const low = await insertListing(seller.userId, { zone, price: 1000 });
    const high = await insertListing(seller.userId, { zone, price: 9000 });
    const mid = await insertListing(seller.userId, { zone, price: 4000 });

    const asc = await request(app).get('/listings').query({ zone, sort: 'price_asc' });
    expect(ids(asc)).toEqual([low, mid, high]);

    const desc = await request(app).get('/listings').query({ zone, sort: 'price_desc' });
    expect(ids(desc)).toEqual([high, mid, low]);
  });

  it('trie par note du vendeur', async () => {
    const zone = nextZone();
    const good = await createSeller(true);
    const bad = await createSeller(true);
    await pool.query('UPDATE seller_profiles SET rating_avg = 4.8 WHERE user_id = $1', [good.userId]);
    await pool.query('UPDATE seller_profiles SET rating_avg = 2.1 WHERE user_id = $1', [bad.userId]);
    const goodListing = await insertListing(good.userId, { zone });
    const badListing = await insertListing(bad.userId, { zone });

    const res = await request(app).get('/listings').query({ zone, sort: 'rating' });

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([goodListing, badListing]);
  });
});

describe('GET /listings - pagination', () => {
  it('pagine par curseur sans doublon ni manque', async () => {
    const seller = await createSeller(true);
    const zone = nextZone();
    const created: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      // created_at decroissant : l'ordre 'recent' est deterministe.
      created.push(await insertListing(seller.userId, { zone, createdOffsetMinutes: index }));
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const query: Record<string, string | number> = { zone, limit: 10 };
      if (cursor) query.cursor = cursor;
      const res = await request(app).get('/listings').query(query);
      expect(res.status).toBe(200);
      seen.push(...ids(res));
      cursor = res.body.next_cursor as string | null;
      if (!cursor) break;
    }

    expect(seen).toEqual(created);
    expect(new Set(seen).size).toBe(25);
  });

  it('refuse un curseur invalide', async () => {
    const res = await request(app).get('/listings').query({ cursor: 'pas-un-curseur' });
    expect(res.status).toBe(400);
  });

  it('refuse une limite hors bornes', async () => {
    const res = await request(app).get('/listings').query({ limit: 100 });
    expect(res.status).toBe(422);
  });
});

describe('GET /listings - mise en avant et statut', () => {
  it('place les annonces sponsorisees non expirees en tete', async () => {
    const seller = await createSeller(true);
    const zone = nextZone();
    // Creee en dernier (la plus recente) mais non sponsorisee.
    await insertListing(seller.userId, { zone, createdOffsetMinutes: 0, title: 'Recente sans sponsoring' });
    const sponsored = await insertListing(seller.userId, { zone, createdOffsetMinutes: 30 });
    const expired = await insertListing(seller.userId, { zone, createdOffsetMinutes: 60 });

    await pool.query(
      "UPDATE listings SET is_sponsored = TRUE, sponsored_until = now() + interval '7 days' WHERE id = $1",
      [sponsored],
    );
    await pool.query(
      "UPDATE listings SET is_sponsored = TRUE, sponsored_until = now() - interval '1 day' WHERE id = $1",
      [expired],
    );

    const res = await request(app).get('/listings').query({ zone, sort: 'recent' });

    expect(res.status).toBe(200);
    const first = res.body.listings[0];
    expect(first.id).toBe(sponsored);
    expect(first.sponsored).toBe(true);

    const expiredRow = (res.body.listings as { id: string; sponsored: boolean }[]).find((row) => row.id === expired);
    expect(expiredRow?.sponsored).toBe(false);
  });

  it('exclut les annonces brouillon et archivees', async () => {
    const seller = await createSeller(true);
    const zone = nextZone();
    const active = await insertListing(seller.userId, { zone, title: 'Annonce active' });
    await insertListing(seller.userId, { zone, status: 'draft', title: 'Brouillon' });
    await insertListing(seller.userId, { zone, status: 'archived', title: 'Archivee' });

    const res = await request(app).get('/listings').query({ zone });

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([active]);
  });
});

describe('GET /listings/:id - detail enrichi', () => {
  it('renvoie les infos vendeur et la note moyenne', async () => {
    const seller = await createSeller(true);
    await pool.query('UPDATE seller_profiles SET rating_avg = 4.5, rating_count = 12 WHERE user_id = $1', [
      seller.userId,
    ]);
    const listingId = await insertListing(seller.userId, { zone: nextZone() });

    const res = await request(app).get(`/listings/${listingId}`);

    expect(res.status).toBe(200);
    expect(res.body.listing.seller).toMatchObject({
      userId: seller.userId,
      shopName: 'Boutique Recherche',
      isVerified: true,
      ratingAvg: 4.5,
      ratingCount: 12,
    });
    expect(res.body.listing.sponsored).toBe(false);
  });
});
