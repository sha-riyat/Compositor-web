import type { Transform } from '@compositor/model';

/** Matrice 3×3 en colonne majeure, telle que l'attend `uniformMatrix3fv`. */
export type Mat3 = Float32Array;

export const mat3Identity = (): Mat3 =>
  new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

export const mat3Multiply = (a: Mat3, b: Mat3): Mat3 => {
  const out = new Float32Array(9);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      out[col * 3 + row] =
        a[0 * 3 + row]! * b[col * 3 + 0]! +
        a[1 * 3 + row]! * b[col * 3 + 1]! +
        a[2 * 3 + row]! * b[col * 3 + 2]!;
    }
  }
  return out;
};

export const mat3Translate = (x: number, y: number): Mat3 =>
  new Float32Array([1, 0, 0, 0, 1, 0, x, y, 1]);

export const mat3Scale = (x: number, y: number): Mat3 =>
  new Float32Array([x, 0, 0, 0, y, 0, 0, 0, 1]);

/** Rotation horaire, dans un repère dont l'axe y descend. */
export const mat3Rotate = (radians: number): Mat3 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return new Float32Array([c, s, 0, -s, c, 0, 0, 0, 1]);
};

/**
 * Pixels document → espace de découpage. L'axe y du document descend, celui du
 * découpage monte : d'où le signe négatif sur la composante verticale.
 */
export const mat3Projection = (width: number, height: number): Mat3 =>
  new Float32Array([2 / width, 0, 0, 0, -2 / height, 0, -1, 1, 1]);

/**
 * Carré unité (0..1) → position d'un calque dans le document, en appliquant
 * taille, retournements et rotation autour du centre.
 */
export const mat3ForTransform = (transform: Transform): Mat3 => {
  const { size, origin } = transform;
  const centerX = origin.x + size.width / 2;
  const centerY = origin.y + size.height / 2;

  let m = mat3Translate(centerX, centerY);
  m = mat3Multiply(m, mat3Rotate(transform.radians));
  m = mat3Multiply(
    m,
    mat3Scale(
      transform.flipX ? -size.width : size.width,
      transform.flipY ? -size.height : size.height,
    ),
  );
  // Le carré unité est ramené autour de son centre avant d'être mis à l'échelle.
  m = mat3Multiply(m, mat3Translate(-0.5, -0.5));
  return m;
};

/** Document → vue, selon le zoom et le décalage du viewport. */
export const mat3View = (scale: number, offsetX: number, offsetY: number): Mat3 =>
  mat3Multiply(mat3Translate(offsetX, offsetY), mat3Scale(scale, scale));

/**
 * Inverse d'une matrice 3×3. Rend l'identité si la matrice est singulière —
 * un calque de taille nulle ne doit pas faire disparaître le rendu.
 */
export const mat3Invert = (m: Mat3): Mat3 => {
  const [a, b, c, d, e, f, g, h, i] = m as unknown as number[] as [
    number, number, number, number, number, number, number, number, number,
  ];
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return mat3Identity();
  const inv = 1 / det;
  return new Float32Array([
    A * inv, (c * h - b * i) * inv, (b * f - c * e) * inv,
    B * inv, (a * i - c * g) * inv, (c * d - a * f) * inv,
    C * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
  ]);
};
