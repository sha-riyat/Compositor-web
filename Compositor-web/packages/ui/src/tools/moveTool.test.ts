import { describe, expect, test } from 'vitest';
import {
  addLayer,
  createDocument,
  createLayer,
  identityTransform,
  roundTransform,
  rounded,
  type CompositorDocument,
  type Point,
  type ToolApi,
} from '@compositor/model';
import { createMoveTool, handleAt, handleCursor, handlePosition, resizeTransform } from './moveTool.js';

/**
 * Traduction de la partie « non destructif » de
 * `CompositorTests/TransformTests.swift` : un redimensionnement
 * écrit dans le placement, jamais dans les pixels.
 */

const base = identityTransform({ width: 100, height: 50 }, { x: 10, y: 20 });

describe('poignées', () => {
  test('les huit poignées tombent sur les bords et les milieux', () => {
    expect(handlePosition(base, 'nw')).toEqual({ x: 10, y: 20 });
    expect(handlePosition(base, 'se')).toEqual({ x: 110, y: 70 });
    expect(handlePosition(base, 'n')).toEqual({ x: 60, y: 20 });
    expect(handlePosition(base, 'e')).toEqual({ x: 110, y: 45 });
  });

  test('la préhension respecte la tolérance', () => {
    expect(handleAt(base, { x: 12, y: 22 }, 4)).toBe('nw');
    expect(handleAt(base, { x: 20, y: 30 }, 4)).toBeNull();
  });

  test('chaque poignée porte le curseur de son axe', () => {
    expect(handleCursor('nw')).toBe('nwse-resize');
    expect(handleCursor('ne')).toBe('nesw-resize');
    expect(handleCursor('n')).toBe('ns-resize');
    expect(handleCursor('w')).toBe('ew-resize');
  });
});

describe('redimensionnement', () => {
  test('la poignée sud-est étend sans déplacer l’origine', () => {
    const out = resizeTransform(base, 'se', { x: 20, y: 10 }, false);
    expect(out.origin).toEqual({ x: 10, y: 20 });
    expect(out.size).toEqual({ width: 120, height: 60 });
  });

  test('la poignée nord-ouest déplace l’origine et réduit la taille', () => {
    const out = resizeTransform(base, 'nw', { x: 10, y: 5 }, false);
    expect(out.origin).toEqual({ x: 20, y: 25 });
    expect(out.size).toEqual({ width: 90, height: 45 });
  });

  test('un côté seul ne touche pas l’autre dimension', () => {
    const out = resizeTransform(base, 'e', { x: 30, y: 999 }, false);
    expect(out.size.height).toBe(50);
    expect(out.size.width).toBe(130);
  });

  test('le verrouillage conserve les proportions sur un coin', () => {
    const out = resizeTransform(base, 'se', { x: 100, y: 0 }, true);
    expect(out.size.width / out.size.height).toBeCloseTo(100 / 50);
  });

  test('le verrouillage sur un côté déduit l’autre dimension', () => {
    const out = resizeTransform(base, 'e', { x: 100, y: 0 }, true);
    expect(out.size.width).toBe(200);
    expect(out.size.height).toBeCloseTo(100);
  });

  test('un glissement excessif ne produit ni taille nulle ni négative', () => {
    const out = resizeTransform(base, 'se', { x: -999, y: -999 }, false);
    expect(out.size.width).toBeGreaterThan(0);
    expect(out.size.height).toBeGreaterThan(0);
  });

  test('le redimensionnement est non destructif : rien d’autre que le placement ne bouge', () => {
    const out = resizeTransform(base, 'se', { x: 20, y: 10 }, false);
    expect(out.radians).toBe(base.radians);
    expect(out.flipX).toBe(base.flipX);
    expect(out.flipY).toBe(base.flipY);
    expect(out.sampling).toBe(base.sampling);
    // L'entrée n'est pas mutée : les instantanés d'historique restent valides.
    expect(base.size).toEqual({ width: 100, height: 50 });
  });
});

/**
 * `EditorCanvas.swift` : « Dragging, scaling and rotating land on whole pixels
 * and whole degrees; typed values stay exact. » À 56 % de zoom, un pixel
 * d'écran vaut 1,78 pixel du document : sans arrondi, un glissement laisse
 * des positions comme 103,39583333333331.
 */
describe('pixels entiers', () => {
  test('roundTransform arrondit position, taille et angle, sans taille nulle', () => {
    const out = roundTransform({
      ...identityTransform({ width: 0.3, height: 99.6 }, { x: 103.39583333333331, y: -0.5 }),
      radians: (29.6 * Math.PI) / 180,
    });
    // Comme `.rounded()` en Swift : -0,5 s'éloigne de zéro.
    expect(out.origin).toEqual({ x: 103, y: -1 });
    expect(out.size).toEqual({ width: 1, height: 100 });
    expect((out.radians * 180) / Math.PI).toBeCloseTo(30, 10);
  });

  test('les demis s’arrondissent loin de zéro, comme en Swift', () => {
    expect([rounded(2.5), rounded(-2.5), rounded(0.5), rounded(-0.5), rounded(-0.4)]).toEqual([3, -3, 1, -1, 0]);
    expect(Object.is(rounded(-0.4), -0)).toBe(false);
  });

  /** Un outil piloté comme le fait le canevas. */
  const drive = (start: Point, moves: readonly Point[], at: Point = { x: 10, y: 20 }) => {
    let document: CompositorDocument = addLayer(
      createDocument('d', 400, 300),
      createLayer('l', 'Calque', identityTransform({ width: 100, height: 50 }, at)),
    );
    const api: ToolApi = {
      get document() {
        return document;
      },
      activeLayerId: 'l',
      beginHistory: () => undefined,
      mutate: (fn) => {
        document = fn(document);
      },
      endHistory: () => undefined,
      selectLayer: () => undefined,
      requestRedraw: () => undefined,
      toDocument: (p) => p,
    };
    const tool = createMoveTool({
      handleTolerance: () => 4,
      autoSelect: () => false,
      transformBoxVisible: () => true,
      lockRatioByDefault: () => false,
    });
    const event = (point: Point) => ({ point, shiftKey: false, altKey: false, primaryKey: false, button: 0, pressure: 1 });
    tool.onPointerDown(event(start), api);
    for (const point of moves) tool.onPointerMove(event(point), api);
    tool.onPointerUp(event(moves.at(-1) ?? start), api);
    return document.layers[0]!.transform;
  };

  test('déplacer par fractions de pixel pose le calque sur des pixels entiers', () => {
    const out = drive({ x: 50, y: 40 }, [{ x: 51.78, y: 40.9 }, { x: 143.39, y: 41.2 }]);
    expect(out.origin).toEqual({ x: 103, y: 21 });
  });

  test('redimensionner par fractions de pixel donne une taille entière', () => {
    // Poignée sud-est, à (110, 70).
    const out = drive({ x: 110, y: 70 }, [{ x: 123.7, y: 81.4 }]);
    expect(out.size).toEqual({ width: 114, height: 61 });
    expect(out.origin).toEqual({ x: 10, y: 20 });
  });
});
