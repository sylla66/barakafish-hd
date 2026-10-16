import { rm } from 'node:fs/promises';
import path from 'node:path';

import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Meme capture d'OTP que les autres tests d'integration (voir auth.test.ts).
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
import { assertSellerCanPublish } from '../src/modules/sellers/sellers.service';

const app = createApp();

const usedPhones = new Set<string>();
let phoneCounter = 0;

function nextPhone(): string {
  phoneCounter += 1;
  // Plage distincte de auth.test.ts (qui utilise 00000001...) pour eviter toute
  // collision entre fichiers de test executes en parallele. Doit rester un
  // numero senegalais valide : +221 puis 9 chiffres commencant par 7.
  const phone = `+2217${String(90_000_000 + phoneCounter)}`;
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

async function makeAdmin(userId: string): Promise<void> {
  await pool.query('UPDATE users SET is_admin = TRUE WHERE id = $1', [userId]);
}

async function setSellerStatus(userId: string, status: string): Promise<void> {
  await pool.query('UPDATE seller_profiles SET status = $2 WHERE user_id = $1', [userId, status]);
}

async function createSeller(
  shopName = 'Boutique Test',
): Promise<{ token: string; userId: string }> {
  const account = await signup(nextPhone(), 'Vendeur Test');
  await request(app)
    .post('/sellers/profile')
    .set(authHeader(account.token))
    .send({ shop_name: shopName, description: 'Poissons frais', zone: 'Dakar', address: 'Port de Dakar' });
  return account;
}

async function cleanup(): Promise<void> {
  const phones = [...usedPhones];
  if (phones.length > 0) {
    const users = await pool.query<{ id: string }>('SELECT id FROM users WHERE phone = ANY($1::text[])', [
      phones,
    ]);
    const ids = users.rows.map((row) => row.id);
    if (ids.length > 0) {
      await pool.query('DELETE FROM seller_profiles WHERE user_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
    }
    await pool.query('DELETE FROM otp_codes WHERE phone = ANY($1::text[])', [phones]);
  }
  usedPhones.clear();
}

afterAll(async () => {
  await cleanup();
  await closePool();
  // Dossier d uploads partage par les tests executes en parallele :
  // on tolere une suppression concurrente (ENOTEMPTY).
  await rm(path.resolve('./.test-uploads'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
    () => undefined,
  );
});

describe('POST /sellers/profile', () => {
  it('cree le profil, passe is_seller a true et le statut a pending', async () => {
    const account = await signup(nextPhone(), 'Awa Vendeur');

    const res = await request(app)
      .post('/sellers/profile')
      .set(authHeader(account.token))
      .send({ shop_name: 'Ocean Dakar', description: 'Thiof et crevettes', zone: 'Dakar', address: 'Mermoz' });

    expect(res.status).toBe(201);
    expect(res.body.profile).toMatchObject({ shopName: 'Ocean Dakar', zone: 'Dakar', status: 'pending', isVerified: false });

    const me = await request(app).get('/me').set(authHeader(account.token));
    expect(me.body.user.isSeller).toBe(true);
  });

  it('refuse la creation sans token', async () => {
    const res = await request(app).post('/sellers/profile').send({ shop_name: 'X', zone: 'Dakar' });
    expect(res.status).toBe(401);
  });

  it('refuse un deuxieme profil vendeur', async () => {
    const account = await createSeller();

    const res = await request(app)
      .post('/sellers/profile')
      .set(authHeader(account.token))
      .send({ shop_name: 'Doublon', zone: 'Dakar' });

    expect(res.status).toBe(409);
  });
});

describe('PUT /sellers/profile', () => {
  it('met a jour les informations du profil', async () => {
    const account = await createSeller();

    const res = await request(app)
      .put('/sellers/profile')
      .set(authHeader(account.token))
      .send({ shop_name: 'Ocean Dakar 2', zone: 'Mbour' });

    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ shopName: 'Ocean Dakar 2', zone: 'Mbour' });
  });
});

describe('GET /sellers/:id (fiche publique)', () => {
  it('renvoie les informations publiques sans donnee sensible', async () => {
    const account = await createSeller('Fiche Publique');

    const res = await request(app).get(`/sellers/${account.userId}`);

    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ shopName: 'Fiche Publique', zone: 'Dakar', isVerified: false });
    expect(res.body.profile.phone).toBeUndefined();
    expect(res.body.profile.hasIdentityDocument).toBeUndefined();
    expect(res.body.profile.address).toBeUndefined();
    expect(res.body.profile.rejectionReason).toBeUndefined();
  });

  it('repond 404 pour un vendeur inconnu', async () => {
    const res = await request(app).get('/sellers/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});

describe('POST /sellers/documents', () => {
  it('enregistre les documents (identite, installation et justificatif)', async () => {
    const account = await createSeller();

    const res = await request(app)
      .post('/sellers/documents')
      .set(authHeader(account.token))
      .attach('identity_document', Buffer.from('jpeg-identity'), { filename: 'id.jpg', contentType: 'image/jpeg' })
      .attach('facility_photo', Buffer.from('jpeg-facility'), { filename: 'facility.png', contentType: 'image/png' })
      .attach('business_document', Buffer.from('rccm-pdf'), { filename: 'rccm.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({
      hasIdentityDocument: true,
      hasFacilityPhoto: true,
      hasBusinessDocument: true,
      hasSanitaryDocument: false,
    });
  });

  it('enregistre le justificatif professionnel (mareyeur / RCCM)', async () => {
    const account = await createSeller();

    const res = await request(app)
      .post('/sellers/documents')
      .set(authHeader(account.token))
      .attach('identity_document', Buffer.from('jpeg-identity'), { filename: 'id.jpg', contentType: 'image/jpeg' })
      .attach('facility_photo', Buffer.from('jpeg-facility'), { filename: 'facility.png', contentType: 'image/png' })
      .attach('business_document', Buffer.from('rccm-pdf'), { filename: 'rccm.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(res.body.profile.hasBusinessDocument).toBe(true);
  });

  it('exige la piece d identite', async () => {
    const account = await createSeller();

    const res = await request(app)
      .post('/sellers/documents')
      .set(authHeader(account.token))
      .attach('facility_photo', Buffer.from('x'), { filename: 'facility.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
  });

  it('exige le justificatif professionnel', async () => {
    const account = await createSeller();

    const res = await request(app)
      .post('/sellers/documents')
      .set(authHeader(account.token))
      .attach('identity_document', Buffer.from('x'), { filename: 'id.jpg', contentType: 'image/jpeg' })
      .attach('facility_photo', Buffer.from('x'), { filename: 'facility.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/justificatif professionnel/i);
  });

  it('refuse un format de fichier non autorise', async () => {
    const account = await createSeller();

    const res = await request(app)
      .post('/sellers/documents')
      .set(authHeader(account.token))
      .attach('identity_document', Buffer.from('hello'), { filename: 'note.txt', contentType: 'text/plain' })
      .attach('facility_photo', Buffer.from('x'), { filename: 'facility.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/format/i);
  });
});

describe('documents sensibles', () => {
  it('refuse le telechargement de la piece d identite sans token', async () => {
    const account = await createSeller();

    const res = await request(app).get(`/sellers/${account.userId}/documents/identity`);
    expect(res.status).toBe(401);
  });

  it('refuse la piece d identite au proprietaire non admin', async () => {
    const account = await createSeller();
    await request(app)
      .post('/sellers/documents')
      .set(authHeader(account.token))
      .attach('identity_document', Buffer.from('secret'), { filename: 'id.jpg', contentType: 'image/jpeg' })
      .attach('facility_photo', Buffer.from('x'), { filename: 'facility.png', contentType: 'image/png' })
      .attach('business_document', Buffer.from('x'), { filename: 'rccm.pdf', contentType: 'application/pdf' });

    const res = await request(app)
      .get(`/sellers/${account.userId}/documents/identity`)
      .set(authHeader(account.token));

    expect(res.status).toBe(403);
  });

  it('autorise l admin a telecharger la piece d identite', async () => {
    const account = await createSeller();
    await request(app)
      .post('/sellers/documents')
      .set(authHeader(account.token))
      .attach('identity_document', Buffer.from('secret-identity'), { filename: 'id.jpg', contentType: 'image/jpeg' })
      .attach('facility_photo', Buffer.from('x'), { filename: 'facility.png', contentType: 'image/png' })
      .attach('business_document', Buffer.from('x'), { filename: 'rccm.pdf', contentType: 'application/pdf' });

    const admin = await signup(nextPhone(), 'Admin Doc');
    await makeAdmin(admin.userId);

    const res = await request(app)
      .get(`/sellers/${account.userId}/documents/identity`)
      .set(authHeader(admin.token));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.body).toEqual(Buffer.from('secret-identity'));
  });

  it('reserve le justificatif professionnel aux admins', async () => {
    const account = await createSeller();
    await request(app)
      .post('/sellers/documents')
      .set(authHeader(account.token))
      .attach('identity_document', Buffer.from('x'), { filename: 'id.jpg', contentType: 'image/jpeg' })
      .attach('facility_photo', Buffer.from('x'), { filename: 'facility.png', contentType: 'image/png' })
      .attach('business_document', Buffer.from('rccm-secret'), { filename: 'rccm.pdf', contentType: 'application/pdf' });

    const ownerAttempt = await request(app)
      .get(`/sellers/${account.userId}/documents/business`)
      .set(authHeader(account.token));
    expect(ownerAttempt.status).toBe(403);

    const admin = await signup(nextPhone(), 'Admin Rccm');
    await makeAdmin(admin.userId);

    const adminAttempt = await request(app)
      .get(`/sellers/${account.userId}/documents/business`)
      .set(authHeader(admin.token));
    expect(adminAttempt.status).toBe(200);
    expect(adminAttempt.body).toEqual(Buffer.from('rccm-secret'));
  });

  it('autorise le proprietaire a voir sa photo d installation', async () => {
    const account = await createSeller();
    await request(app)
      .post('/sellers/documents')
      .set(authHeader(account.token))
      .attach('identity_document', Buffer.from('x'), { filename: 'id.jpg', contentType: 'image/jpeg' })
      .attach('facility_photo', Buffer.from('facility-bytes'), { filename: 'facility.png', contentType: 'image/png' })
      .attach('business_document', Buffer.from('x'), { filename: 'rccm.pdf', contentType: 'application/pdf' });

    const res = await request(app)
      .get(`/sellers/${account.userId}/documents/facility`)
      .set(authHeader(account.token));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(Buffer.from('facility-bytes'));
  });
});

describe('routes admin', () => {
  it('refuse l acces sans token', async () => {
    const res = await request(app).get('/admin/sellers');
    expect(res.status).toBe(401);
  });

  it('refuse l acces a un utilisateur non admin', async () => {
    const account = await signup(nextPhone(), 'Pas Admin');

    const res = await request(app).get('/admin/sellers').set(authHeader(account.token));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('acces_refuse');
  });

  it('liste les vendeurs par statut (admin)', async () => {
    const seller = await createSeller('Liste Admin');
    const admin = await signup(nextPhone(), 'Admin Liste');
    await makeAdmin(admin.userId);

    const res = await request(app).get('/admin/sellers?status=pending').set(authHeader(admin.token));

    expect(res.status).toBe(200);
    const found = res.body.sellers.find((item: { userId: string }) => item.userId === seller.userId);
    expect(found).toMatchObject({ shopName: 'Liste Admin', status: 'pending' });
    expect(found.phone).toBeDefined();
  });

  it('verifie un vendeur et enregistre verified_by / verified_at', async () => {
    const seller = await createSeller();
    const admin = await signup(nextPhone(), 'Admin Verif');
    await makeAdmin(admin.userId);

    const res = await request(app)
      .post(`/admin/sellers/${seller.userId}/verify`)
      .set(authHeader(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ status: 'verified', isVerified: true });
    expect(res.body.profile.verifiedAt).not.toBeNull();

    const stored = await pool.query<{ verified_by: string }>(
      'SELECT verified_by FROM seller_profiles WHERE user_id = $1',
      [seller.userId],
    );
    expect(stored.rows[0].verified_by).toBe(admin.userId);
  });

  it('rejette un vendeur avec un motif', async () => {
    const seller = await createSeller();
    const admin = await signup(nextPhone(), 'Admin Rejet');
    await makeAdmin(admin.userId);

    const missing = await request(app)
      .post(`/admin/sellers/${seller.userId}/reject`)
      .set(authHeader(admin.token))
      .send({});
    expect(missing.status).toBe(422);

    const res = await request(app)
      .post(`/admin/sellers/${seller.userId}/reject`)
      .set(authHeader(admin.token))
      .send({ reason: 'Documents illisibles' });

    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ status: 'rejected', rejectionReason: 'Documents illisibles' });
  });

  it('suspend un vendeur', async () => {
    const seller = await createSeller();
    const admin = await signup(nextPhone(), 'Admin Suspend');
    await makeAdmin(admin.userId);

    const res = await request(app)
      .post(`/admin/sellers/${seller.userId}/suspend`)
      .set(authHeader(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.profile.status).toBe('suspended');
  });
});

describe('regle de publication', () => {
  it('refuse la publication pour un vendeur pending ou suspended', async () => {
    const account = await createSeller();

    await expect(assertSellerCanPublish(account.userId)).rejects.toMatchObject({ statusCode: 403 });

    await setSellerStatus(account.userId, 'suspended');
    await expect(assertSellerCanPublish(account.userId)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('autorise la publication pour un vendeur verifie', async () => {
    const account = await createSeller();
    await setSellerStatus(account.userId, 'verified');

    await expect(assertSellerCanPublish(account.userId)).resolves.toBeUndefined();
  });
});
