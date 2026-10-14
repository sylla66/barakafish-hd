import { createApp } from './app';
import { env } from './config/env';
import { closePool } from './db/pool';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`[api] Baraka Fish HD demarre sur http://localhost:${env.PORT} (${env.NODE_ENV})`);
  console.log(`[api] Sante : http://localhost:${env.PORT}/health`);
});

// Arret propre : on cesse d'accepter des requetes puis on ferme le pool SQL.
async function shutdown(signal: string): Promise<void> {
  console.log(`[api] signal ${signal} recu, arret en cours...`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
