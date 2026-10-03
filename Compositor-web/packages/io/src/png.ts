import { zlibSync } from 'fflate';

/**
 * Un encodeur PNG sans canevas : RGBA 8 bits, alpha **droit**.
 *
 * `OffscreenCanvas.convertToBlob` ne rendait parfois jamais sa promesse : un
 * projet de 25 images restait bloqué, trois fois sur trois, sur la même image.
 * Ici, rien ne dépend du navigateur : les octets écrits sont exactement ceux
 * reçus, dans Chrome, Firefox et Safari comme en Node, et en worker.
 *
 * Chaque ligne prend le filtre qui minimise la somme des différences absolues
 * — l'heuristique que libpng applique par défaut.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Un morceau PNG : longueur, type, données, CRC du type et des données. */
const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Les cinq filtres de ligne, appliqués à une ligne RGBA. */
const filterRow = (type: number, row: Uint8Array, previous: Uint8Array | null, out: Uint8Array): void => {
  for (let i = 0; i < row.length; i++) {
    const left = i >= 4 ? row[i - 4]! : 0;
    const up = previous === null ? 0 : previous[i]!;
    const upLeft = previous === null || i < 4 ? 0 : previous[i - 4]!;
    const predicted =
      type === 1 ? left : type === 2 ? up : type === 3 ? (left + up) >> 1 : type === 4 ? paeth(left, up, upLeft) : 0;
    out[i] = (row[i]! - predicted) & 0xff;
  }
};

/** Octets d'un PNG RGBA 8 bits à partir de pixels en alpha **droit**. */
export const encodePNGBytes = (straight: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array => {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  const candidate = new Uint8Array(stride);
  const best = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(straight.buffer, straight.byteOffset + y * stride, stride);
    const previous = y === 0 ? null : new Uint8Array(straight.buffer, straight.byteOffset + (y - 1) * stride, stride);
    let bestType = 0;
    let bestScore = Infinity;
    for (let type = 0; type <= 4; type++) {
      filterRow(type, row, previous, candidate);
      let score = 0;
      for (const byte of candidate) score += byte < 128 ? byte : 256 - byte;
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        best.set(candidate);
      }
    }
    raw[y * (stride + 1)] = bestType;
    raw.set(best, y * (stride + 1) + 1);
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, deflate, filtres adaptatifs, sans entrelacement

  const parts = [
    new Uint8Array(SIGNATURE),
    chunk('IHDR', header),
    chunk('sRGB', new Uint8Array([0])), // les octets sont en sRGB : le dire
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
