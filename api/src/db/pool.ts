import { Pool } from 'pg';

import { env, isProduction } from '../config/env';

// Client PostgreSQL en pool. On a choisi `pg` (node-postgres) plutot que Prisma
// car le coeur du projet repose sur du SQL explicite (transactions, SELECT ...
// FOR UPDATE, verrous, webhooks idempotents) que l'on veut maitriser au plus pres.
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
});

// Un pool ne doit pas tuer le process sur une erreur d'un client inactif.
pool.on('error', (error) => {
  console.error('[db] erreur inattendue du pool PostgreSQL', error);
});

export async function closePool(): Promise<void> {
  await pool.end();
}
