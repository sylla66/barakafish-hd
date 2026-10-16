import { Router } from 'express';

import { asyncHandler } from '../../lib/asyncHandler';
import { getReviewPhotoHandler } from './reviews.controller';

// Le module avis expose ici le service public de photo ; la creation d'un avis
// vit dans le routeur des commandes (POST /orders/:id/review) et la liste des
// avis d'un vendeur dans le routeur des vendeurs (GET /sellers/:id/reviews).
export const reviewsRouter = Router();

reviewsRouter.get('/:id/photo', asyncHandler(getReviewPhotoHandler));
