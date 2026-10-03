import { describe, expect, test } from 'vitest';
import { BrushStroke, DEFAULT_BRUSH } from './brush.js';
import { createPixelBuffer } from './assets.js';
import { identityTransform, toLayerPixels } from './geometry.js';
import { materialize, replaceTiles, readTile, tileRect, TILE_SIZE, type TiledRaster } from './raster.js';

/** Traduction de la partie « tuiles » de `BrushTests.swift`. */

const red = { ...DEFAULT_BRUSH, red: 1, green: 0, blue: 0 };

const pixel = (raster: TiledRaster, x: number, y: number): number[] => {
  const image = materialize(raster);
  const at = (y * image.width + x) * 4;
  return [...image.data.subarray(at, at + 4)];
};

describe('un trait dur', () => {
  /** `continuousStrokeCrossesTilesAndCommitsOneUndo`, partie pixels. */
  test('traverse les tuiles sans couture, et rien ne déborde', () => {
    const stroke = new BrushStroke({ width: 600, height: 80, source: null }, red, 20);
    stroke.append({ x: 20, y: 40 });
    stroke.append({ x: 580, y: 40 });
    expect(stroke.patchCount).toBe(3);
    const raster = stroke.commit()!;
    for (const x of [20, 255, 256, 511, 512, 579]) expect(pixel(raster, x, 40)).toEqual([255, 0, 0, 255]);
    expect(pixel(raster, 300, 0)[3]).toBe(0);
  });

  test('l’aperçu rend exactement ce que le relâchement enregistre', () => {
    const stroke = new BrushStroke({ width: 600, height: 80, source: null }, red, 20);
    stroke.append({ x: 20, y: 40 });
    stroke.append({ x: 580, y: 40 });
    const preview = stroke.takeDirty();
    const raster = stroke.commit()!;
    expect([...preview.keys()].sort()).toEqual([...raster.tiles.keys()].sort());
    for (const [key, tile] of preview) expect(tile).toEqual(raster.tiles.get(key));
    // Plus rien de sale tant que le trait n'avance pas.
    expect(stroke.takeDirty().size).toBe(0);
  });

  test('le bord est antialiasé sur un pixel, le centre est plein', () => {
    const stroke = new BrushStroke({ width: 100, height: 100, source: null }, DEFAULT_BRUSH, 20);
    stroke.append({ x: 50, y: 50 });
    const raster = stroke.commit()!;
    expect(pixel(raster, 50, 50)).toEqual([0, 0, 0, 255]);
    // Centre du pixel à 19,81 px du centre du rond : couvert aux deux tiers.
    const edge = pixel(raster, 63, 64)[3]!;
    expect(edge).toBeGreaterThan(150);
    expect(edge).toBeLessThan(200);
    expect(pixel(raster, 70, 50)[3]).toBe(0);
  });

  /** `largeBlankCanvasOnlyAllocatesTouchedTilesUntilCommit`. */
  test('sur 10 000 × 10 000, seule la tuile touchée existe', () => {
    const stroke = new BrushStroke({ width: 10_000, height: 10_000, source: null }, DEFAULT_BRUSH, 20);
    stroke.append({ x: 100, y: 100 });
    expect(stroke.patchCount).toBe(1);
    const bytes = [...stroke.takeDirty().values()].reduce((sum, tile) => sum + tile.byteLength, 0);
    expect(bytes).toBeLessThanOrEqual(TILE_SIZE * TILE_SIZE * 4);
  });

  /** `softBrushProducesPartialAlphaAndCancelPreservesDocument`, fin. */
  test('un trait entièrement hors du calque ne produit rien', () => {
    const stroke = new BrushStroke({ width: 80, height: 80, source: null }, DEFAULT_BRUSH, 20);
    stroke.append({ x: -100, y: -100 });
    expect(stroke.commit()).toBeNull();
  });
});

describe('la copie à l’écriture', () => {
  const photo = () => {
    const buffer = createPixelBuffer(600, 300);
    for (let i = 0; i < buffer.data.length; i += 4) buffer.data.set([10, 20, 30, 255], i);
    return { ...buffer, isOpaque: true };
  };

  test('peindre ne modifie ni l’image d’origine ni le raster précédent', () => {
    const base = photo();
    const first = new BrushStroke({ width: 600, height: 300, source: base }, red, 10);
    first.append({ x: 20, y: 20 });
    const one = first.commit()!;
    expect([...base.data.subarray(0, 4)]).toEqual([10, 20, 30, 255]);

    const second = new BrushStroke({ width: 600, height: 300, source: one }, DEFAULT_BRUSH, 10);
    second.append({ x: 500, y: 250 });
    const two = second.commit()!;
    // La tuile du premier trait est partagée telle quelle, pas copiée.
    expect(two.tiles.get(0)).toBe(one.tiles.get(0));
    expect(one.tiles.size).toBe(1);
    expect(pixel(one, 500, 250)).toEqual([10, 20, 30, 255]);
    expect(pixel(two, 500, 250)).toEqual([0, 0, 0, 255]);
    expect(pixel(two, 20, 20)).toEqual([255, 0, 0, 255]);
    // Seules les tuiles neuves comptent pour le budget de l'historique.
    const added = [...two.tiles].filter(([key]) => !one.tiles.has(key));
    expect(added.map(([key]) => key).sort()).toEqual([1, 4]);
    expect(two.ownBytes).toBe(added.reduce((sum, [, tile]) => sum + tile.byteLength, 0));
  });

  test('une tuile de bord a la taille de ce qui reste de l’image', () => {
    expect(tileRect(600, 300, 2)).toEqual({ x: 512, y: 0, width: 88, height: 256 });
    expect(tileRect(600, 300, 5)).toEqual({ x: 512, y: 256, width: 88, height: 44 });
    expect(readTile(photo(), 600, 300, 5).length).toBe(88 * 44 * 4);
  });

  test('assembler un raster sans tuile rend la base elle-même', () => {
    const base = photo();
    expect(materialize(replaceTiles(base, 600, 300, new Map()))).toBe(base);
  });
});

describe('du document aux pixels du calque', () => {
  test('placement, mise à l’échelle, rotation et retournement', () => {
    const t = identityTransform({ width: 200, height: 100 }, { x: 50, y: 50 });
    expect(toLayerPixels(t, 400, 200, { x: 50, y: 50 })).toEqual({ x: 0, y: 0 });
    expect(toLayerPixels(t, 400, 200, { x: 150, y: 100 })).toEqual({ x: 200, y: 100 });
    const flipped = toLayerPixels({ ...t, flipX: true }, 400, 200, { x: 50, y: 50 });
    expect(flipped.x).toBeCloseTo(400);
    // Un quart de tour horaire : le haut du calque regarde vers la droite.
    const turned = toLayerPixels({ ...t, rotation: 90 }, 400, 200, { x: 200, y: 100 });
    expect(turned.x).toBeCloseTo(200);
    expect(turned.y).toBeCloseTo(0);
  });
});
