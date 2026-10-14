import sharp from 'sharp';

// Dimension maximale (largeur ou hauteur) des photos d'annonces. Les images sont
// reduites (jamais agrandies) puis reencodees en JPEG pour alleger les envois sur
// reseau mobile.
export const MAX_IMAGE_DIMENSION = 1280;
export const JPEG_QUALITY = 82;

export async function processListingPhoto(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate() // applique l'orientation EXIF avant de la supprimer
    .resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}
