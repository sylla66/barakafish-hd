import { z } from 'zod';

// Mise a jour du profil (/me). Les noms de champs suivent la convention des
// autres entrees de l'API (snake_case, cf. `full_name` de verify-otp).
export const updateMeSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, 'Le nom complet doit contenir au moins 2 caracteres.')
    .max(120, 'Le nom complet est trop long.')
    .optional(),
  email: z.string().trim().email('Adresse email invalide.').max(160, "L'email est trop long.").optional(),
  city: z.string().trim().min(1, 'La ville ne peut pas etre vide.').max(80, 'La ville est trop longue.').optional(),
  is_business: z.boolean().optional(),
  business_name: z
    .string()
    .trim()
    .min(1, "Le nom de l'entreprise ne peut pas etre vide.")
    .max(120, "Le nom de l'entreprise est trop long.")
    .optional(),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
