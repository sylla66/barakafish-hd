import path from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod';

// En dev, la configuration peut vivre a la racine du monorepo (.env) ou dans
// /api (.env). On charge la racine puis /api sans ecraser ce qui est deja defini.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL est obligatoire")
    .describe('Chaine de connexion PostgreSQL'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET doit faire au moins 32 caracteres'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  OTP_PROVIDER: z.enum(['console', 'sms', 'whatsapp']).default('console'),
  PAYMENT_PROVIDER: z.enum(['mock', 'aggregator']).default('mock'),
  NOTIFICATION_PROVIDER: z.enum(['console', 'sms', 'whatsapp']).default('console'),

  STORAGE_PROVIDER: z.enum(['local', 's3', 'cloudinary']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),

  // URL publique de l'API : utilisee pour construire les URL de redirection de
  // paiement (page de simulation du fournisseur mock, retour apres paiement).
  PUBLIC_API_URL: z.string().default('http://localhost:3000'),
  // Secret HMAC des webhooks de paiement (regle 5 : la signature est verifiee).
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).default('baraka-fish-webhook-secret'),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Utilise uniquement pour les tests : n'ouvre pas de connexion reelle.
  DB_SSL: booleanish.default('false'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(racine)'}: ${issue.message}`)
      .join('\n');
    // Message volontairement en francais : c'est ce que verra l'operateur.
    throw new Error(
      `Configuration d'environnement invalide.\n${details}\n` +
        `Verifiez votre fichier .env (voir .env.example).`,
    );
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
