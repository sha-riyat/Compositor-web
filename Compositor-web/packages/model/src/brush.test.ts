import { describe, expect, test } from 'vitest';
import { BrushStroke, DEFAULT_BRUSH, type BrushSettings } from './brush.js';
import { createPixelBuffer } from './assets.js';
import { applyAffine, identityTransform, invertAffine, pixelToDocument, toLayerPixels } from './geometry.js';
import { materialize, replaceTiles, readTile, tileRect, TILE_SIZE, type TiledRaster } from './raster.js';

/** Traduction de `BrushTests.swift` (partie pixels) et de `BrushIntersectionTests.swift`. */

const blank = (width: number, height: number) => ({
  width,
  height,
  source: null,
  transform: identityTransform({ width, height }),
  canvas: { width, height },
});

/** Les réglages de `BrushTests.makeSession` : 20 px, dure, rouge. */
const red: BrushSettings = { ...DEFAULT_BRUSH, diameter: 20, red: 1 };

const alphaOf = (raster: TiledRaster, x: number, y: number): number => pixelOf(raster, x, y)[3]!;

const pixelOf = (raster: TiledRaster, x: number, y: number): number[] => {
  const image = materialize(raster);
  const at = (y * image.width + x) * 4;
  return [...image.data.subarray(at, at + 4)];
};

/** Ce que l'aperçu montre maintenant — fin provisoire comprise —, sans rien valider. */
const preview = (stroke: BrushStroke): TiledRaster => replaceTiles(null, stroke.width, stroke.height, stroke.takeDirty());

/** `BrushIntersectionTests.trace` : des échantillons tous les `step` pixels, puis `flush`. */
const trace = (stroke: BrushStroke, points: readonly [number, number][], step = 12): BrushStroke => {
  stroke.append({ x: points[0]![0], y: points[0]![1] });
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    const count = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= count; k++) stroke.append({ x: ax + ((bx - ax) * k) / count, y: ay + ((by - ay) * k) / count });
  }
  stroke.flush();
  return stroke;
};

describe('un trait dur', () => {
  /** `continuousStrokeCrossesTilesAndCommitsOneUndo`, partie pixels. */
  test('traverse les tuiles sans couture, et rien ne déborde', () => {
    const stroke = new BrushStroke(blank(600, 80), { ...red, diameter: 40 });
    stroke.append({ x: 20, y: 40 });
    stroke.append({ x: 580, y: 40 });
    expect(stroke.patchCount).toBe(3);
    const raster = stroke.commit()!;
    for (const x of [20, 255, 256, 511, 512, 579]) expect(pixelOf(raster, x, 40)).toEqual([255, 0, 0, 255]);
    expect(alphaOf(raster, 300, 0)).toBe(0);
  });

  test('le bord est antialiasé sur un pixel, le centre est plein', () => {
    const stroke = new BrushStroke(blank(100, 100), DEFAULT_BRUSH);
    stroke.append({ x: 50, y: 50 });
    const raster = stroke.commit()!;
    expect(pixelOf(raster, 50, 50)).toEqual([0, 0, 0, 255]);
    // Centre du pixel à 19,81 px du centre du rond : couvert aux deux tiers.
    expect(alphaOf(raster, 63, 64)).toBe(176);
    expect(alphaOf(raster, 70, 50)).toBe(0);
  });

  /** `largeBlankCanvasOnlyAllocatesTouchedTilesUntilCommit`. */
  test('sur 10 000 × 10 000, seule la tuile touchée existe', () => {
    const stroke = new BrushStroke(blank(10_000, 10_000), red);
    stroke.append({ x: 100, y: 100 });
    expect(stroke.patchCount).toBe(1);
    const bytes = [...stroke.takeDirty().values()].reduce((sum, tile) => sum + tile.byteLength, 0);
    expect(bytes).toBeLessThanOrEqual(TILE_SIZE * TILE_SIZE * 4);
  });

  /** `softBrushProducesPartialAlphaAndCancelPreservesDocument`, fin. */
  test('un trait entièrement hors du canevas ne produit rien', () => {
    const stroke = new BrushStroke(blank(80, 80), DEFAULT_BRUSH);
    stroke.append({ x: -100, y: -100 });
    expect(stroke.commit()).toBeNull();
  });

  /** `opacityCapsTheWholeStrokeEvenWhereItOverlapsItself`. */
  test('l’opacité plafonne le trait entier, même là où il repasse', () => {
    const stroke = new BrushStroke(blank(200, 80), { ...red, opacity: 0.5 });
    stroke.append({ x: 20, y: 40 });
    for (const x of [180, 20, 180, 20, 100]) stroke.append({ x, y: 40 });
    const live = pixelOf(preview(stroke), 100, 40);
    expect(Math.abs(live[3]! - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(live[0]! - 128)).toBeLessThanOrEqual(1);
    expect(live[1]).toBe(0);
    const raster = stroke.commit()!;
    expect(pixelOf(raster, 100, 40)).toEqual(live);
    expect(alphaOf(raster, 100, 0)).toBe(0);
  });

  /** `sparseMouseSamplesFollowACurveInsteadOfStraightChords`. */
  test('des échantillons espacés suivent une courbe, pas des cordes', () => {
    const stroke = new BrushStroke(blank(300, 300), { ...red, diameter: 4 });
    const onCircle = (degrees: number) => ({
      x: 150 + Math.cos((degrees * Math.PI) / 180) * 100,
      y: 150 + Math.sin((degrees * Math.PI) / 180) * 100,
    });
    for (let degrees = 0; degrees <= 180; degrees += 30) stroke.append(onCircle(degrees));
    const raster = stroke.commit()!;
    // Une corde entre 30° et 60° passe à 3,4 px à l'intérieur de l'arc, plus loin
    // que cette brosse de 2 px de rayon ; la courbe, elle, suit l'arc.
    for (const degrees of [45, 75, 105, 135]) {
      const p = onCircle(degrees);
      expect(alphaOf(raster, Math.trunc(p.x), Math.trunc(p.y)), `arc à ${degrees}°`).toBeGreaterThan(0);
    }
  });

  /** `liveStrokeReachesNewestSampleAndTailIsReplacedExactly`. */
  test('l’aperçu atteint le dernier échantillon, et la fin droite est remplacée sans trace', () => {
    const stroke = new BrushStroke(blank(300, 120), { ...red, diameter: 8 });
    for (const [x, y] of [[20, 60], [150, 20], [280, 60]] as const) stroke.append({ x, y });
    expect(alphaOf(preview(stroke), 278, 60)).toBe(255);
    const raster = stroke.commit()!;
    expect(alphaOf(raster, 215, 40)).toBe(0); // le milieu de la corde
    expect(alphaOf(raster, 278, 60)).toBe(255);
  });
});

describe('une pointe douce', () => {
  /** `softBrushProducesPartialAlphaAndCancelPreservesDocument`. */
  test('une gaussienne sur tout le rayon : moitié à mi-rayon, rien au-delà du bord', () => {
    const stroke = new BrushStroke(blank(80, 80), { ...red, diameter: 40, hardness: 0 });
    stroke.append({ x: 40, y: 40 });
    const live = preview(stroke);
    expect(alphaOf(live, 40, 40)).toBeGreaterThan(230);
    const half = alphaOf(live, 50, 40);
    expect(half).toBeGreaterThan(95);
    expect(half).toBeLessThan(140);
    expect(alphaOf(live, 57, 40)).toBeLessThan(40);
    expect(alphaOf(live, 64, 40)).toBe(0);
  });

  /** `softStrokeBuildsCoverageWhileKeepingItsFeatheredRim`. */
  test('un trait accumule la peinture bien au-delà d’un seul dépôt', () => {
    const settings = { ...red, diameter: 40, hardness: 0 };
    const single = new BrushStroke(blank(200, 80), settings);
    single.append({ x: 100, y: 40 });
    const once = alphaOf(preview(single), 100, 50);
    const stroke = new BrushStroke(blank(200, 80), settings);
    stroke.append({ x: 20, y: 40 });
    stroke.append({ x: 180, y: 40 });
    expect(alphaOf(preview(stroke), 100, 50)).toBeGreaterThan(once + 60);
  });

  /** `spacedDabsLeaveNoVisibleRippleAlongTheStroke`. */
  test.each([0, 0.5, 1])('aucune ondulation le long du trait (dureté %s)', (hardness) => {
    const stroke = new BrushStroke(blank(900, 300), { ...red, diameter: 120, hardness });
    stroke.append({ x: 100, y: 150 });
    stroke.append({ x: 800, y: 150 });
    const live = materialize(preview(stroke));
    for (const offset of [0, 30, 50]) {
      const run = Array.from({ length: 301 }, (_, i) => live.data[((150 + offset) * 900 + 300 + i) * 4 + 3]!);
      expect(Math.max(...run) - Math.min(...run), `décalage ${offset}`).toBeLessThanOrEqual(16);
    }
  });
});

describe('les croisements d’une pointe douce', () => {
  const white = (opacity = 1, diameter = 120): BrushSettings => ({ diameter, hardness: 0, red: 1, green: 1, blue: 1, opacity });

  /** `selfCrossingsBlendInsteadOfTakingTheStrongestEdge`. */
  test('un croisement se mélange au lieu de garder le bord le plus fort', () => {
    const vertical = trace(new BrushStroke(blank(800, 800), white()), [[400, 100], [400, 700]]).commit()!;
    const horizontal = trace(new BrushStroke(blank(800, 800), white()), [[700, 400], [100, 400]]).commit()!;
    const crossing = trace(new BrushStroke(blank(800, 800), white()), [[400, 100], [400, 700], [700, 700], [700, 400], [100, 400]]).commit()!;
    for (const offset of [45, 48, 51]) {
      const a = alphaOf(vertical, 400 + offset, 400 + offset);
      const b = alphaOf(horizontal, 400 + offset, 400 + offset);
      const actual = alphaOf(crossing, 400 + offset, 400 + offset);
      const expected = 255 - Math.trunc(((255 - a) * (255 - b)) / 255);
      expect(actual).toBeGreaterThan(Math.max(a, b) + 10);
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(3);
    }
  });

  /** `accumulationDependsOnDistanceNotEventCount`. */
  test.each([12, 120, 520])('la peinture dépend de la distance, pas du nombre d’événements (%s px)', (diameter) => {
    const sparse = trace(new BrushStroke(blank(800, 800), white(1, diameter)), [[60, 400], [740, 400]], 1000).commit()!;
    const dense = trace(new BrushStroke(blank(800, 800), white(1, diameter)), [[60, 400], [740, 400]], 5).commit()!;
    for (let y = 400; y < Math.min(800, 400 + Math.trunc(diameter / 2)); y++) {
      expect(Math.abs(alphaOf(sparse, 400, y) - alphaOf(dense, 400, y)), `ligne ${y}`).toBeLessThanOrEqual(2);
    }
    // Le cas de 520 px peint 136 segments sur 800 × 800 : plusieurs secondes sur une machine chargée.
  }, 30_000);

  /** `softCrossingsRespectStrokeOpacityAndFlushIsIdempotent`. */
  test('les croisements respectent l’opacité, et `flush` répété ne change rien', () => {
    const stroke = trace(new BrushStroke(blank(800, 800), white(0.4)), [[400, 100], [400, 700], [700, 700], [700, 400], [100, 400]]);
    const first = materialize(preview(stroke));
    expect(first.data[(400 * 800 + 400) * 4 + 3]).toBe(102);
    expect(first.data.every((value, i) => i % 4 !== 3 || value <= 102)).toBe(true);
    stroke.flush();
    expect(stroke.takeDirty().size).toBe(0);
    const second = materialize(stroke.commit()!).data;
    // Comparés à la main : `toEqual` sur 2,5 millions d'octets prend des secondes.
    expect(second.length).toBe(first.data.length);
    expect(second.findIndex((value, i) => value !== first.data[i])).toBe(-1);
  });
});

describe('la recomposition limitée à la zone touchée', () => {
  /** Ce qui garde la mise à jour rapide ne doit rien changer au résultat. */
  test.each([0, 1])('un aperçu mis à jour à chaque échantillon finit identique à une composition d’un coup (dureté %s)', (hardness) => {
    const settings: BrushSettings = { diameter: 90, hardness, red: 0.2, green: 0.7, blue: 1, opacity: 0.8 };
    const path: [number, number][] = [[30, 30], [520, 90], [300, 280], [60, 260], [580, 20]];
    const live = new BrushStroke(blank(600, 300), settings);
    const once = new BrushStroke(blank(600, 300), settings);
    live.append({ x: path[0]![0], y: path[0]![1] });
    once.append({ x: path[0]![0], y: path[0]![1] });
    for (let i = 1; i < path.length; i++) {
      for (let k = 1; k <= 9; k++) {
        const p = { x: path[i - 1]![0] + ((path[i]![0] - path[i - 1]![0]) * k) / 9, y: path[i - 1]![1] + ((path[i]![1] - path[i - 1]![1]) * k) / 9 };
        live.append(p);
        live.takeDirty();
        once.append(p);
      }
    }
    const a = materialize(live.commit()!).data;
    const b = materialize(once.commit()!).data;
    expect(a.findIndex((value, i) => value !== b[i])).toBe(-1);
    expect(a.filter((value, i) => i % 4 === 3 && value > 0).length).toBeGreaterThan(50_000);
  });
});

describe('la copie à l’écriture', () => {
  const photo = () => {
    const buffer = createPixelBuffer(600, 300);
    for (let i = 0; i < buffer.data.length; i += 4) buffer.data.set([10, 20, 30, 255], i);
    return { ...buffer, isOpaque: true };
  };
  const onPhoto = (source: ReturnType<typeof photo> | TiledRaster) => ({ ...blank(600, 300), source });

  test('peindre ne modifie ni l’image d’origine ni le raster précédent', () => {
    const base = photo();
    const first = new BrushStroke(onPhoto(base), red);
    first.append({ x: 20, y: 20 });
    const one = first.commit()!;
    expect([...base.data.subarray(0, 4)]).toEqual([10, 20, 30, 255]);

    const second = new BrushStroke(onPhoto(one), { ...red, red: 0 });
    second.append({ x: 500, y: 250 });
    const two = second.commit()!;
    // La tuile du premier trait est partagée telle quelle, pas copiée.
    expect(two.tiles.get(0)).toBe(one.tiles.get(0));
    expect(one.tiles.size).toBe(1);
    expect(pixelOf(one, 500, 250)).toEqual([10, 20, 30, 255]);
    expect(pixelOf(two, 500, 250)).toEqual([0, 0, 0, 255]);
    expect(pixelOf(two, 20, 20)).toEqual([255, 0, 0, 255]);
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

  test('`pixelToDocument` est l’inverse exact de `toLayerPixels`', () => {
    const t = { ...identityTransform({ width: 230, height: 90 }, { x: 40, y: -12 }), rotation: 33, flipY: true };
    const m = pixelToDocument(t, 460, 120);
    for (const p of [{ x: 0, y: 0 }, { x: 460, y: 120 }, { x: 123.5, y: 7.25 }]) {
      const back = toLayerPixels(t, 460, 120, applyAffine(m, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
      const inverse = applyAffine(invertAffine(m), applyAffine(m, p));
      expect(inverse.x).toBeCloseTo(p.x, 9);
      expect(inverse.y).toBeCloseTo(p.y, 9);
    }
  });
});
