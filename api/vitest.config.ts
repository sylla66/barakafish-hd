import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Variables minimales pour charger src/config/env.ts sans fichier .env.
    // dotenv ne ecrase pas ces valeurs (pas d'override par defaut).
    // Les tests d'auth sont des tests d'integration : ils utilisent la vraie
    // base PostgreSQL locale (voir docker-compose.yml). Ils nettoient les lignes
    // qu'ils creent (numeros de telephone dedies).
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://baraka:baraka@localhost:5432/baraka_fish',
      JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
      JWT_EXPIRES_IN: '7d',
      CORS_ORIGIN: 'http://localhost:5173',
      OTP_PROVIDER: 'console',
      STORAGE_PROVIDER: 'local',
      UPLOAD_DIR: './.test-uploads',
      PAYMENT_PROVIDER: 'mock',
      PAYMENT_WEBHOOK_SECRET: 'test-webhook-secret-16-chars-min',
      PUBLIC_API_URL: 'http://localhost:3000',
    },
  },
});
