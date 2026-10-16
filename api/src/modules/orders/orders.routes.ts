import { Router } from 'express';

import { asyncHandler } from '../../lib/asyncHandler';
import { singlePhotoUpload } from '../../lib/photo-upload';
import { requireAuth } from '../../middleware/auth';
import {
  getOrderDisputeHandler,
  openDisputeHandler,
} from '../disputes/disputes.controller';
import { payOrderHandler } from '../payments/payments.controller';
import { createReviewHandler } from '../reviews/reviews.controller';
import {
  cancelOrderHandler,
  confirmReceiptHandler,
  createOrderHandler,
  deliverOrderHandler,
  getOrderHandler,
  getReceiptPhotoHandler,
  listOrdersHandler,
  shipOrderHandler,
} from './orders.controller';

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

ordersRouter.post('/', asyncHandler(createOrderHandler));
ordersRouter.get('/', asyncHandler(listOrdersHandler));
ordersRouter.get('/:id', asyncHandler(getOrderHandler));

// Photo de reception (service protege, avant /:id/receipt-photo).
ordersRouter.get('/:id/receipt-photo', asyncHandler(getReceiptPhotoHandler));

// Paiement sequestre : cree un paiement "initiated" et renvoie l'URL.
ordersRouter.post('/:id/pay', asyncHandler(payOrderHandler));

// Transitions declenchees par un acteur (vendeur / acheteur). Les droits et la
// validite de la transition sont verifies par transitionOrder().
ordersRouter.post('/:id/ship', asyncHandler(shipOrderHandler));
ordersRouter.post('/:id/deliver', asyncHandler(deliverOrderHandler));
ordersRouter.post('/:id/cancel', asyncHandler(cancelOrderHandler));

// Etape 8 : confirmation de reception (photo optionnelle) puis avis (photo
// optionnelle). Les deux passent par un upload d'image unique.
ordersRouter.post('/:id/confirm-receipt', singlePhotoUpload, asyncHandler(confirmReceiptHandler));
ordersRouter.post('/:id/review', singlePhotoUpload, asyncHandler(createReviewHandler));

// Etape 9 : litige. L'ouverture (photo obligatoire) suspend la liberation
// automatique ; le litige en cours est consultable par les parties.
ordersRouter.post('/:id/dispute', singlePhotoUpload, asyncHandler(openDisputeHandler));
ordersRouter.get('/:id/dispute', asyncHandler(getOrderDisputeHandler));
