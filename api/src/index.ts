import { createApp } from './app';
import { env } from './config/env';
import { closePool } from './db/pool';
import { startOrdersScheduler } from './jobs/ordersScheduler';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`[api] Baraka Fish HD demarre sur http://localhost:${env.PORT} (${env.NODE_ENV})`);
  console.log(`[api] Sante : http://localhost:${env.PORT}/health`);
});

// Tache planifiee : annulation des commandes impayees et liberation automatique
// des fonds apres le delai de litige.
const stopScheduler = startOrdersScheduler();

// Arret propre : on cesse d'accepter des requetes puis on ferme le pool SQL.
async function shutdown(signal: string): Promise<void> {
  console.log(`[api] signal ${signal} recu, arret en cours...`);
  stopScheduler();
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
