import type { Point } from './geometry.js';
import {
  readTile,
  replaceTiles,
  tileGrid,
  tileKey,
  tileRect,
  TILE_SIZE,
  type PixelSource,
  type TileGrid,
  type TiledRaster,
} from './raster.js';

/**
 * Un trait de brosse, repris de `BrushStroke.swift` : la pointe ronde est
 * **balayée** le long du chemin, segment par segment, au lieu d'être posée en
 * tampons espacés — pas d'ondulation, quel que soit le nombre d'événements.
 *
 * La couverture du trait vit à part, tuile par tuile, et ne touche jamais la
 * source : chaque mise à jour recompose les tuiles touchées à partir de la
 * source et de la couverture, et le relâchement en fait un raster neuf.
 *
 * En T4, tranche 1 : la pointe **dure** seulement, bord antialiasé d'un pixel.
 * La pointe douce et la densité accumulée viennent avec SHA-90.
 */

export interface BrushSettings {
  /** En pixels du document, 1–2000. */
  readonly diameter: number;
  /** 0–1 ; seule la pointe dure (1) est peinte en tranche 1. */
  readonly hardness: number;
  /** Couleur de premier plan, 0–1, non prémultipliée. */
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  /** Plafonne le trait entier, 0,01–1. */
  readonly opacity: number;
}

/** Les valeurs par défaut de `BrushSettings` dans l'original : 40 px, dure, noire, opaque. */
export const DEFAULT_BRUSH: BrushSettings = { diameter: 40, hardness: 1, red: 0, green: 0, blue: 0, opacity: 1 };

export interface StrokeTarget {
  readonly width: number;
  readonly height: number;
  /** Les pixels actuels du calque ; `null` pour un calque vide. */
  readonly source: PixelSource | null;
}

export class BrushStroke {
  readonly width: number;
  readonly height: number;
  readonly #source: PixelSource | null;
  readonly #grid: TileGrid;
  /** Rayon en pixels du raster. */
  readonly #radius: number;
  readonly #settings: BrushSettings;
  readonly #coverage = new Map<number, Float32Array>();
  readonly #sourceTiles = new Map<number, Uint8ClampedArray<ArrayBuffer>>();
  readonly #dirty = new Set<number>();
  /** La dernière composition de chaque tuile : l'aperçu et le relâchement partagent les mêmes octets. */
  readonly #composed = new Map<number, Uint8ClampedArray<ArrayBuffer>>();
  #last: Point | null = null;

  /** `radius` est en pixels du raster : le diamètre du document, mis à l'échelle du calque. */
  constructor(target: StrokeTarget, settings: BrushSettings, radius: number) {
    this.width = target.width;
    this.height = target.height;
    this.#source = target.source;
    this.#grid = tileGrid(target.width, target.height);
    this.#settings = settings;
    this.#radius = Math.max(0.5, radius);
  }

  /** Les tuiles que le trait a touchées : seules elles ont été allouées. */
  get patchCount(): number {
    return this.#coverage.size;
  }

  get isEmpty(): boolean {
    return this.#coverage.size === 0;
  }

  /** Ajoute un point du chemin, en pixels du raster. Le premier pose un rond. */
  append(point: Point): void {
    this.#sweep(this.#last ?? point, point);
    this.#last = point;
  }

  /** Les tuiles recomposées depuis le dernier appel, pour l'aperçu. */
  takeDirty(): Map<number, Uint8ClampedArray<ArrayBuffer>> {
    const tiles = new Map<number, Uint8ClampedArray<ArrayBuffer>>();
    for (const key of this.#dirty) {
      const tile = this.#compose(key);
      this.#composed.set(key, tile);
      tiles.set(key, tile);
    }
    this.#dirty.clear();
    return tiles;
  }

  /** Le raster neuf, ou `null` si le trait n'a rien peint — un trait hors du calque. */
  commit(): TiledRaster | null {
    if (this.isEmpty) return null;
    this.takeDirty();
    return replaceTiles(this.#source, this.width, this.height, this.#composed);
  }

  /** La capsule de `a` à `b` : chaque pixel prend la couverture la plus forte. */
  #sweep(a: Point, b: Point): void {
    const r = this.#radius;
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - r - 1));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - r - 1));
    const maxX = Math.min(this.width, Math.ceil(Math.max(a.x, b.x) + r + 1));
    const maxY = Math.min(this.height, Math.ceil(Math.max(a.y, b.y) + r + 1));
    if (minX >= maxX || minY >= maxY) return;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    for (let row = Math.floor(minY / TILE_SIZE); row <= Math.floor((maxY - 1) / TILE_SIZE); row++) {
      for (let column = Math.floor(minX / TILE_SIZE); column <= Math.floor((maxX - 1) / TILE_SIZE); column++) {
        const key = tileKey(this.#grid, column, row);
        const rect = tileRect(this.width, this.height, key);
        const x0 = Math.max(minX, rect.x);
        const x1 = Math.min(maxX, rect.x + rect.width);
        const y0 = Math.max(minY, rect.y);
        const y1 = Math.min(maxY, rect.y + rect.height);
        let coverage = this.#coverage.get(key);
        let changed = false;
        for (let y = y0; y < y1; y++) {
          const py = y + 0.5 - a.y;
          for (let x = x0; x < x1; x++) {
            const px = x + 0.5 - a.x;
            // Distance au segment, au centre du pixel.
            const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, (px * dx + py * dy) / lengthSquared));
            const ex = px - t * dx;
            const ey = py - t * dy;
            const value = Math.min(1, r + 0.5 - Math.sqrt(ex * ex + ey * ey));
            if (value <= 0) continue;
            coverage ??= this.#allocate(key, rect.width * rect.height);
            const index = (y - rect.y) * rect.width + (x - rect.x);
            if (value > coverage[index]!) {
              coverage[index] = value;
              changed = true;
            }
          }
        }
        if (changed) this.#dirty.add(key);
      }
    }
  }

  #allocate(key: number, length: number): Float32Array {
    const coverage = new Float32Array(length);
    this.#coverage.set(key, coverage);
    return coverage;
  }

  /** La source sous la couleur, en « source-over » prémultiplié. */
  #compose(key: number): Uint8ClampedArray<ArrayBuffer> {
    let source = this.#sourceTiles.get(key);
    if (source === undefined) {
      source = readTile(this.#source, this.width, this.height, key);
      this.#sourceTiles.set(key, source);
    }
    const coverage = this.#coverage.get(key)!;
    const out = new Uint8ClampedArray(source.length);
    const { red, green, blue, opacity } = this.#settings;
    for (let i = 0; i < coverage.length; i++) {
      const a = coverage[i]! * opacity;
      const keep = 1 - a;
      const o = i * 4;
      out[o] = Math.round(red * 255 * a + source[o]! * keep);
      out[o + 1] = Math.round(green * 255 * a + source[o + 1]! * keep);
      out[o + 2] = Math.round(blue * 255 * a + source[o + 2]! * keep);
      out[o + 3] = Math.round(255 * a + source[o + 3]! * keep);
    }
    return out;
  }
}
