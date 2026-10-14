import type { Request, Response } from 'express';

import { AppError } from '../../lib/AppError';
import { getStorageProvider } from '../../providers/storage';
import { createListingSchema, updateListingSchema } from './listings.schema';
import {
  addListingPhotos,
  archiveListing,
  createListing,
  getListing,
  getPhotoKey,
  listMyListings,
  removeListingPhoto,
  updateListing,
} from './listings.service';

function requireUser(req: Request) {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return req.user;
}

function photoFiles(req: Request): Express.Multer.File[] {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  return files.photos ?? [];
}

export async function createListingHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = createListingSchema.parse(req.body);
  const listing = await createListing(user.id, input, photoFiles(req));
  res.status(201).json({ listing });
}

export async function updateListingHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = updateListingSchema.parse(req.body);
  const listing = await updateListing(user.id, req.params.id, input);
  res.status(200).json({ listing });
}

export async function archiveListingHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const listing = await archiveListing(user.id, req.params.id);
  res.status(200).json({ listing });
}

export async function listMyListingsHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const listings = await listMyListings(user.id);
  res.status(200).json({ listings });
}

export async function addPhotosHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const listing = await addListingPhotos(user.id, req.params.id, photoFiles(req));
  res.status(200).json({ listing });
}

export async function removePhotoHandler(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const listing = await removeListingPhoto(user.id, req.params.id, req.params.photoId);
  res.status(200).json({ listing });
}

export async function getListingHandler(req: Request, res: Response): Promise<void> {
  const listing = await getListing(req.params.id);
  res.status(200).json({ listing });
}

// Service public d'image : sert une photo d'annonce par son identifiant. Les
// fichiers restent hors du repertoire statique et passent par le stockage.
export async function getListingPhotoHandler(req: Request, res: Response): Promise<void> {
  const key = await getPhotoKey(req.params.photoId);
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
