import { z } from 'zod';

export const sellerStatusSchema = z.enum(['pending', 'verified', 'suspended', 'rejected']);

const shopName = z
  .string({ required_error: "Le nom de la boutique est obligatoire." })
  .trim()
  .min(2, 'Le nom de la boutique doit contenir au moins 2 caracteres.')
  .max(120, 'Le nom de la boutique est trop long.');

const description = z.string().trim().max(2000, 'La description est trop longue.');

const zone = z
  .string({ required_error: 'La zone est obligatoire.' })
  .trim()
  .min(1, 'La zone est obligatoire.')
  .max(80, 'La zone est trop longue.');

const address = z.string().trim().max(200, "L'adresse est trop longue.");

export const createSellerProfileSchema = z.object({
  shop_name: shopName,
  description: description.optional(),
  zone,
  address: address.optional(),
});

export const updateSellerProfileSchema = z.object({
  shop_name: shopName.optional(),
  description: description.optional(),
  zone: zone.optional(),
  address: address.optional(),
});

export const rejectSellerSchema = z.object({
  reason: z
    .string({ required_error: 'Le motif de rejet est obligatoire.' })
    .trim()
    .min(3, 'Le motif de rejet est trop court.')
    .max(500, 'Le motif de rejet est trop long.'),
});

export const listSellersQuerySchema = z.object({
  status: sellerStatusSchema.optional(),
});

export type CreateSellerProfileInput = z.infer<typeof createSellerProfileSchema>;
export type UpdateSellerProfileInput = z.infer<typeof updateSellerProfileSchema>;
export type RejectSellerInput = z.infer<typeof rejectSellerSchema>;
