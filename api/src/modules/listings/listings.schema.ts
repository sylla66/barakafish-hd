import { z } from 'zod';

export const listingStateSchema = z.enum(['fresh', 'frozen_at_sea', 'frozen']);

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const speciesId = z.coerce
  .number({ invalid_type_error: "L'espece est obligatoire." })
  .int()
  .positive('Espece invalide.');

const title = z
  .string({ required_error: 'Le titre est obligatoire.' })
  .trim()
  .min(3, 'Le titre doit contenir au moins 3 caracteres.')
  .max(120, 'Le titre est trop long.');

const description = z.string().trim().max(2000, 'La description est trop longue.');

const caughtOrFrozenOn = z
  .string({ required_error: 'La date de peche ou de congelation est obligatoire.' })
  .regex(DATE_ONLY_REGEX, 'Date attendue au format AAAA-MM-JJ.');

const storageConditions = z
  .string({ required_error: 'Les conditions de conservation sont obligatoires.' })
  .trim()
  .min(2, 'Les conditions de conservation sont obligatoires.')
  .max(200, 'Les conditions de conservation sont trop longues.');

const quantityKg = z.coerce
  .number({ invalid_type_error: 'La quantite est obligatoire.' })
  .positive('La quantite doit etre superieure a 0.')
  .max(1_000_000, 'La quantite est trop elevee.');

const minOrderKg = z.coerce
  .number({ invalid_type_error: 'La commande minimum est obligatoire.' })
  .positive('La commande minimum doit etre superieure a 0.')
  .max(1_000_000, 'La commande minimum est trop elevee.');

const pricePerKg = z.coerce
  .number({ invalid_type_error: 'Le prix au kilo est obligatoire.' })
  .int('Le prix doit etre un entier en FCFA.')
  .positive('Le prix au kilo doit etre superieur a 0.')
  .max(100_000_000, 'Le prix au kilo est trop eleve.');

const zone = z
  .string({ required_error: 'La zone est obligatoire.' })
  .trim()
  .min(1, 'La zone est obligatoire.')
  .max(80, 'La zone est trop longue.');

export const createListingSchema = z.object({
  species_id: speciesId,
  title,
  description: description.optional(),
  state: listingStateSchema,
  caught_or_frozen_on: caughtOrFrozenOn,
  storage_conditions: storageConditions,
  quantity_kg: quantityKg,
  min_order_kg: minOrderKg,
  price_per_kg: pricePerKg,
  zone,
});

// Mise a jour : tous les champs sont optionnels. Le statut ne peut etre bascule
// manuellement qu'entre 'draft' et 'active' ('sold_out' vient des commandes,
// 'archived' vient de la suppression logique).
export const updateListingSchema = z.object({
  species_id: speciesId.optional(),
  title: title.optional(),
  description: description.optional(),
  state: listingStateSchema.optional(),
  caught_or_frozen_on: caughtOrFrozenOn.optional(),
  storage_conditions: storageConditions.optional(),
  quantity_kg: quantityKg.optional(),
  min_order_kg: minOrderKg.optional(),
  price_per_kg: pricePerKg.optional(),
  zone: zone.optional(),
  status: z.enum(['draft', 'active']).optional(),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;

// Parametre de requete booleen tolerant ('true'/'false'/'1'/'0').
const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

export const listingSortSchema = z.enum(['recent', 'price_asc', 'price_desc', 'rating']);
export type ListingSortInput = z.infer<typeof listingSortSchema>;

export const searchListingsQuerySchema = z.object({
  species_id: z.coerce.number().int().positive().optional(),
  category: z.string().trim().min(1).max(40).optional(),
  state: listingStateSchema.optional(),
  zone: z.string().trim().min(1).max(80).optional(),
  price_min: z.coerce.number().int().min(0).optional(),
  price_max: z.coerce.number().int().min(0).optional(),
  seller_verified: booleanish.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sort: listingSortSchema.default('recent'),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchListingsQuery = z.infer<typeof searchListingsQuerySchema>;

// Contenu du curseur de pagination (cle keyset encodee en base64url).
export const listingCursorSchema = z.object({
  s: listingSortSchema,
  sp: z.boolean(),
  v: z.string(),
  id: z.string().uuid(),
});
export type ListingCursor = z.infer<typeof listingCursorSchema>;
