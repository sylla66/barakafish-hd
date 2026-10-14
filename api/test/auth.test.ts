import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';

// On capture le code emis par le fournisseur d'OTP : impossible de le relire
// depuis la base (seul le hash est stocke). Aucune base simulee ici, en revanche:
// ces tests sont des tests d'integration sur la vraie base PostgreSQL locale.
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

// Chaque test utilise un numero unique ; on nettoie ensuite les lignes creees.
const usedPhones = new Set<string>();
let phoneCounter = 0;

function nextPhone(): string {
  phoneCounter += 1;
  const phone = `+2217${String(phoneCounter).padStart(8, '0')}`;
  usedPhones.add(phone);
  return phone;
}

function wrongCode(actual: string): string {
  return actual === '000000' ? '111111' : '000000';
}

async function cleanup(): Promise<void> {
  if (usedPhones.size === 0) return;
  const phones = [...usedPhones];
  await pool.query('DELETE FROM otp_codes WHERE phone = ANY($1::text[])', [phones]);
  await pool.query('DELETE FROM users WHERE phone = ANY($1::text[])', [phones]);
  usedPhones.clear();
}

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('POST /auth/request-otp', () => {
  it('envoie un code a 6 chiffres et le stocke hache', async () => {
    const phone = nextPhone();

    const res = await request(app).post('/auth/request-otp').send({ phone });

    expect(res.status).toBe(200);
    expect(res.body.expires_in_minutes).toBe(5);
    expect(otpCapture.phone).toBe(phone);
    expect(otpCapture.code).toMatch(/^\d{6}$/);

    const stored = await pool.query<{ code_hash: string }>(
      'SELECT code_hash FROM otp_codes WHERE phone = $1',
      [phone],
    );
    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0].code_hash).not.toBe(otpCapture.code);
    expect(stored.rows[0].code_hash.startsWith('$2')).toBe(true);
  });

  it('refuse un numero invalide', async () => {
    const res = await request(app).post('/auth/request-otp').send({ phone: '771234567' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation');
  });
});

describe('POST /auth/verify-otp', () => {
  it('cree l utilisateur et renvoie un JWT a la premiere connexion', async () => {
    const phone = nextPhone();
    await request(app).post('/auth/request-otp').send({ phone });

    const res = await request(app)
      .post('/auth/verify-otp')
      .send({ phone, code: otpCapture.code, full_name: 'Awa Diop' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toMatchObject({
      phone,
      fullName: 'Awa Diop',
      isBuyer: true,
      isSeller: false,
      isAdmin: false,
    });
  });

  it('refuse une premiere inscription sans nom complet', async () => {
    const phone = nextPhone();
    await request(app).post('/auth/request-otp').send({ phone });

    const res = await request(app).post('/auth/verify-otp').send({ phone, code: otpCapture.code });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/nom complet/i);
  });

  it('accepte un code valide et le rend a usage unique', async () => {
    const phone = nextPhone();
    await request(app).post('/auth/request-otp').send({ phone });
    const code = otpCapture.code;

    const first = await request(app)
      .post('/auth/verify-otp')
      .send({ phone, code, full_name: 'Moussa Fall' });
    expect(first.status).toBe(200);

    const second = await request(app).post('/auth/verify-otp').send({ phone, code });
    expect(second.status).toBe(400);
  });

  it('refuse un code incorrect', async () => {
    const phone = nextPhone();
    await request(app).post('/auth/request-otp').send({ phone });

    const res = await request(app)
      .post('/auth/verify-otp')
      .send({ phone, code: wrongCode(otpCapture.code) });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/incorrect/i);
  });

  it('refuse un code expire', async () => {
    const phone = nextPhone();
    const code = '123456';
    const hash = await bcrypt.hash(code, 10);
    await pool.query(
      `INSERT INTO otp_codes (phone, code_hash, expires_at)
       VALUES ($1, $2, now() - interval '1 minute')`,
      [phone, hash],
    );

    const res = await request(app).post('/auth/verify-otp').send({ phone, code });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/expire/i);
  });

  it('bloque apres 5 tentatives : la 6e est refusee meme avec le bon code', async () => {
    const phone = nextPhone();
    await request(app).post('/auth/request-otp').send({ phone });
    const correct = otpCapture.code;
    const wrong = wrongCode(correct);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await request(app).post('/auth/verify-otp').send({ phone, code: wrong });
      expect(res.status).toBe(400);
    }

    const sixth = await request(app)
      .post('/auth/verify-otp')
      .send({ phone, code: correct, full_name: 'Bloque Six' });

    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('trop_de_tentatives');
  });

  it('limite a 3 demandes de code par numero et par heure', async () => {
    const phone = nextPhone();

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).post('/auth/request-otp').send({ phone });
      expect(res.status).toBe(200);
    }

    const fourth = await request(app).post('/auth/request-otp').send({ phone });

    expect(fourth.status).toBe(429);
    expect(fourth.body.error.code).toBe('trop_de_demandes');
  });
});

describe('GET /me et PATCH /me', () => {
  async function login(phone: string, fullName: string): Promise<string> {
    await request(app).post('/auth/request-otp').send({ phone });
    const res = await request(app)
      .post('/auth/verify-otp')
      .send({ phone, code: otpCapture.code, full_name: fullName });
    return res.body.token as string;
  }

  it('refuse l acces sans jeton', async () => {
    const res = await request(app).get('/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('non_authentifie');
  });

  it('refuse un jeton invalide', async () => {
    const res = await request(app).get('/me').set('Authorization', 'Bearer pas-un-vrai-jeton');

    expect(res.status).toBe(401);
  });

  it('renvoie le profil avec un jeton valide', async () => {
    const phone = nextPhone();
    const token = await login(phone, 'Fatou Ndiaye');

    const res = await request(app).get('/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ phone, fullName: 'Fatou Ndiaye' });
  });

  it('met a jour le profil via PATCH /me', async () => {
    const phone = nextPhone();
    const token = await login(phone, 'Ibrahima Sow');

    const res = await request(app)
      .patch('/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ city: 'Dakar', email: 'ibra@example.com', is_business: true, business_name: 'Sow Seafood' });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      city: 'Dakar',
      email: 'ibra@example.com',
      isBusiness: true,
      businessName: 'Sow Seafood',
    });
  });

  it('valide les donnees du profil', async () => {
    const phone = nextPhone();
    const token = await login(phone, 'Awa Validation');

    const res = await request(app)
      .patch('/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'pas-un-email' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation');
  });
});
