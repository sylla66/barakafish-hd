import type { Request, Response } from 'express';

import { AppError } from '../../lib/AppError';
import type { AuthUser } from '../users/users.types';
import { createOrderSchema } from './orders.schema';
import { cancelOrder, createOrder, deliverOrder, getOrder, listOrders, shipOrder } from './orders.service';

function requireUser(req: Request): AuthUser {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return req.user;
}

export async function createOrderHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = createOrderSchema.parse(req.body);
  const order = await createOrder(user.id, input);
  res.status(201).json({ order });
}

export async function listOrdersHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const orders = await listOrders(user.id);
  res.status(200).json({ orders });
}

export async function getOrderHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const order = await getOrder(user.id, user.isAdmin, req.params.id);
  res.status(200).json({ order });
}

export async function shipOrderHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const order = await shipOrder(user, req.params.id);
  res.status(200).json({ order });
}

export async function deliverOrderHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const order = await deliverOrder(user, req.params.id);
  res.status(200).json({ order });
}

export async function cancelOrderHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const order = await cancelOrder(user, req.params.id);
  res.status(200).json({ order });
}
