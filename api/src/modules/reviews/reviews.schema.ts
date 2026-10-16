import { z } from 'zod';

// Un avis porte une note de 1 a 5 et un commentaire optionnel (500 caracteres).
// Les champs arrivent en multipart (formulaire avec photo) : rating est une
// chaine, d'ou z.coerce.
export const createReviewSchema = z.object({
  rating: z.coerce
    .number({ invalid_type_error: 'La note doit etre un nombre.' })
    .int('La note doit etre un entier de 1 a 5.')
    .min(1, 'La note doit etre comprise entre 1 et 5.')
    .max(5, 'La note doit etre comprise entre 1 et 5.'),
  comment: z
    .string()
    .trim()
    .max(500, 'Le commentaire est limite a 500 caracteres.')
    .optional(),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const listReviewsQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

export const reviewCursorSchema = z.object({
  v: z.string().min(1),
  id: z.string().uuid(),
});

export type ReviewCursor = z.infer<typeof reviewCursorSchema>;
