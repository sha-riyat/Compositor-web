import type { PixelBuffer } from '@compositor/model';
import { premultiply } from './alpha.js';

/**
 * Import d'image. **Un seul format en T1 — PNG.** JPEG, HEIC et TIFF sont des
 * no-gos explicites du pari ; ils arrivent avec les tranches suivantes.
 */

export const ACCEPTED_TYPES = ['image/png'] as const;

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/**
 * Décode un fichier en pixels RGBA prémultipliés, sans conversion d'espace
 * colorimétrique : les octets doivent arriver tels qu'ils sont écrits dans le
 * fichier, puisque toute la composition se fait en sRGB non linéaire.
 */
export const decodeImageFile = async (
  file: File,
  maxSide: number,
): Promise<PixelBuffer> => {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    throw new ImportError(
      `Format non pris en charge : ${file.type || 'inconnu'}. Seul le PNG est accepté pour l'instant.`,
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      premultiplyAlpha: 'premultiply',
      colorSpaceConversion: 'none',
    });
  } catch (cause) {
    throw new ImportError("Ce fichier n'a pas pu être décodé comme une image.");
  }

  try {
    if (bitmap.width > maxSide || bitmap.height > maxSide) {
      throw new ImportError(
        `Image trop grande : ${bitmap.width} × ${bitmap.height} px. ` +
          `La limite est de ${maxSide} px par côté tant que le compositeur n'est pas pavé.`,
      );
    }

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', {
      willReadFrequently: true,
      colorSpace: 'srgb',
    });
    if (context === null) throw new ImportError('Contexte 2D indisponible pour le décodage.');

    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height, {
      colorSpace: 'srgb',
    });

    // `getImageData` rend toujours de l'alpha **droit** : on repasse en
    // prémultiplié, le format attendu partout ailleurs (invariant ②).
    return {
      width: bitmap.width,
      height: bitmap.height,
      data: premultiply(imageData.data),
    };
  } finally {
    bitmap.close();
  }
};

/** Le premier fichier accepté d'un dépôt, ou `null`. */
export const firstImageFile = (transfer: DataTransfer | null): File | null => {
  if (transfer === null) return null;
  for (const item of Array.from(transfer.files)) {
    if ((ACCEPTED_TYPES as readonly string[]).includes(item.type)) return item;
  }
  return transfer.files.length > 0 ? (transfer.files.item(0) ?? null) : null;
};
