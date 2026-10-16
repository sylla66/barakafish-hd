import type { Request, Response } from 'express';

import { AppError } from '../../lib/AppError';
import { uploadedPhoto } from '../../lib/photo-upload';
import { getStorageProvider } from '../../providers/storage';
import type { AuthUser } from '../users/users.types';
import {
  addEvidenceSchema,
  createDisputeSchema,
  listDisputesQuerySchema,
  resolveDisputeSchema,
} from './disputes.schema';
import {
  addEvidence,
  getEvidencePhotoKey,
  getForAdmin,
  getOrderDispute,
  listForAdmin,
  openDispute,
  resolveDispute,
} from './disputes.service';

function requireUser(req: Request): AuthUser {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return req.user;
}

// POST /orders/:id/dispute : l'acheteur ouvre un litige (photo obligatoire).
export async function openDisputeHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = createDisputeSchema.parse(req.body);
  const dispute = await openDispute(user, req.params.id, input, uploadedPhoto(req));
  res.status(201).json({ dispute });
}

// GET /orders/:id/dispute : litige en cours d'une commande (acheteur, vendeur, admin).
export async function getOrderDisputeHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const dispute = await getOrderDispute(user, req.params.id);
  res.status(200).json({ dispute });
}

// POST /disputes/:id/evidence : ajout d'une preuve (acheteur ou vendeur).
export async function addEvidenceHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = addEvidenceSchema.parse(req.body);
  const evidence = await addEvidence(user, req.params.id, input, uploadedPhoto(req));
  res.status(201).json({ evidence });
}

// GET /disputes/evidence/:id/photo : photo d'une preuve (parties et admin).
export async function getEvidencePhotoHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const key = await getEvidencePhotoKey(user, req.params.id);
  if (!key) {
    throw AppError.notFound('Photo introuvable.');
  }

  const file = await getStorageProvider().readFile(key);
  if (!file) {
    throw AppError.notFound('Photo introuvable.');
  }

  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(file.data);
}

// GET /admin/disputes?status=... : liste des litiges pour le back-office.
export async function listDisputesHandler(req: Request, res: Response): Promise<void> {
  const query = listDisputesQuerySchema.parse(req.query);
  const disputes = await listForAdmin(query);
  res.status(200).json({ disputes });
}

// GET /admin/disputes/:id : detail complet (commande, historique, preuves, vendeur).
export async function getDisputeHandler(req: Request, res: Response): Promise<void> {
  const admin = requireUser(req);
  const detail = await getForAdmin(admin, req.params.id);
  res.status(200).json({
    dispute: detail.dispute,
    order: detail.order,
    orderHistory: detail.orderHistory,
    sellerHistory: detail.sellerHistory,
  });
}

// POST /admin/disputes/:id/resolve : decision (refund, partial, release).
export async function resolveDisputeHandler(req: Request, res: Response): Promise<void> {
  const admin = requireUser(req);
  const input = resolveDisputeSchema.parse(req.body);
  const detail = await resolveDispute(admin, req.params.id, input);
  res.status(200).json({
    dispute: detail.dispute,
    order: detail.order,
    orderHistory: detail.orderHistory,
    sellerHistory: detail.sellerHistory,
  });
}
