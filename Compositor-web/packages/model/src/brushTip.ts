import type { Point } from './geometry.js';

/**
 * La pointe de la brosse — traduction du noyau Metal de
 * `MetalBrushCoverage.swift` et de `BrushRaster.falloff`.
 *
 * Tout est en **pixels du document** : la pointe est ronde à l'écran, quel
 * que soit le placement du calque.
 *
 * - Pointe dure : bord antialiasé sur la taille d'un pixel du calque.
 * - Pointe douce : la peinture se **dépose** le long du chemin. La densité
 *   optique d'une pointe, intégrée sur la distance parcourue, s'additionne ;
 *   la couverture vaut `1 − exp(−densité)`. C'est la forme continue de
 *   tampons « source-over » espacés de 2,5 % du diamètre : pas de pli là où
 *   le trait se croise, et le résultat ne dépend pas du nombre d'événements.
 */

/** Un segment du chemin : `[ax, ay, bx, by]`, en pixels du document. */
export type Segment = readonly [number, number, number, number];

/** La densité ne dépasse jamais ce plafond : `1 − exp(−20)` vaut 1 à l'octet près. */
export const DENSITY_CAP = 20;

const K = 2.5;

/** `BrushRaster.falloff` : une gaussienne normalisée qui atteint zéro au bord. */
export const falloff = (u: number): number => Math.max(0, (Math.exp(-K * u * u) - Math.exp(-K)) / (1 - Math.exp(-K)));

/** `BrushStroke.spacingFraction` : l'espacement des tampons dont le dépôt continu tient lieu. */
export const spacingFraction = (hardness: number): number => (hardness >= 1 ? 0.015 : 0.025);

export interface Tip {
  readonly radius: number;
  readonly hardness: number;
  /** Taille, dans le document, d'un pixel du calque : la largeur de l'antialiasing. */
  readonly antialias: number;
  /** Distance entre deux dépôts équivalents, en pixels du document. */
  readonly spacing: number;
  /** Densité d'un dépôt à la distance² `d2` du centre. */
  density(d2: number): number;
  /**
   * `∫₀ˢ density(h² + u²) du` — la densité que dépose la pointe balayée sur
   * une longueur `s` (négative : vers l'arrière), à la distance `h` de son axe.
   */
  lineIntegral(h: number, s: number): number;
  /**
   * `(lineIntegral(h, to) − lineIntegral(h, from)) / spacing` : la densité
   * qu'un segment dépose, la ligne de table n'étant cherchée qu'une fois.
   */
  sweep(h: number, from: number, to: number): number;
}

const TABLE_SIZE = 4096;
/** Côté de la table de l'intégrale, en distances normalisées de 0 à 1 ; 513 bornes. */
const LINE_STEPS = 512;
const lineTables = new Map<number, Float32Array>();

/**
 * `g(η, σ) = ∫₀^σ D(η² + τ²) dτ`, rayon ramené à 1 : une ligne par distance
 * à l'axe, une colonne par longueur parcourue. Ne dépend que de la dureté,
 * donc calculée une fois et gardée.
 */
const lineTable = (hardness: number, density: (q: number) => number): Float32Array => {
  const cached = lineTables.get(hardness);
  if (cached !== undefined) return cached;
  const n = LINE_STEPS + 1;
  const table = new Float32Array(n * n);
  const sub = 8;
  for (let i = 0; i < n; i++) {
    const eta2 = (i / LINE_STEPS) ** 2;
    let sum = 0;
    let previous = density(eta2);
    for (let j = 1; j < n; j++) {
      // Trapèzes fins entre deux colonnes de la table.
      for (let k = 1; k <= sub; k++) {
        const tau = (j - 1 + k / sub) / LINE_STEPS;
        const value = density(eta2 + tau * tau);
        sum += ((previous + value) / 2) * (1 / (LINE_STEPS * sub));
        previous = value;
      }
      table[i * n + j] = sum;
    }
  }
  lineTables.set(hardness, table);
  return table;
};

export const createTip = (diameter: number, hardness: number, antialias: number): Tip => {
  const radius = diameter / 2;
  const r2 = radius * radius;
  // La densité d'un dépôt ne dépend que de d² / r² : tabulée une fois par trait,
  // elle évite une exponentielle et un logarithme par pixel.
  const table = new Float32Array(TABLE_SIZE + 1);
  for (let i = 0; i <= TABLE_SIZE; i++) {
    const d = Math.sqrt(i / TABLE_SIZE) * radius;
    table[i] = -Math.log(Math.max(1 - softCoverage(d, radius, hardness), 0.001));
  }
  const normalized = (q: number): number => {
    const x = q * TABLE_SIZE;
    if (x >= TABLE_SIZE) return 0;
    const i = Math.floor(x);
    const f = x - i;
    return table[i]! * (1 - f) + table[i + 1]! * f;
  };
  const line = hardness < 1 ? lineTable(hardness, normalized) : new Float32Array(0);
  const n = LINE_STEPS + 1;
  const etaScale = LINE_STEPS / radius;
  const spacing = Math.max(0.25, diameter * spacingFraction(hardness));
  return {
    radius,
    hardness,
    antialias: Math.max(0.001, antialias),
    spacing,
    density: (d2) => normalized(d2 / r2),
    lineIntegral(h, s) {
      const eta = (h / radius) * LINE_STEPS;
      if (eta >= LINE_STEPS || s === 0) return 0;
      const sigma = Math.min(1, Math.abs(s) / radius) * LINE_STEPS;
      const i = Math.floor(eta);
      const j = Math.min(LINE_STEPS - 1, Math.floor(sigma));
      const fi = eta - i;
      const fj = sigma - j;
      const top = line[i * n + j]! * (1 - fj) + line[i * n + j + 1]! * fj;
      const bottom = line[(i + 1) * n + j]! * (1 - fj) + line[(i + 1) * n + j + 1]! * fj;
      return Math.sign(s) * radius * (top * (1 - fi) + bottom * fi);
    },
    sweep(h, from, to) {
      const eta = h * etaScale;
      if (eta >= LINE_STEPS) return 0;
      const i = eta | 0;
      const fi = eta - i;
      const upper = i * n;
      const lower = upper + n;
      // Deux lectures bilinéaires sur la même paire de lignes, écrites à plat :
      // cette fonction est appelée pour chaque pixel de chaque segment.
      let sigma = (to < 0 ? -to : to) * etaScale;
      if (sigma > LINE_STEPS) sigma = LINE_STEPS;
      let j = sigma | 0;
      if (j > LINE_STEPS - 1) j = LINE_STEPS - 1;
      let fj = sigma - j;
      let top = line[upper + j]! + (line[upper + j + 1]! - line[upper + j]!) * fj;
      let bottom = line[lower + j]! + (line[lower + j + 1]! - line[lower + j]!) * fj;
      let value = top + (bottom - top) * fi;
      const end = to < 0 ? -value : value;
      sigma = (from < 0 ? -from : from) * etaScale;
      if (sigma > LINE_STEPS) sigma = LINE_STEPS;
      j = sigma | 0;
      if (j > LINE_STEPS - 1) j = LINE_STEPS - 1;
      fj = sigma - j;
      top = line[upper + j]! + (line[upper + j + 1]! - line[upper + j]!) * fj;
      bottom = line[lower + j]! + (line[lower + j + 1]! - line[lower + j]!) * fj;
      value = top + (bottom - top) * fi;
      const start = from < 0 ? -value : value;
      return ((end - start) * radius) / spacing;
    },
  };
};

const softCoverage = (distance: number, radius: number, hardness: number): number => {
  const t = Math.min(1, Math.max(0, (distance / radius - hardness) / (1 - hardness)));
  return falloff(t);
};

/** Couverture d'une pointe dure à la distance `distance` de son axe. */
export const hardCoverage = (distance: number, tip: Tip): number =>
  Math.min(1, Math.max(0, (tip.radius - distance) / tip.antialias + 0.5));

/** Distance² de `(px, py)` au segment. */
export const segmentDistanceSquared = (px: number, py: number, s: Segment): number => {
  const vx = s[2] - s[0];
  const vy = s[3] - s[1];
  const t = Math.min(1, Math.max(0, ((px - s[0]) * vx + (py - s[1]) * vy) / Math.max(vx * vx + vy * vy, 1e-12)));
  const dx = px - (s[0] + t * vx);
  const dy = py - (s[1] + t * vy);
  return dx * dx + dy * dy;
};

/**
 * La densité déposée en `(px, py)` par la pointe balayée le long du segment.
 * L'original intègre par une quadrature de Gauss-Legendre à huit points ; ici
 * l'intégrale est tabulée : deux lectures par pixel au lieu de huit
 * évaluations, et des segments mis bout à bout s'additionnent exactement.
 */
export const segmentDensity = (px: number, py: number, s: Segment, tip: Tip): number =>
  preparedDensity(px, py, prepareSegment(s), tip);

/** Un segment avec sa longueur et sa direction, calculées une fois plutôt qu'à chaque pixel. */
export interface PreparedSegment {
  readonly ax: number;
  readonly ay: number;
  readonly ux: number;
  readonly uy: number;
  readonly length: number;
}

export const prepareSegment = (s: Segment): PreparedSegment => {
  const vx = s[2] - s[0];
  const vy = s[3] - s[1];
  const length = Math.sqrt(vx * vx + vy * vy);
  return length < 1e-6
    ? { ax: s[0], ay: s[1], ux: 0, uy: 0, length: 0 }
    : { ax: s[0], ay: s[1], ux: vx / length, uy: vy / length, length };
};

export const preparedDensity = (px: number, py: number, s: PreparedSegment, tip: Tip): number => {
  const ox = px - s.ax;
  const oy = py - s.ay;
  if (s.length === 0) return tip.density(ox * ox + oy * oy); // un simple clic
  const projection = ox * s.ux + oy * s.uy;
  const cross = ox * s.uy - oy * s.ux;
  const h = cross < 0 ? -cross : cross;
  if (h >= tip.radius) return 0;
  return tip.sweep(h, -projection, s.length - projection);
};

/**
 * Le morceau de courbe de `start` à `end` — Catmull-Rom centripète passant par
 * les échantillons —, découpé en segments jusqu'à rester à 0,2 px de la
 * courbe. `continuousCurve` de `BrushStroke.swift`.
 */
export const curvePiece = (start: Point, end: Point, before: Point, after: Point): Segment[] => {
  const knot = (t: number, a: Point, b: Point): number => t + Math.max(0.0001, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
  const mix = (a: Point, b: Point, ta: number, tb: number, t: number): Point => {
    const wa = (tb - t) / (tb - ta);
    const wb = (t - ta) / (tb - ta);
    return { x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb };
  };
  const t0 = 0;
  const t1 = knot(t0, before, start);
  const t2 = knot(t1, start, end);
  const t3 = knot(t2, end, after);
  const at = (u: number): Point => {
    if (u === 0) return start;
    if (u === 1) return end;
    const t = t1 + (t2 - t1) * u;
    const a = mix(before, start, t0, t1, t);
    const b = mix(start, end, t1, t2, t);
    const c = mix(end, after, t2, t3, t);
    return mix(mix(a, b, t0, t2, t), mix(b, c, t1, t3, t), t1, t2, t);
  };
  const result: Segment[] = [];
  const subdivide = (a: Point, b: Point, lo: number, hi: number, depth: number): void => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const error = (p: Point): number => {
      const t = lengthSquared > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0;
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    };
    const mid = (lo + hi) / 2;
    const m = at(mid);
    const deviation = Math.max(error(m), error(at((lo + mid) / 2)), error(at((mid + hi) / 2)));
    if (deviation <= 0.2 || depth >= 10) {
      result.push([a.x, a.y, b.x, b.y]);
      return;
    }
    subdivide(a, m, lo, mid, depth + 1);
    subdivide(m, b, mid, hi, depth + 1);
  };
  subdivide(start, end, 0, 1, 0);
  return result;
};
