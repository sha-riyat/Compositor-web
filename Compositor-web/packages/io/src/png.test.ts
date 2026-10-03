import { describe, expect, test } from 'vitest';
import { unzlibSync } from 'fflate';
import { crc32, encodePNGBytes } from './png.js';

/**
 * L'encodeur PNG, vérifié par un décodeur écrit ici, indépendamment : chaque
 * morceau et son CRC, l'en-tête, puis les lignes décompressées et défiltrées
 * doivent redonner **exactement** les octets reçus.
 */

const decode = (png: Uint8Array) => {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset);
  const chunks: { type: string; data: Uint8Array }[] = [];
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    expect(view.getUint32(at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)));
    chunks.push({ type, data });
    at += 12 + length;
  }
  const header = new DataView(chunks[0]!.data.buffer, chunks[0]!.data.byteOffset);
  const width = header.getUint32(0);
  const height = header.getUint32(4);
  expect([...chunks[0]!.data.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
  const raw = unzlibSync(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)[0]!);
  const stride = width * 4;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const value = raw[y * (stride + 1) + 1 + i]!;
      const left = i >= 4 ? out[y * stride + i - 4]! : 0;
      const up = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const upLeft = y > 0 && i >= 4 ? out[(y - 1) * stride + i - 4]! : 0;
      const p = left + up - upLeft;
      const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
      const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      const predicted = [0, left, up, (left + up) >> 1, paeth][type]!;
      out[y * stride + i] = (value + predicted) & 0xff;
    }
  }
  return { width, height, pixels: out, types: chunks.map((c) => c.type) };
};

const image = (width: number, height: number, fill: (x: number, y: number, c: number) => number) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = fill(x, y, c);
  return data;
};

describe('l’encodeur PNG sans canevas', () => {
  test('les octets reviennent exactement, sur les 256 niveaux d’alpha', () => {
    const data = image(256, 3, (x, y, c) => (c === 3 ? x : (x * (c + 1) + y * 31) % 256));
    const decoded = decode(encodePNGBytes(data, 256, 3));
    expect([decoded.width, decoded.height]).toEqual([256, 3]);
    expect(decoded.pixels).toEqual(new Uint8Array(data));
  });

  test('des tailles impaires, une image d’un pixel, du bruit', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 0xff;
    for (const [w, h] of [[1, 1], [3, 5], [17, 2], [64, 64]] as const) {
      const data = image(w, h, () => random());
      expect(decode(encodePNGBytes(data, w, h)).pixels).toEqual(new Uint8Array(data));
    }
  });

  test('un morceau sRGB, et les morceaux dans l’ordre', () => {
    expect(decode(encodePNGBytes(image(2, 2, () => 9), 2, 2)).types).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND']);
  });

  test('les filtres compressent : un dégradé pèse bien moins que ses octets bruts', () => {
    const data = image(512, 512, (x, y, c) => (c === 3 ? 255 : (x + y) >> 2));
    expect(encodePNGBytes(data, 512, 512).length).toBeLessThan((512 * 512 * 4) / 20);
  });

  test('le CRC d’une valeur connue', () => {
    // « IEND » sans données : CRC normalisé AE 42 60 82.
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });
});
