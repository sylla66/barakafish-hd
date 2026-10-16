import type { Request, Response } from 'express';

import { AppError } from '../../lib/AppError';
import { uploadedPhoto } from '../../lib/photo-upload';
import { getStorageProvider } from '../../providers/storage';
import type { AuthUser } from '../users/users.types';
import { createReviewSchema, listReviewsQuerySchema } from './reviews.schema';
import { createReview, getReviewPhotoKey, listSellerReviews } from './reviews.service';

function requireUser(req: Request): AuthUser {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return req.user;
}

// POST /orders/:id/review : l'acheteur note la commande (route montee dans le
// routeur des commandes, la commande est lue via req.params.id).
export async function createReviewHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = createReviewSchema.parse(req.body);
  const review = await createReview(user, req.params.id, input, uploadedPhoto(req));
  res.status(201).json({ review });
}

// GET /sellers/:id/reviews : avis publics d'un vendeur, pagines par curseur.
export async function listSellerReviewsHandler(req: Request, res: Response): Promise<void> {
  const query = listReviewsQuerySchema.parse(req.query);
  const { reviews, nextCursor } = await listSellerReviews(req.params.id, query);
  res.status(200).json({ reviews, next_cursor: nextCursor });
}

// GET /reviews/:id/photo : photo attachee a un avis (lecture publique).
export async function getReviewPhotoHandler(req: Request, res: Response): Promise<void> {
  const key = await getReviewPhotoKey(req.params.id);
  if (!key) {
    throw AppError.notFound('Photo introuvable.');
  }

  const file = await getStorageProvider().readFile(key);
  if (!file) {
    throw AppError.notFound('Photo introuvable.');
  }

  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(file.data);
}
