import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

// On mocke le pool PostgreSQL : le test de /health ne doit pas dependre d'une
// base reelle. On verifie le contrat HTTP, pas la connectivite.
vi.mock('../src/db/pool', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }) },
  closePool: vi.fn(),
}));

import { createApp } from '../src/app';

const app = createApp();

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /health', () => {
  it('repond 200 avec le statut ok et la base up', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.timestamp).toBe('string');
  });
});

describe('routes inexistantes', () => {
  it('repond 404 avec un message en francais', async () => {
    const res = await request(app).get('/cette-route-nexiste-pas');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('route_introuvable');
    expect(res.body.error.message).toMatch(/existe pas/i);
  });
});
