import type { Affine, Point, Size } from './geometry.js';
import { readTile, replaceTiles, tileRect, type PixelSource, type TiledRaster } from './raster.js';
import { StrokePath, union, type PathUpdate, type PixelRect, type StrokeTarget } from './strokePath.js';
import {
  createTip,
  DENSITY_CAP,
  prepareSegment,
  type PreparedSegment,
  type Segment,
  type Tip,
} from './brushTip.js';

/**
 * Un trait de brosse, repris de `BrushStroke.swift` et de son noyau Metal.
 *
 * Le chemin passe par une courbe lisse à travers les échantillons. Le dernier
 * morceau, qui attend l'échantillon suivant pour être courbé, est d'abord
 * tracé **droit et provisoire** — le trait ne traîne jamais derrière le
 * pointeur — puis remplacé exactement. La peinture permanente et cette fin
 * provisoire ne se mélangent jamais.
 *
 * La couverture vit à part, tuile par tuile, et ne touche jamais la source :
 * chaque mise à jour recompose les tuiles touchées — source, puis couleur à
 * travers la couverture, à l'opacité du trait —, et le relâchement en fait un
 * raster neuf. L'opacité plafonne donc le trait entier.
 */

export interface BrushSettings {
  /** En pixels du document, 1–2000. */
  readonly diameter: number;
  /** 0–1 : 1 est une pointe nette, 0 une gaussienne sur tout le rayon. */
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

export type { StrokeTarget } from './strokePath.js';

export class BrushStroke {
  readonly width: number;
  readonly height: number;
  readonly #source: PixelSource | null;
  readonly #path: StrokePath;
  readonly #settings: BrushSettings;
  readonly #tip: Tip;
  readonly #soft: boolean;
  readonly #toDocument: Affine;
  readonly #canvas: Size;
  /** Densité (pointe douce) ou couverture (pointe dure) déjà peinte, par tuile. */
  readonly #permanent = new Map<number, Float32Array>();
  readonly #sourceTiles = new Map<number, Uint8ClampedArray<ArrayBuffer>>();
  /** La dernière composition de chaque tuile : l'aperçu et le relâchement partagent les mêmes octets. */
  readonly #composed = new Map<number, Uint8ClampedArray<ArrayBuffer>>();
  /** La zone de chaque tuile à recomposer, en pixels de la tuile. */
  readonly #dirty = new Map<number, PixelRect>();
  /** Par niveau de couverture : la couleur déposée et la part de source gardée. */
  readonly #blend: { readonly add: Float64Array; readonly keep: Float64Array };
  #tail: PreparedSegment[] = [];

  constructor(target: StrokeTarget, settings: BrushSettings) {
    this.width = target.width;
    this.height = target.height;
    this.#source = target.source;
    this.#settings = settings;
    this.#path = new StrokePath(target, settings.diameter / 2);
    this.#toDocument = this.#path.toDocument;
    this.#canvas = target.canvas;
    this.#tip = createTip(settings.diameter, settings.hardness, this.#path.pixelSize);
    this.#soft = settings.hardness < 1;
    const add = new Float64Array(256 * 4);
    const keep = new Float64Array(256);
    for (let level = 0; level < 256; level++) {
      const alpha = (level / 255) * settings.opacity;
      add.set([settings.red * 255 * alpha, settings.green * 255 * alpha, settings.blue * 255 * alpha, 255 * alpha], level * 4);
      keep[level] = 1 - alpha;
    }
    this.#blend = { add, keep };
  }

  /** Les tuiles que le trait a touchées : seules elles ont été allouées. */
  get patchCount(): number {
    return this.#permanent.size;
  }

  get isEmpty(): boolean {
    return this.#permanent.size === 0;
  }

  /** Ajoute un échantillon du pointeur, en pixels du **document**. */
  append(point: Point): void {
    const update = this.#path.append(point);
    if (update !== null) this.#render(update);
  }

  /** Remplace la fin provisoire par le dernier morceau de courbe. Sans effet si on le répète. */
  flush(): void {
    const update = this.#path.flush();
    if (update !== null) this.#render(update);
  }

  /** Les tuiles recomposées depuis le dernier appel, pour l'aperçu. */
  takeDirty(): Map<number, Uint8ClampedArray<ArrayBuffer>> {
    const tiles = new Map<number, Uint8ClampedArray<ArrayBuffer>>();
    for (const [key, zone] of this.#dirty) tiles.set(key, this.#compose(key, zone));
    this.#dirty.clear();
    return tiles;
  }

  /** Le raster neuf, ou `null` si le trait n'a rien peint. Appelle `flush` d'abord. */
  commit(): TiledRaster | null {
    this.flush();
    if (this.isEmpty) return null;
    this.takeDirty();
    return replaceTiles(this.#source, this.width, this.height, this.#composed);
  }

  #render(update: PathUpdate): void {
    for (const [key, zone] of this.#path.zones(update)) {
      if (!this.#permanent.has(key)) {
        const rect = tileRect(this.width, this.height, key);
        this.#permanent.set(key, new Float32Array(rect.width * rect.height));
      }
      this.#dirty.set(key, union(this.#dirty.get(key), zone));
    }
    for (const segment of update.settled) this.#deposit(segment);
    this.#tail = this.#path.tail.map(prepareSegment);
  }

  /**
   * Dépose un segment dans la peinture permanente. La boucle est écrite à plat :
   * le point du document avance d'un pas constant le long d'une ligne de
   * pixels, et rien n'est alloué par pixel — c'est elle qui tient la latence.
   */
  #deposit(segment: Segment): void {
    const r = this.#path.reach(segment);
    if (r === null) return;
    const s = prepareSegment(segment);
    const { a, b, c, d, tx, ty } = this.#toDocument;
    const cw = this.#canvas.width;
    const ch = this.#canvas.height;
    const tip = this.#tip;
    const { radius, antialias, spacing } = tip;
    const length = s.length;
    const soft = this.#soft;
    for (const { key, rect } of this.#path.tilesOf(r)) {
      const permanent = this.#permanent.get(key)!;
      const xs = Math.max(r.x0, rect.x);
      const xe = Math.min(r.x1, rect.x + rect.width);
      const ye = Math.min(r.y1, rect.y + rect.height);
      for (let y = Math.max(r.y0, rect.y); y < ye; y++) {
        let px = a * (xs + 0.5) + c * (y + 0.5) + tx;
        let py = b * (xs + 0.5) + d * (y + 0.5) + ty;
        let i = (y - rect.y) * rect.width + (xs - rect.x);
        for (let x = xs; x < xe; x++, i++, px += a, py += b) {
          if (px < 0 || py < 0 || px >= cw || py >= ch) continue;
          const ox = px - s.ax;
          const oy = py - s.ay;
          if (soft) {
            let density: number;
            if (length === 0) density = tip.density(ox * ox + oy * oy);
            else {
              const projection = ox * s.ux + oy * s.uy;
              const cross = ox * s.uy - oy * s.ux;
              const h = cross < 0 ? -cross : cross;
              if (h >= radius) continue;
              density = tip.sweep(h, -projection, length - projection);
            }
            const value = permanent[i]! + density;
            permanent[i] = value > DENSITY_CAP ? DENSITY_CAP : value;
          } else {
            const t = length === 0 ? 0 : Math.min(length, Math.max(0, ox * s.ux + oy * s.uy));
            const ex = ox - t * s.ux;
            const ey = oy - t * s.uy;
            const value = (radius - Math.sqrt(ex * ex + ey * ey)) / antialias + 0.5;
            if (value > permanent[i]!) permanent[i] = value > 1 ? 1 : value;
          }
        }
      }
    }
  }

  /**
   * La source, puis la couleur à travers la couverture — quantifiée sur 8 bits,
   * comme l'original —, sur la seule zone touchée de la tuile.
   */
  #compose(key: number, zone: PixelRect): Uint8ClampedArray<ArrayBuffer> {
    let source = this.#sourceTiles.get(key);
    if (source === undefined) {
      source = readTile(this.#source, this.width, this.height, key);
      this.#sourceTiles.set(key, source);
    }
    let out = this.#composed.get(key);
    if (out === undefined) {
      // Sans couverture, la tuile composée est la source : on part d'une copie.
      out = new Uint8ClampedArray(source);
      this.#composed.set(key, out);
    }
    const rect = tileRect(this.width, this.height, key);
    const permanent = this.#permanent.get(key)!;
    const tip = this.#tip;
    const { radius, antialias, spacing } = tip;
    const soft = this.#soft;
    const tail = this.#tail[0];
    const tailRect = this.#path.tailRects[0] ?? null;
    const { a, b, c, d, tx, ty } = this.#toDocument;
    const cw = this.#canvas.width;
    const ch = this.#canvas.height;
    const { add, keep } = this.#blend;
    for (let y = zone.y0; y < zone.y1; y++) {
      const gy = rect.y + y;
      let px = a * (rect.x + zone.x0 + 0.5) + c * (gy + 0.5) + tx;
      let py = b * (rect.x + zone.x0 + 0.5) + d * (gy + 0.5) + ty;
      const tailRow = tail !== undefined && tailRect !== null && gy >= tailRect.y0 && gy < tailRect.y1;
      for (let x = zone.x0; x < zone.x1; x++, px += a, py += b) {
        const i = y * rect.width + x;
        let value = 0;
        if (px >= 0 && py >= 0 && px < cw && py < ch) {
          value = permanent[i]!;
          const gx = rect.x + x;
          if (tailRow && gx >= tailRect!.x0 && gx < tailRect!.x1) {
            const ox = px - tail!.ax;
            const oy = py - tail!.ay;
            if (soft) {
              const projection = ox * tail!.ux + oy * tail!.uy;
              const cross = ox * tail!.uy - oy * tail!.ux;
              const h = cross < 0 ? -cross : cross;
              if (h < radius) value += tip.sweep(h, -projection, tail!.length - projection);
            } else {
              const t = Math.min(tail!.length, Math.max(0, ox * tail!.ux + oy * tail!.uy));
              const ex = ox - t * tail!.ux;
              const ey = oy - t * tail!.uy;
              const tailValue = (radius - Math.sqrt(ex * ex + ey * ey)) / antialias + 0.5;
              if (tailValue > value) value = tailValue;
            }
          }
        }
        const coverage = soft ? 1 - Math.exp(-(value > DENSITY_CAP ? DENSITY_CAP : value)) : value > 1 ? 1 : value < 0 ? 0 : value;
        const level = Math.round(255 * coverage);
        const o = i * 4;
        const k = keep[level]!;
        out[o] = Math.round(add[level * 4]! + source[o]! * k);
        out[o + 1] = Math.round(add[level * 4 + 1]! + source[o + 1]! * k);
        out[o + 2] = Math.round(add[level * 4 + 2]! + source[o + 2]! * k);
        out[o + 3] = Math.round(add[level * 4 + 3]! + source[o + 3]! * k);
      }
    }
    return out;
  }
}
