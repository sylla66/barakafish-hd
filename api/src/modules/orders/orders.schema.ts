import { z } from 'zod';

export const createOrderSchema = z.object({
  listing_id: z.string().uuid('Annonce invalide.'),
  quantity_kg: z.coerce
    .number()
    .positive('La quantite doit etre superieure a zero.')
    .max(1_000_000, 'Quantite trop elevee.')
    .refine((value) => Math.round(value * 100) === value * 100, {
      message: 'La quantite doit avoir au maximum 2 decimales.',
    }),
  delivery_address: z.string().trim().min(1, "L'adresse de livraison est obligatoire.").max(300),
  delivery_zone: z.string().trim().min(1, 'La zone de livraison est obligatoire.').max(80),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
