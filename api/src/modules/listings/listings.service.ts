import { pool } from '../../db/pool';
import { AppError } from '../../lib/AppError';
import { processListingPhoto } from '../../lib/image';
import { getStorageProvider } from '../../providers/storage';
import { assertSellerCanPublish } from '../sellers/sellers.service';
import { speciesExists } from '../species/species.service';
import type { CreateListingInput, UpdateListingInput } from './listings.schema';
import type { Listing, ListingState, ListingStatus } from './listings.types';

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
export const MAX_PHOTOS = 5;

interface ListingRow {
  id: string;
  seller_id: string;
  species_id: number;
  species_name_fr: string;
  species_name_wo: string | null;
  title: string;
  description: string | null;
  state: ListingState;
  caught_or_frozen_on: string;
  storage_conditions: string;
  quantity_kg: string;
  min_order_kg: string;
  price_per_kg: number;
  zone: string;
  status: ListingStatus;
  created_at: Date;
  updated_at: Date;
}

interface PhotoRow {
  id: string;
  position: number;
}

const LISTING_SELECT = `
  SELECT l.id, l.seller_id, l.species_id, s.name_fr AS species_name_fr, s.name_wo AS species_name_wo,
         l.title, l.description, l.state,
         to_char(l.caught_or_frozen_on, 'YYYY-MM-DD') AS caught_or_frozen_on,
         l.storage_conditions, l.quantity_kg, l.min_order_kg, l.price_per_kg, l.zone,
         l.status, l.created_at, l.updated_at
    FROM listings l
    JOIN species s ON s.id = l.species_id`;

function toListing(row: ListingRow, photos: PhotoRow[]): Listing {
  return {
    id: row.id,
    sellerId: row.seller_id,
    speciesId: row.species_id,
    speciesNameFr: row.species_name_fr,
    speciesNameWo: row.species_name_wo,
    title: row.title,
    description: row.description,
    state: row.state,
    caughtOrFrozenOn: row.caught_or_frozen_on,
    storageConditions: row.storage_conditions,
    quantityKg: Number(row.quantity_kg),
    minOrderKg: Number(row.min_order_kg),
    pricePerKg: row.price_per_kg,
    zone: row.zone,
    status: row.status,
    photos: photos.map((photo) => ({
      id: photo.id,
      position: photo.position,
      url: `/listings/photos/${photo.id}`,
    })),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function fetchPhotos(listingId: string): Promise<PhotoRow[]> {
  const result = await pool.query<PhotoRow>(
    'SELECT id, position FROM listing_photos WHERE listing_id = $1 ORDER BY position ASC',
    [listingId],
  );
  return result.rows;
}

async function findListingRow(id: string): Promise<ListingRow | null> {
  const result = await pool.query<ListingRow>(`${LISTING_SELECT} WHERE l.id = $1`, [id]);
  return result.rows[0] ?? null;
}

async function loadListing(id: string): Promise<Listing> {
  const row = await findListingRow(id);
  if (!row) {
    throw AppError.notFound('Annonce introuvable.');
  }
  const photos = await fetchPhotos(id);
  return toListing(row, photos);
}

// Verifie que l'annonce appartient bien au vendeur connecte.
async function loadOwnedListing(userId: string, id: string): Promise<ListingRow> {
  const row = await findListingRow(id);
  if (!row) {
    throw AppError.notFound('Annonce introuvable.');
  }
  if (row.seller_id !== userId) {
    throw AppError.forbidden("Vous ne pouvez modifier que vos propres annonces.");
  }
  return row;
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Regles metier sur la date : jamais dans le futur, et une annonce 'fresh' ne peut
// pas dater de plus de 3 jours (qualite du produit frais).
function assertValidDates(state: ListingState, caughtOrFrozenOn: string): void {
  const date = parseDateOnly(caughtOrFrozenOn);
  if (Number.isNaN(date.getTime())) {
    throw AppError.badRequest('Date de peche ou de congelation invalide.');
  }
  const today = todayUtc();
  if (date.getTime() > today.getTime()) {
    throw AppError.badRequest('La date de peche ou de congelation ne peut pas etre dans le futur.');
  }
  if (state === 'fresh') {
    const ageInDays = (today.getTime() - date.getTime()) / MILLIS_PER_DAY;
    if (ageInDays > 3) {
      throw AppError.badRequest("Une annonce 'frais' ne peut pas dater de plus de 3 jours.");
    }
  }
}

function assertOrderBounds(quantityKg: number, minOrderKg: number): void {
  if (minOrderKg > quantityKg) {
    throw AppError.badRequest('La commande minimum ne peut pas depasser la quantite disponible.');
  }
}

async function assertSpeciesKnown(speciesId: number): Promise<void> {
  if (!(await speciesExists(speciesId))) {
    throw AppError.badRequest('Espece inconnue.');
  }
}

// Reencodage (redimensionnement + JPEG) puis stockage des photos d'une annonce.
async function savePhotos(listingId: string, files: Express.Multer.File[]): Promise<PhotoRow[]> {
  const storage = getStorageProvider();
  const category = `listings/${listingId}`;
  const saved: PhotoRow[] = [];

  for (const file of files) {
    let processed: Buffer;
    try {
      processed = await processListingPhoto(file.buffer);
    } catch {
      throw AppError.badRequest('Une des photos est illisible (image invalide).');
    }
    const { key } = await storage.saveFile({
      buffer: processed,
      originalName: file.originalname,
      mimeType: 'image/jpeg',
      category,
    });
    const result = await pool.query<PhotoRow>(
      `INSERT INTO listing_photos (listing_id, url, position)
       VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM listing_photos WHERE listing_id = $1), 0))
       RETURNING id, position`,
      [listingId, key],
    );
    saved.push(result.rows[0]);
  }

  return saved;
}

export async function createListing(
  userId: string,
  input: CreateListingInput,
  files: Express.Multer.File[],
): Promise<Listing> {
  await assertSellerCanPublish(userId);
  await assertSpeciesKnown(input.species_id);
  assertValidDates(input.state, input.caught_or_frozen_on);
  assertOrderBounds(input.quantity_kg, input.min_order_kg);

  const status: ListingStatus = files.length > 0 ? 'active' : 'draft';

  const client = await pool.connect();
  let listingId: string;
  try {
    await client.query('BEGIN');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO listings
         (seller_id, species_id, title, description, state, caught_or_frozen_on,
          storage_conditions, quantity_kg, min_order_kg, price_per_kg, zone, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        userId,
        input.species_id,
        input.title,
        input.description ?? null,
        input.state,
        input.caught_or_frozen_on,
        input.storage_conditions,
        input.quantity_kg,
        input.min_order_kg,
        input.price_per_kg,
        input.zone,
        status,
      ],
    );
    listingId = inserted.rows[0].id;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (files.length > 0) {
    await savePhotos(listingId, files);
  }

  return loadListing(listingId);
}

export async function updateListing(
  userId: string,
  id: string,
  input: UpdateListingInput,
): Promise<Listing> {
  const row = await loadOwnedListing(userId, id);

  if (row.status === 'archived') {
    throw AppError.conflict("Une annonce archivee ne peut plus etre modifiee.");
  }

  if (input.species_id !== undefined) {
    await assertSpeciesKnown(input.species_id);
  }

  const state = input.state ?? row.state;
  const caughtOrFrozenOn = input.caught_or_frozen_on ?? row.caught_or_frozen_on;
  const quantityKg = input.quantity_kg ?? Number(row.quantity_kg);
  const minOrderKg = input.min_order_kg ?? Number(row.min_order_kg);
  assertValidDates(state, caughtOrFrozenOn);
  assertOrderBounds(quantityKg, minOrderKg);

  if (input.status === 'active') {
    const photos = await fetchPhotos(id);
    if (photos.length === 0) {
      throw AppError.badRequest("Une annonce ne peut etre publiee qu'avec au moins une photo.");
    }
  }

  const assignments: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown): void => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (input.species_id !== undefined) assign('species_id', input.species_id);
  if (input.title !== undefined) assign('title', input.title);
  if (input.description !== undefined) assign('description', input.description);
  if (input.state !== undefined) assign('state', input.state);
  if (input.caught_or_frozen_on !== undefined) assign('caught_or_frozen_on', input.caught_or_frozen_on);
  if (input.storage_conditions !== undefined) assign('storage_conditions', input.storage_conditions);
  if (input.quantity_kg !== undefined) assign('quantity_kg', input.quantity_kg);
  if (input.min_order_kg !== undefined) assign('min_order_kg', input.min_order_kg);
  if (input.price_per_kg !== undefined) assign('price_per_kg', input.price_per_kg);
  if (input.zone !== undefined) assign('zone', input.zone);
  if (input.status !== undefined) assign('status', input.status);

  assignments.push('updated_at = now()');
  values.push(id);

  await pool.query(
    `UPDATE listings SET ${assignments.join(', ')} WHERE id = $${values.length}`,
    values,
  );

  return loadListing(id);
}

// Suppression logique : on archive l'annonce au lieu de la retirer physiquement
// (elle reste liee aux commandes passees).
export async function archiveListing(userId: string, id: string): Promise<Listing> {
  await loadOwnedListing(userId, id);
  await pool.query("UPDATE listings SET status = 'archived', updated_at = now() WHERE id = $1", [id]);
  return loadListing(id);
}

export async function addListingPhotos(
  userId: string,
  id: string,
  files: Express.Multer.File[],
): Promise<Listing> {
  const row = await loadOwnedListing(userId, id);

  if (row.status === 'archived') {
    throw AppError.conflict('Une annonce archivee ne peut plus recevoir de photos.');
  }
  if (files.length === 0) {
    throw AppError.badRequest('Aucune photo fournie.');
  }

  const existing = await fetchPhotos(id);
  if (existing.length + files.length > MAX_PHOTOS) {
    throw AppError.badRequest(`Maximum ${MAX_PHOTOS} photos par annonce.`);
  }

  await savePhotos(id, files);

  // Une annonce en brouillon ayant des photos devient active.
  if (row.status === 'draft') {
    await pool.query("UPDATE listings SET status = 'active', updated_at = now() WHERE id = $1", [id]);
  } else {
    await pool.query('UPDATE listings SET updated_at = now() WHERE id = $1', [id]);
  }

  return loadListing(id);
}

export async function removeListingPhoto(
  userId: string,
  id: string,
  photoId: string,
): Promise<Listing> {
  await loadOwnedListing(userId, id);

  const result = await pool.query('DELETE FROM listing_photos WHERE id = $1 AND listing_id = $2', [
    photoId,
    id,
  ]);
  if (result.rowCount === 0) {
    throw AppError.notFound('Photo introuvable.');
  }

  await pool.query('UPDATE listings SET updated_at = now() WHERE id = $1', [id]);
  return loadListing(id);
}

export async function getListing(id: string): Promise<Listing> {
  return loadListing(id);
}

export async function listMyListings(userId: string): Promise<Listing[]> {
  const result = await pool.query<ListingRow>(
    `${LISTING_SELECT} WHERE l.seller_id = $1 ORDER BY l.created_at DESC`,
    [userId],
  );

  return Promise.all(
    result.rows.map(async (row) => toListing(row, await fetchPhotos(row.id))),
  );
}

// Cle de stockage d'une photo, pour la route publique de service d'image.
export async function getPhotoKey(photoId: string): Promise<string | null> {
  const result = await pool.query<{ url: string }>(
    'SELECT url FROM listing_photos WHERE id = $1',
    [photoId],
  );
  return result.rows[0]?.url ?? null;
}

// Note etape 6 : quand une commande fait tomber quantity_kg a 0, on passera le
// statut de l'annonce a 'sold_out' depuis le module commandes (transition unique
// cote service, jamais en mise a jour directe du champ).
