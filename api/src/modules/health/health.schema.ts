import { z } from 'zod';

// Forme de la reponse de GET /health (sert aussi de contrat/documentation).
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  db: z.enum(['up', 'down']),
  uptime: z.number().nonnegative(),
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
