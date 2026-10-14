import { pool } from '../../db/pool';
import type { HealthResponse } from './health.schema';

// Verifie que la base repond. On ne fait pas echouer la requete si la base est
// indisponible : l'application est "up" mais indique "db: down" (supervision).
async function checkDatabase(): Promise<'up' | 'down'> {
  try {
    await pool.query('SELECT 1');
    return 'up';
  } catch {
    return 'down';
  }
}

export async function getHealth(): Promise<HealthResponse> {
  const db = await checkDatabase();
  return {
    status: 'ok',
    db,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
}
