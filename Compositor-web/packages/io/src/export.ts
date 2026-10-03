import type { CompositorDocument } from '@compositor/model';
import { unpremultiply } from './alpha.js';
import { crc32, encodePNGBytes } from './png.js';

/**
 * Export PNG. Le critère de sortie du pari passe par ici : un PNG importé puis
 * exporté sans rien toucher doit revenir identique.
 */

/**
 * Encode des pixels composés — **prémultipliés** — en PNG. Sans canevas :
 * voir `png.ts`, et pourquoi `convertToBlob` n'est plus utilisé.
 */
export const encodePNG = async (
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): Promise<Blob> => {
  const bytes = encodePNGBytes(unpremultiply(pixels), width, height);
  return new Blob([new Uint8Array(bytes)], { type: 'image/png' });
};

/**
 * Insère la résolution du document dans un PNG, sous forme de morceau `pHYs`,
 * comme le fait `ImageExporter.swift`. Un PNG sans `pHYs` est réputé être à
 * 72 dpi par les logiciels qui lisent cette information.
 */
export const withResolution = async (
  png: Blob,
  dotsPerInch: number,
): Promise<Blob> => {
  const bytes = new Uint8Array(await png.arrayBuffer());
  const perMetre = Math.round(dotsPerInch / 0.0254);

  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9); // longueur des données
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // « pHYs »
  view.setUint32(8, perMetre);
  view.setUint32(12, perMetre);
  chunk[16] = 1; // unité : le mètre
  view.setUint32(17, crc32(chunk.subarray(4, 17)));

  // Le morceau se place après IHDR, qui suit les 8 octets de signature.
  const insertAt = 8 + 4 + 4 + 13 + 4;
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(bytes.subarray(insertAt), insertAt + chunk.length);
  return new Blob([out], { type: 'image/png' });
};

export const exportDocumentPNG = async (
  document: CompositorDocument,
  pixels: Uint8ClampedArray<ArrayBuffer>,
): Promise<Blob> => {
  const png = await encodePNG(pixels, document.width, document.height);
  return withResolution(png, document.resolution);
};
