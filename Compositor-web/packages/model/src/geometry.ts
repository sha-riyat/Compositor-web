/**
 * Géométrie du document, en coordonnées « coin supérieur gauche », comme
 * `Compositor/Document/LayerTransform.swift`.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Filtre de rééchantillonnage d'un calque. `nearest` désactive tout lissage. */
export type Sampling = 'nearest' | 'linear' | 'high';

/**
 * Le placement d'un calque. Redimensionner écrit **ici**, jamais dans les
 * pixels : une image garde sa résolution pleine quelle que soit la réduction.
 */
export interface Transform {
  readonly origin: Point;
  readonly size: Size;
  /**
   * Rotation horaire, en **degrés** — comme `LayerTransform.rotation` dans
   * l'original, et comme dans le fichier. Stocker des radians faisait dériver
   * 22 % des angles au dixième de degré à chaque aller-retour : seuls le dessin
   * et la géométrie les calculent, par `transformRadians`.
   */
  readonly rotation: number;
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly sampling: Sampling;
}

/**
 * Le placement d'un calque neuf. L'échantillonnage vaut « High quality »,
 * la valeur par défaut de `LayerTransform` dans l'original : un calque importé
 * ou vide doit s'enregistrer comme le Mac l'enregistrerait.
 */
export const identityTransform = (size: Size, origin: Point = { x: 0, y: 0 }): Transform => ({
  origin,
  size,
  rotation: 0,
  flipX: false,
  flipY: false,
  sampling: 'high',
});

/**
 * Pixels entiers et degrés entiers — ce que laissent un glissement, une mise
 * à l'échelle ou une rotation dans l'original (`LayerTransform.rounded`,
 * appliqué à chaque mise à jour du glissement dans `EditorCanvas.swift`).
 * Les valeurs **tapées**, elles, restent exactes.
 */
export const roundTransform = (t: Transform): Transform => ({
  ...t,
  origin: { x: rounded(t.origin.x), y: rounded(t.origin.y) },
  size: { width: Math.max(1, rounded(t.size.width)), height: Math.max(1, rounded(t.size.height)) },
  rotation: rounded(t.rotation),
});

/**
 * Le `.rounded()` de Swift : les demis s'éloignent de zéro (-0,5 → -1), là où
 * `Math.round` les pousse vers +∞ (-0,5 → -0). Jamais de zéro négatif.
 */
export const rounded = (value: number): number => {
  const result = Math.sign(value) * Math.round(Math.abs(value));
  return result === 0 ? 0 : result;
};

/**
 * L'angle en radians, pour dessiner — `LayerTransform.radians` :
 * `rotation.truncatingRemainder(dividingBy: 360) * .pi / 180`. Le `%` de
 * JavaScript a le même signe que le dividende, comme `truncatingRemainder`.
 */
export const transformRadians = (t: Transform): number => ((t.rotation % 360) * Math.PI) / 180;

export const transformCenter = (t: Transform): Point => ({
  x: t.origin.x + t.size.width / 2,
  y: t.origin.y + t.size.height / 2,
});

export const transformBounds = (t: Transform): Rect => ({
  x: t.origin.x,
  y: t.origin.y,
  width: t.size.width,
  height: t.size.height,
});

export const rectContains = (r: Rect, p: Point): boolean =>
  p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;

/**
 * Teste un point contre un calque en tenant compte de sa rotation : le point
 * est ramené dans le repère local du calque, puis comparé à sa boîte.
 */
export const transformContains = (t: Transform, p: Point): boolean => {
  const c = transformCenter(t);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const cos = Math.cos(-transformRadians(t));
  const sin = Math.sin(-transformRadians(t));
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return (
    Math.abs(lx) <= t.size.width / 2 && Math.abs(ly) <= t.size.height / 2
  );
};

export const rectUnion = (a: Rect, b: Rect): Rect => {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/**
 * Un point du document, ramené en pixels de l'image d'un calque de
 * `width` × `height` pixels — l'inverse exact de `mat3ForTransform` : centre,
 * rotation, retournements, puis mise à l'échelle.
 */
export const toLayerPixels = (t: Transform, width: number, height: number, p: Point): Point => {
  const c = transformCenter(t);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const cos = Math.cos(-transformRadians(t));
  const sin = Math.sin(-transformRadians(t));
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return {
    x: ((t.flipX ? -lx : lx) / t.size.width + 0.5) * width,
    y: ((t.flipY ? -ly : ly) / t.size.height + 0.5) * height,
  };
};

/** Une transformation affine : `x' = a·x + c·y + tx`, `y' = b·x + d·y + ty`. */
export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

/**
 * Pixels d'un calque de `width` × `height` → document : `pixelToDocument` de
 * `BrushStroke.swift`. Le centre du calque, sa rotation, ses retournements et
 * sa mise à l'échelle.
 */
export const pixelToDocument = (t: Transform, width: number, height: number): Affine => {
  const radians = transformRadians(t);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const sx = (t.size.width / width) * (t.flipX ? -1 : 1);
  const sy = (t.size.height / height) * (t.flipY ? -1 : 1);
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  const center = transformCenter(t);
  return { a, b, c, d, tx: center.x - (a * width + c * height) / 2, ty: center.y - (b * width + d * height) / 2 };
};

export const applyAffine = (m: Affine, p: Point): Point => ({ x: m.a * p.x + m.c * p.y + m.tx, y: m.b * p.x + m.d * p.y + m.ty });

export const invertAffine = (m: Affine): Affine => {
  const det = m.a * m.d - m.b * m.c;
  const a = m.d / det;
  const b = -m.b / det;
  const c = -m.c / det;
  const d = m.a / det;
  return { a, b, c, d, tx: -(a * m.tx + c * m.ty), ty: -(b * m.tx + d * m.ty) };
};
