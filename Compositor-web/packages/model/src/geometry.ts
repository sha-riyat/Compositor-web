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
  /** Rotation horaire, en radians. */
  readonly radians: number;
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly sampling: Sampling;
}

export const identityTransform = (size: Size, origin: Point = { x: 0, y: 0 }): Transform => ({
  origin,
  size,
  radians: 0,
  flipX: false,
  flipY: false,
  sampling: 'linear',
});

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
  const cos = Math.cos(-t.radians);
  const sin = Math.sin(-t.radians);
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
