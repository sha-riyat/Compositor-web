import { describe, expect, test } from 'vitest';
import { mat3ForTransform, mat3Identity, mat3Invert, mat3Multiply } from './mat3.js';

/**
 * L'inverse sert à la passe de fusion : elle couvre toute la cible et doit
 * retrouver, pour chaque pixel, la coordonnée correspondante dans le calque.
 */
describe('inversion de matrice', () => {
  const close = (a: Float32Array, b: Float32Array): void => {
    for (let i = 0; i < 9; i++) expect(a[i]!).toBeCloseTo(b[i]!, 4);
  };

  test("l'inverse de l'identité est l'identité", () => {
    close(mat3Invert(mat3Identity()), mat3Identity());
  });

  test('une matrice multipliée par son inverse rend l’identité', () => {
    const m = mat3ForTransform({
      origin: { x: 37, y: -12 },
      size: { width: 120, height: 45 },
      radians: 0.7,
      flipX: true,
      flipY: false,
      sampling: 'linear',
    });
    close(mat3Multiply(m, mat3Invert(m)), mat3Identity());
  });

  test('une matrice singulière rend l’identité plutôt que des NaN', () => {
    const degenerate = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 1]);
    close(mat3Invert(degenerate), mat3Identity());
  });
});
