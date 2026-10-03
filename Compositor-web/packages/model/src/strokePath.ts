import { applyAffine, invertAffine, pixelToDocument, type Affine, type Point, type Size, type Transform } from './geometry.js';
import { tileGrid, tileKey, tileRect, TILE_SIZE, type PixelSource, type TileGrid, type TileRect } from './raster.js';
import { curvePiece, type Segment } from './brushTip.js';

/**
 * Le chemin d'un trait, commun aux deux moteurs — le processeur et le GPU.
 * Repris de `BrushStroke.append` et `flush` dans l'original.
 *
 * Il reçoit les échantillons du pointeur et rend, à chaque fois, ce qui est
 * **acquis** (un morceau de courbe lisse à travers les échantillons) et la
 * **fin provisoire** (un segment droit jusqu'au dernier échantillon, que le
 * prochain remplacera). Il dit aussi quelles tuiles du calque chaque
 * mise à jour touche, et sur quelle zone.
 */

export interface StrokeTarget {
  readonly width: number;
  readonly height: number;
  /** Les pixels actuels du calque ; `null` pour un calque vide. */
  readonly source: PixelSource | null;
  /** Le placement du calque : la pointe est ronde dans le document, pas dans ses pixels. */
  readonly transform: Transform;
  /** La peinture s'arrête aux bords du canevas, comme dans l'original. */
  readonly canvas: Size;
}

/** Un rectangle de pixels, bornes de fin exclues. */
export interface PixelRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface PathUpdate {
  readonly settled: readonly Segment[];
  readonly tail: readonly Segment[];
}

export class StrokePath {
  readonly width: number;
  readonly height: number;
  readonly toDocument: Affine;
  readonly grid: TileGrid;
  readonly #toPixels: Affine;
  readonly #canvas: Size;
  /** Jusqu'où une pointe atteint autour de son axe, en pixels du document. */
  readonly #reach: number;
  #samples: Point[] = [];
  #tail: Segment[] = [];
  #tailRects: (PixelRect | null)[] = [];

  constructor(target: StrokeTarget, radius: number) {
    this.width = target.width;
    this.height = target.height;
    this.toDocument = pixelToDocument(target.transform, target.width, target.height);
    this.#toPixels = invertAffine(this.toDocument);
    this.#canvas = target.canvas;
    this.grid = tileGrid(target.width, target.height);
    this.#reach = radius + 2;
  }

  /** Taille, dans le document, d'un pixel du calque : la largeur de l'antialiasing. */
  get pixelSize(): number {
    const m = this.toDocument;
    return Math.min(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
  }

  get canvas(): Size {
    return this.#canvas;
  }

  /** La fin provisoire en cours : zéro ou un segment. */
  get tail(): readonly Segment[] {
    return this.#tail;
  }

  get tailRects(): readonly (PixelRect | null)[] {
    return this.#tailRects;
  }

  /** Un échantillon, en pixels du document ; `null` s'il est rejeté (invalide ou répété). */
  append(point: Point): PathUpdate | null {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    if (Math.abs(point.x) > 10_000_000 || Math.abs(point.y) > 10_000_000) return null;
    const last = this.#samples.at(-1);
    if (last !== undefined && last.x === point.x && last.y === point.y) return null;
    this.#samples.push(point);
    if (this.#samples.length > 4) this.#samples.shift();
    const s = this.#samples;
    const n = s.length;
    const settled: Segment[] =
      n === 1 ? [[point.x, point.y, point.x, point.y]] : n >= 3 ? curvePiece(s[n - 3]!, s[n - 2]!, s[Math.max(0, n - 4)]!, point) : [];
    const tail: Segment[] = n >= 2 ? [[s[n - 2]!.x, s[n - 2]!.y, point.x, point.y]] : [];
    return { settled, tail };
  }

  /** Le dernier morceau de courbe, qui remplace la fin provisoire ; `null` s'il n'y en a pas. */
  flush(): PathUpdate | null {
    const s = this.#samples;
    const n = s.length;
    if (n < 2) return null;
    this.#samples = [s[n - 1]!];
    return { settled: curvePiece(s[n - 2]!, s[n - 1]!, s[Math.max(0, n - 3)]!, s[n - 1]!), tail: [] };
  }

  /**
   * Les zones à recomposer, par tuile, en pixels de la tuile : l'acquis, la
   * nouvelle fin, et l'ancienne fin qu'elle remplace. Retient la nouvelle fin.
   */
  zones(update: PathUpdate): Map<number, PixelRect> {
    const tailRects = update.tail.map((segment) => this.reach(segment));
    const zones = new Map<number, PixelRect>();
    for (const rect of [...update.settled.map((segment) => this.reach(segment)), ...tailRects, ...this.#tailRects]) {
      if (rect === null) continue;
      for (const { key, rect: tile } of this.tilesOf(rect)) {
        const local = {
          x0: Math.max(0, rect.x0 - tile.x),
          y0: Math.max(0, rect.y0 - tile.y),
          x1: Math.min(tile.width, rect.x1 - tile.x),
          y1: Math.min(tile.height, rect.y1 - tile.y),
        };
        zones.set(key, union(zones.get(key), local));
      }
    }
    this.#tail = [...update.tail];
    this.#tailRects = tailRects;
    return zones;
  }

  /** Les pixels du calque qu'un segment peut atteindre, bornés au canevas et au calque. */
  reach(s: Segment): PixelRect | null {
    const reach = this.#reach;
    const left = Math.max(0, Math.min(s[0], s[2]) - reach);
    const top = Math.max(0, Math.min(s[1], s[3]) - reach);
    const right = Math.min(this.#canvas.width, Math.max(s[0], s[2]) + reach);
    const bottom = Math.min(this.#canvas.height, Math.max(s[1], s[3]) + reach);
    if (left >= right || top >= bottom) return null;
    const corners = [
      applyAffine(this.#toPixels, { x: left, y: top }),
      applyAffine(this.#toPixels, { x: right, y: top }),
      applyAffine(this.#toPixels, { x: left, y: bottom }),
      applyAffine(this.#toPixels, { x: right, y: bottom }),
    ];
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))));
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))));
    const x1 = Math.min(this.width, Math.ceil(Math.max(...corners.map((p) => p.x))));
    const y1 = Math.min(this.height, Math.ceil(Math.max(...corners.map((p) => p.y))));
    return x0 < x1 && y0 < y1 ? { x0, y0, x1, y1 } : null;
  }

  /** Les tuiles qu'un rectangle de pixels recouvre. */
  tilesOf(r: PixelRect): { key: number; rect: TileRect }[] {
    const tiles: { key: number; rect: TileRect }[] = [];
    for (let row = Math.floor(r.y0 / TILE_SIZE); row <= Math.floor((r.y1 - 1) / TILE_SIZE); row++) {
      for (let column = Math.floor(r.x0 / TILE_SIZE); column <= Math.floor((r.x1 - 1) / TILE_SIZE); column++) {
        const key = tileKey(this.grid, column, row);
        tiles.push({ key, rect: tileRect(this.width, this.height, key) });
      }
    }
    return tiles;
  }
}

export const union = (a: PixelRect | undefined, b: PixelRect): PixelRect =>
  a === undefined
    ? b
    : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
