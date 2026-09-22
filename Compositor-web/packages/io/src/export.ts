import type { CompositorDocument } from '@compositor/model';
import { unpremultiply } from './alpha.js';

/**
 * Export PNG. Le critère de sortie du pari passe par ici : un PNG importé puis
 * exporté sans rien toucher doit revenir identique.
 */

/** Encode des pixels composés en PNG. */
export const encodePNG = async (
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): Promise<Blob> => {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (context === null) throw new Error("Contexte 2D indisponible pour l'export.");

  const straight = unpremultiply(pixels);
  const imageData = new ImageData(straight, width, height, { colorSpace: 'srgb' });
  context.putImageData(imageData, 0, 0);

  return canvas.convertToBlob({ type: 'image/png' });
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

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
