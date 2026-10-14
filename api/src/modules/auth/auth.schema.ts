import { z } from 'zod';

// Format senegalais : indicatif +221 puis 9 chiffres commencant par 7.
export const SENEGAL_PHONE_REGEX = /^\+2217\d{8}$/;

export const phoneSchema = z
  .string({ required_error: 'Le numero de telephone est obligatoire.' })
  .trim()
  .regex(
    SENEGAL_PHONE_REGEX,
    'Numero invalide. Format attendu : +221 suivi de 9 chiffres commencant par 7 (ex. +221771234567).',
  );

export const requestOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z
    .string({ required_error: 'Le code est obligatoire.' })
    .trim()
    .regex(/^\d{6}$/, 'Le code doit contenir exactement 6 chiffres.'),
  full_name: z
    .string()
    .trim()
    .min(2, 'Le nom complet doit contenir au moins 2 caracteres.')
    .max(120, 'Le nom complet est trop long.')
    .optional(),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
