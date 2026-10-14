import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Variables minimales pour charger src/config/env.ts sans fichier .env.
    // dotenv ne ecrase pas ces valeurs (pas d'override par defaut).
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/baraka_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
      CORS_ORIGIN: 'http://localhost:5173',
    },
  },
});
