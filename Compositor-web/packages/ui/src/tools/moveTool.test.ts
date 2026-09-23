import { describe, expect, test } from 'vitest';
import { identityTransform } from '@compositor/model';
import { handleAt, handleCursor, handlePosition, resizeTransform } from './moveTool.js';

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
