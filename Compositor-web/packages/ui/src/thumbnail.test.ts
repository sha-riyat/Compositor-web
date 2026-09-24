import { describe, expect, test } from 'vitest';
import type { PixelBuffer } from '@compositor/model';
import { fittedSize, renderThumbnail } from './thumbnail.js';

/**
 * Traduction de la partie calculable de `CanvasThumbnailTests.swift`, et
 * non-régression du liseré sombre.
 */

const solid = (w: number, h: number, rgba: readonly number[]): PixelBuffer => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width: w, height: h, data, isOpaque: rgba[3] === 255 };
};

const pixel = (t: { data: Uint8ClampedArray; width: number }, x: number, y: number) =>
  [...t.data.subarray((y * t.width + x) * 4, (y * t.width + x) * 4 + 4)];

describe('proportions', () => {
  test('une image large tient dans la largeur', () => {
    const t = renderThumbnail(solid(200, 100, [0, 0, 0, 255]), 36);
    expect([t.width, t.height]).toEqual([36, 18]);
  });

  test('une image haute tient dans la hauteur', () => {
    const t = renderThumbnail(solid(100, 400, [0, 0, 0, 255]), 36);
    expect([t.width, t.height]).toEqual([9, 36]);
  });

  test('une image plus petite que la vignette est agrandie', () => {
    const t = renderThumbnail(solid(4, 4, [0, 0, 0, 255]), 36);
    expect([t.width, t.height]).toEqual([36, 36]);
  });

  test('une très grande image garde au moins un pixel sur son petit côté', () => {
    const t = renderThumbnail(solid(4000, 3, [0, 0, 0, 255]), 36);
    expect(t.height).toBeGreaterThanOrEqual(1);
  });
});

describe('couleurs', () => {
  test('un aplat opaque garde sa couleur', () => {
    const t = renderThumbnail(solid(64, 64, [200, 100, 50, 255]), 16);
    expect(pixel(t, 5, 5)).toEqual([200, 100, 50, 255]);
  });

  test('un aplat semi-transparent revient en alpha droit', () => {
    // Rouge pur à 50 %, stocké prémultiplié.
    const t = renderThumbnail(solid(8, 8, [128, 0, 0, 128]), 4);
    expect(pixel(t, 0, 0)).toEqual([255, 0, 0, 128]);
  });

  test('le totalement transparent reste à zéro', () => {
    const t = renderThumbnail(solid(8, 8, [0, 0, 0, 0]), 4);
    expect(pixel(t, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe('pas de liseré sombre aux bords transparents', () => {
  /**
   * Moitié gauche rouge opaque, moitié droite transparente, réduite à un seul
   * pixel. En prémultiplié, le pixel transparent pèse zéro : le résultat est
   * du **rouge pur** à 50 %. En alpha droit, on aurait moyenné le rouge avec du
   * noir et obtenu un rouge sombre — le liseré que ce test verrouille.
   */
  test('la moyenne ne tire pas vers le noir', () => {
    const w = 8;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w / 2; x++) data.set([255, 0, 0, 255], (y * w + x) * 4);
    }
    const t = renderThumbnail({ width: w, height: h, data, isOpaque: false }, 1);
    const [r, g, b, a] = pixel(t, 0, 0);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
    expect(a).toBeGreaterThan(120);
    expect(a).toBeLessThan(135);
  });
});

/** Traduction de `CanvasThumbnailTests.thumbnailsTakeTheCanvasShape`. */
describe('la miniature prend la forme du canevas', () => {
  test('un canevas en paysage donne une miniature en paysage', () => {
    expect(fittedSize(400, 200, 36)).toEqual({ width: 36, height: 18 });
  });

  test('un canevas en portrait donne une miniature en portrait', () => {
    expect(fittedSize(300, 600, 36)).toEqual({ width: 18, height: 36 });
  });

  test('un canevas sans taille donne le carré plein', () => {
    expect(fittedSize(0, 0, 30)).toEqual({ width: 30, height: 30 });
  });

  test('un canevas très allongé garde au moins un point de haut', () => {
    expect(fittedSize(10_000, 10, 36)).toEqual({ width: 36, height: 1 });
  });
});
