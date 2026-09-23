import { describe, expect, test } from 'vitest';
import { cycleBlendMode, opacityFromDigit, OPACITY_DIGIT_WINDOW_MS } from './shortcuts.js';

/**
 * Traduction de `LayerAppearanceTests.moveToolNumberKeysSetSelectedLayersOpacityAsOneUndo`
 * et de `BlendShortcutTests`, pour la partie qui ne dépend pas d'AppKit.
 */

describe('opacité au clavier', () => {
  test('un chiffre seul vaut dix fois sa valeur', () => {
    expect(opacityFromDigit(5, 0, null).percent).toBe(50);
    expect(opacityFromDigit(1, 0, null).percent).toBe(10);
  });

  test('zéro vaut 100 %', () => {
    expect(opacityFromDigit(0, 0, null).percent).toBe(100);
  });

  test('un second chiffre rapide affine le premier', () => {
    const first = opacityFromDigit(5, 1000, null);
    const second = opacityFromDigit(5, 1300, first.pending);
    expect(second.percent).toBe(55);
    expect(second.pending).toBeNull();
  });

  test('zéro puis cinq donne 5 %', () => {
    const first = opacityFromDigit(0, 0, null);
    expect(opacityFromDigit(5, 100, first.pending).percent).toBe(5);
  });

  test('zéro puis zéro donne 1 %, jamais un calque invisible', () => {
    const first = opacityFromDigit(0, 0, null);
    expect(opacityFromDigit(0, 100, first.pending).percent).toBe(1);
  });

  test('au-delà de la fenêtre, le second chiffre repart de zéro', () => {
    const first = opacityFromDigit(5, 0, null);
    const late = opacityFromDigit(3, OPACITY_DIGIT_WINDOW_MS, first.pending);
    expect(late.percent).toBe(30);
    expect(late.pending).toEqual({ digit: 3, time: OPACITY_DIGIT_WINDOW_MS });
  });

  test('un troisième chiffre rapide ne se combine pas avec les deux premiers', () => {
    const a = opacityFromDigit(5, 0, null);
    const b = opacityFromDigit(5, 100, a.pending);
    const c = opacityFromDigit(7, 200, b.pending);
    expect(c.percent).toBe(70);
  });

  test('une valeur hors chiffre est ignorée', () => {
    expect(opacityFromDigit(12, 0, null).percent).toBe(-1);
    expect(opacityFromDigit(-1, 0, null).percent).toBe(-1);
  });
});

describe('cycle du mode de fusion', () => {
  test('avance d’un cran', () => {
    expect(cycleBlendMode('normal', true)).toBe('multiply');
  });

  test('recule d’un cran', () => {
    expect(cycleBlendMode('multiply', false)).toBe('normal');
  });

  test('boucle au dernier mode', () => {
    expect(cycleBlendMode('luminosity', true)).toBe('normal');
  });

  test('boucle au premier mode en reculant', () => {
    expect(cycleBlendMode('normal', false)).toBe('luminosity');
  });

  test('quatorze pas en avant ramènent au point de départ', () => {
    let mode = cycleBlendMode('overlay', true);
    for (let i = 1; i < 14; i++) mode = cycleBlendMode(mode, true);
    expect(mode).toBe('overlay');
  });
});
