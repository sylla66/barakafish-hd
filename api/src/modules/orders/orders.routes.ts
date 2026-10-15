import { Router } from 'express';

import { asyncHandler } from '../../lib/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { payOrderHandler } from '../payments/payments.controller';
import {
  cancelOrderHandler,
  createOrderHandler,
  deliverOrderHandler,
  getOrderHandler,
  listOrdersHandler,
  shipOrderHandler,
} from './orders.controller';

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

ordersRouter.post('/', asyncHandler(createOrderHandler));
ordersRouter.get('/', asyncHandler(listOrdersHandler));
ordersRouter.get('/:id', asyncHandler(getOrderHandler));

// Paiement sequestre : cree un paiement "initiated" et renvoie l'URL.
ordersRouter.post('/:id/pay', asyncHandler(payOrderHandler));

// Transitions declenchees par un acteur (vendeur / acheteur). Les droits et la
// validite de la transition sont verifies par transitionOrder().
ordersRouter.post('/:id/ship', asyncHandler(shipOrderHandler));
ordersRouter.post('/:id/deliver', asyncHandler(deliverOrderHandler));
ordersRouter.post('/:id/cancel', asyncHandler(cancelOrderHandler));
