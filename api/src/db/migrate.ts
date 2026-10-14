import fs from 'node:fs';
import path from 'node:path';

import { pool } from './pool';

// Les migrations SQL vivent a la racine du monorepo, dans db/migrations, et sont
// appliquees dans l'ordre alphabetique du nom de fichier. 001_initial_schema.sql
// est la toute premiere migration.
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../db/migrations');

interface Migration {
  id: string;
  filePath: string;
}

function listMigrations(): Migration[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Dossier de migrations introuvable : ${MIGRATIONS_DIR}`);
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    throw new Error(`Aucune migration trouvee dans ${MIGRATIONS_DIR}`);
  }

  return files.map((file) => ({
    id: file.replace(/\.sql$/, ''),
    filePath: path.join(MIGRATIONS_DIR, file),
  }));
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(): Promise<Set<string>> {
  const result = await pool.query<{ id: string }>('SELECT id FROM schema_migrations');
  return new Set(result.rows.map((row) => row.id));
}

async function applyMigration(migration: Migration): Promise<void> {
  const sql = fs.readFileSync(migration.filePath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
    await client.query('COMMIT');
    console.log(`[migration] appliquee : ${migration.id}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(
      `Echec de la migration ${migration.id} : ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    client.release();
  }
}

async function run(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedMigrations();

  const pending = listMigrations().filter((migration) => !applied.has(migration.id));

  if (pending.length === 0) {
    console.log('[migration] base deja a jour, aucune migration a appliquer.');
    return;
  }

  for (const migration of pending) {
    await applyMigration(migration);
  }

  console.log(`[migration] termine : ${pending.length} migration(s) appliquee(s).`);
}

run()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[migration] erreur :', error instanceof Error ? error.message : error);
    pool.end().finally(() => process.exit(1));
  });
