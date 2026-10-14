import type { Request, Response } from 'express';

import { AppError } from '../../lib/AppError';
import { getStorageProvider } from '../../providers/storage';
import { createSellerProfileSchema, updateSellerProfileSchema } from './sellers.schema';
import {
  createProfile,
  getOwnProfile,
  getPublicProfile,
  getSellerDocumentKey,
  saveDocuments,
  updateProfile,
  type SellerDocumentFiles,
} from './sellers.service';
import type { SellerDocumentType } from './sellers.types';

function requireUser(req: Request) {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return req.user;
}

function parseDocumentType(value: string): SellerDocumentType {
  if (value === 'identity' || value === 'sanitary' || value === 'facility' || value === 'business') {
    return value;
  }
  throw AppError.badRequest(
    'Type de document inconnu. Valeurs acceptees : identity, sanitary, facility, business.',
  );
}

export async function createProfileHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = createSellerProfileSchema.parse(req.body);
  const profile = await createProfile(user.id, input);
  res.status(201).json({ profile });
}

export async function updateProfileHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = updateSellerProfileSchema.parse(req.body);
  const profile = await updateProfile(user.id, input);
  res.status(200).json({ profile });
}

export async function getOwnProfileHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const profile = await getOwnProfile(user.id);
  res.status(200).json({ profile });
}

export async function uploadDocumentsHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);

  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const documentFiles: SellerDocumentFiles = {
    identity: files.identity_document?.[0],
    sanitary: files.sanitary_document?.[0],
    facility: files.facility_photo?.[0],
    business: files.business_document?.[0],
  };

  const profile = await saveDocuments(user.id, documentFiles);
  res.status(200).json({ profile });
}

export async function getPublicProfileHandler(req: Request, res: Response): Promise<void> {
  const profile = await getPublicProfile(req.params.id);
  res.status(200).json({ profile });
}

// Telechargement des documents. Les pieces d'identite, documents sanitaires et
// justificatifs professionnels (mareyeur/RCCM) sont reserves aux administrateurs ;
// la photo de l'installation reste visible par le proprietaire et les admins.
export async function downloadDocumentHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const sellerId = req.params.id;
  const type = parseDocumentType(req.params.type);

  const isAdmin = user.isAdmin;
  const isOwner = user.id === sellerId;
  const isSensitive = type !== 'facility';

  if (isSensitive && !isAdmin) {
    throw AppError.forbidden("Ce document n'est accessible qu'aux administrateurs.");
  }
  if (!isSensitive && !isAdmin && !isOwner) {
    throw AppError.forbidden("Ce document n'est accessible qu'a son proprietaire ou a un administrateur.");
  }

  const key = await getSellerDocumentKey(sellerId, type);
  if (!key) {
    throw AppError.notFound('Document introuvable.');
  }

  const file = await getStorageProvider().readFile(key);
  if (!file) {
    throw AppError.notFound('Document introuvable.');
  }

  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', 'inline');
  res.send(file.data);
}
