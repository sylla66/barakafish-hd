// Compression des photos cote client avant envoi : on reduit la dimension a
// 1280 px maximum et on reencode en JPEG. Indispensable sur reseau mobile.
const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.82;

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return file;
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) {
      return file;
    }

    return new File([blob], toJpegName(file.name), { type: 'image/jpeg' });
  } catch {
    // Si le navigateur ne sait pas lire l'image, on envoie le fichier original
    // (le serveur reste seul juge via sharp).
    return file;
  }
}

function toJpegName(name: string): string {
  return `${name.replace(/\.[^.]+$/, '')}.jpg`;
}
