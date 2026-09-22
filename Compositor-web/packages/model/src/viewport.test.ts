import { describe, expect, test } from 'vitest';
import { fitViewport, MIN_SCALE } from './viewport.js';

describe('cadrage du document', () => {
  test('un grand document est réduit à 90 % de la vue, centré', () => {
    const v = fitViewport(2000, 1000, 1000, 1000)!;
    expect(v.scale).toBeCloseTo(0.45);
    expect(v.offsetX).toBeCloseTo((1000 - 2000 * 0.45) / 2);
    expect(v.offsetY).toBeCloseTo((1000 - 1000 * 0.45) / 2);
  });

  test('un petit document n’est jamais agrandi au-delà de 100 %', () => {
    expect(fitViewport(64, 32, 1000, 800)!.scale).toBe(1);
  });

  /**
   * Non-régression : un import avant la mise en page cadrait sur un rectangle
   * de 0 × 0 et fixait l'échelle à zéro. Le document devenait invisible.
   */
  test('une vue sans taille ne produit aucun cadrage, plutôt qu’une échelle nulle', () => {
    expect(fitViewport(1600, 900, 0, 0)).toBeNull();
    expect(fitViewport(1600, 900, 992, 0)).toBeNull();
    expect(fitViewport(1600, 900, 0, 620)).toBeNull();
  });

  test('un document sans taille ne produit aucun cadrage', () => {
    expect(fitViewport(0, 0, 992, 620)).toBeNull();
  });

  test('un document gigantesque reste au-dessus de l’échelle minimale', () => {
    expect(fitViewport(1_000_000, 1_000_000, 100, 100)!.scale).toBe(MIN_SCALE);
  });

  test('des valeurs non numériques ne passent pas', () => {
    expect(fitViewport(Number.NaN, 900, 992, 620)).toBeNull();
  });
});
