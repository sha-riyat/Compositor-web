import { describe, expect, test } from 'vitest';
import { premultiply, unpremultiply } from './alpha.js';
import { withResolution } from './export.js';

/**
 * Traduction partielle de `reference/CompositorTests/ExportTests.swift`.
 *
 * Ce qui traverse vers Node : la conversion prémultiplié → alpha droit et le
 * morceau `pHYs` de résolution. Ce qui ne traverse pas — dimensions, ordre,
 * visibilité et transformations vérifiés sur les pixels composés — exige le
 * GPU, et part en régression visuelle Playwright en T2.
 */

describe('dé-prémultiplication', () => {
  test("l'opaque est rendu tel quel", () => {
    const out = unpremultiply(new Uint8ClampedArray([255, 128, 0, 255]));
    expect([...out]).toEqual([255, 128, 0, 255]);
  });

  test('le totalement transparent garde ses zéros', () => {
    const out = unpremultiply(new Uint8ClampedArray([0, 0, 0, 0]));
    expect([...out]).toEqual([0, 0, 0, 0]);
  });

  test('un rouge pur à 50 % remonte à pleine intensité', () => {
    // Prémultiplié : 255 × 0,5 ≈ 128, alpha 128.
    const out = unpremultiply(new Uint8ClampedArray([128, 0, 0, 128]));
    expect(out[0]).toBeGreaterThan(250);
    expect(out[3]).toBe(128);
  });

  test('aucune composante ne dépasse 255', () => {
    // Cas dégénéré : une couleur supérieure à son alpha, comme après un
    // rééchantillonnage qui sonne (cf. `rgba_clamp_premultiplied`).
    const out = unpremultiply(new Uint8ClampedArray([200, 200, 200, 10]));
    expect(out[0]).toBe(255);
    expect(out[3]).toBe(10);
  });
});

describe('résolution du PNG', () => {
  /** Signature PNG plus un IHDR minimal — de quoi placer le morceau. */
  const minimalPNG = (): Blob => {
    const bytes = new Uint8Array(8 + 25 + 12);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12); // « IHDR »
    return new Blob([bytes], { type: 'image/png' });
  };

  test('le morceau pHYs est inséré juste après IHDR', async () => {
    const out = new Uint8Array(await (await withResolution(minimalPNG(), 72)).arrayBuffer());
    const at = 8 + 4 + 4 + 13 + 4;
    expect(String.fromCharCode(...out.subarray(at + 4, at + 8))).toBe('pHYs');
  });

  test('72 ppp donnent 2835 pixels par mètre, sur les deux axes', async () => {
    const out = new Uint8Array(await (await withResolution(minimalPNG(), 72)).arrayBuffer());
    const view = new DataView(out.buffer);
    const at = 8 + 4 + 4 + 13 + 4;
    expect(view.getUint32(at + 8)).toBe(2835);
    expect(view.getUint32(at + 12)).toBe(2835);
    expect(out[at + 16]).toBe(1); // unité : le mètre
  });

  test('300 ppp donnent 11811 pixels par mètre', async () => {
    const out = new Uint8Array(await (await withResolution(minimalPNG(), 300)).arrayBuffer());
    const at = 8 + 4 + 4 + 13 + 4;
    expect(new DataView(out.buffer).getUint32(at + 8)).toBe(11_811);
  });

  test("le CRC du morceau correspond à son contenu", async () => {
    const out = new Uint8Array(await (await withResolution(minimalPNG(), 72)).arrayBuffer());
    const at = 8 + 4 + 4 + 13 + 4;
    const declared = new DataView(out.buffer).getUint32(at + 17);
    expect(declared).toBe(crc32(out.subarray(at + 4, at + 17)));
  });

  test('le reste du fichier est conservé intact', async () => {
    const original = new Uint8Array(await minimalPNG().arrayBuffer());
    const out = new Uint8Array(await (await withResolution(minimalPNG(), 72)).arrayBuffer());
    expect(out.length).toBe(original.length + 21);
    expect([...out.subarray(0, 33)]).toEqual([...original.subarray(0, 33)]);
    expect([...out.subarray(33 + 21)]).toEqual([...original.subarray(33)]);
  });
});

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

/**
 * Non-régression du défaut trouvé en T1 : la chaîne prémultipliait deux fois,
 * parce que `UNPACK_PREMULTIPLY_ALPHA_WEBGL` était activé sur des octets déjà
 * prémultipliés. Le symptôme était traître — l'opaque et le totalement
 * transparent restaient corrects, seuls les pixels intermédiaires sortaient
 * assombris de moitié.
 */
describe('contrat de prémultiplication', () => {
  test('aller-retour fidèle sur les valeurs représentatives', () => {
    const straight = new Uint8ClampedArray([
      255, 0, 0, 255,      // rouge opaque
      0, 128, 255, 128,    // bleu à 50 %
      255, 255, 255, 64,   // blanc à 25 %
      0, 0, 0, 0,          // totalement transparent
    ]);
    const back = unpremultiply(premultiply(straight));
    for (let i = 0; i < straight.length; i++) {
      expect(Math.abs(back[i]! - straight[i]!)).toBeLessThanOrEqual(2);
    }
  });

  test('prémultiplier deux fois assombrit — le défaut que ce test verrouille', () => {
    const straight = new Uint8ClampedArray([0, 128, 255, 128]);
    const once = premultiply(straight);
    const twice = premultiply(once);
    expect([...once]).toEqual([0, 64, 128, 128]);
    // La seconde passe divise encore par deux : c'est exactement ce qu'on
    // observait à l'export avant correction.
    expect(twice[2]).toBeLessThan(once[2]!);
    expect([...unpremultiply(twice)]).not.toEqual([...straight]);
  });

  test('l’opaque et le totalement transparent ne bougent pas, même doublés', () => {
    const edges = new Uint8ClampedArray([255, 0, 0, 255, 9, 9, 9, 0]);
    expect([...premultiply(premultiply(edges))]).toEqual([...premultiply(edges)]);
  });
});
