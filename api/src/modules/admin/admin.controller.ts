import type { Request, Response } from 'express';

import { AppError } from '../../lib/AppError';
import { listSellersQuerySchema, rejectSellerSchema } from '../sellers/sellers.schema';
import { listForAdmin, rejectSeller, suspendSeller, verifySeller } from '../sellers/sellers.service';

function requireAdmin(req: Request) {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return req.user;
}

export async function listSellersHandler(req: Request, res: Response): Promise<void> {
  const { status } = listSellersQuerySchema.parse(req.query);
  const sellers = await listForAdmin(status);
  res.status(200).json({ sellers });
}

export async function verifySellerHandler(req: Request, res: Response): Promise<void> {
  const admin = requireAdmin(req);
  const profile = await verifySeller(req.params.id, admin.id);
  res.status(200).json({ profile });
}

export async function rejectSellerHandler(req: Request, res: Response): Promise<void> {
  const admin = requireAdmin(req);
  const { reason } = rejectSellerSchema.parse(req.body);
  const profile = await rejectSeller(req.params.id, admin.id, reason);
  res.status(200).json({ profile });
}

export async function suspendSellerHandler(req: Request, res: Response): Promise<void> {
  requireAdmin(req);
  const profile = await suspendSeller(req.params.id);
  res.status(200).json({ profile });
}
