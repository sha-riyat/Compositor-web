/**
 * Une implémentation de référence des formules de fusion de la spécification
 * PDF, écrite **indépendamment du shader**.
 *
 * C'est ce qui rend le test non circulaire : le GPU exécute du GLSL, ceci
 * s'exécute en TypeScript sur le processeur, et les deux doivent tomber sur les
 * mêmes octets. Comparer le shader à des valeurs gelées depuis le shader ne
 * prouverait rien d'autre que sa stabilité.
 *
 * Aucune référence macOS n'est nécessaire pour cela — ce que la version macOS
 * apporterait en plus, c'est la confirmation que Core Graphics applique bien
 * ces formules-là. À obtenir le jour où une capture sera disponible.
 */

export type BlendMode =
  | 'normal'
  | 'darken' | 'multiply' | 'colorBurn' | 'linearBurn'
  | 'lighten' | 'screen' | 'colorDodge' | 'linearDodge'
  | 'overlay' | 'softLight' | 'hardLight' | 'vividLight' | 'linearLight' | 'pinLight' | 'hardMix'
  | 'difference' | 'exclusion' | 'subtract' | 'divide'
  | 'hue' | 'saturation' | 'color' | 'luminosity';

export const ALL_MODES: readonly BlendMode[] = [
  'normal',
  'darken', 'multiply', 'colorBurn', 'linearBurn',
  'lighten', 'screen', 'colorDodge', 'linearDodge',
  'overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix',
  'difference', 'exclusion', 'subtract', 'divide',
  'hue', 'saturation', 'color', 'luminosity',
];

type Rgb = readonly [number, number, number];

const multiply = (b: number, s: number): number => b * s;
const screen = (b: number, s: number): number => b + s - b * s;
const hardLight = (b: number, s: number): number =>
  s <= 0.5 ? multiply(b, 2 * s) : screen(b, 2 * s - 1);

const colorDodge = (b: number, s: number): number =>
  b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s));

const colorBurn = (b: number, s: number): number =>
  b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s);

const softLight = (b: number, s: number): number => {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Densité couleur + sous 50 %, Densité couleur − au-dessus. */
const vividLight = (b: number, s: number): number =>
  s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * s - 1);

/**
 * Tout ou rien : 1 quand fond et source additionnés atteignent 1. C'est
 * l'équivalent exact de « Lumière vive ≥ 0,5 », sans ses divisions.
 *
 * Les octets tombent sur des multiples de 1/255 : `b + s ≥ 1` se décide sur un
 * entier, et le demi-pas de marge garde la même décision au GPU malgré
 * l'arrondi flottant.
 */
const hardMix = (b: number, s: number): number => (b + s > 1 - 0.5 / 255 ? 1 : 0);

/**
 * Le fond divisé par la source. Diviser par zéro donne du blanc, sauf sur un
 * fond noir — 0/0 reste noir.
 */
const divide = (b: number, s: number): number => (s <= 0 ? (b <= 0 ? 0 : 1) : Math.min(1, b / s));

const SEPARABLE: Record<string, (b: number, s: number) => number> = {
  normal: (_b, s) => s,
  darken: (b, s) => Math.min(b, s),
  multiply,
  colorBurn,
  linearBurn: (b, s) => Math.max(0, b + s - 1),
  lighten: (b, s) => Math.max(b, s),
  screen,
  colorDodge,
  linearDodge: (b, s) => Math.min(1, b + s),
  overlay: (b, s) => hardLight(s, b),
  softLight,
  hardLight,
  vividLight,
  linearLight: (b, s) => clamp01(b + 2 * s - 1),
  pinLight: (b, s) => (s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1)),
  hardMix,
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
  // Le fond moins la source, jamais l'inverse : l'amont s'y est déjà trompé.
  subtract: (b, s) => Math.max(0, b - s),
  divide,
};

/** Les coefficients de la spécification, non ceux de Rec. 709. */
const lum = (c: Rgb): number => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

const EPS = 1e-5;

const clipColor = (c: Rgb): Rgb => {
  let out: number[] = [...c];
  const l = lum(c);
  const n = Math.min(...out);
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / Math.max(l - n, EPS));
  const l2 = lum(out as unknown as Rgb);
  const x = Math.max(...out);
  if (x > 1) out = out.map((v) => l2 + ((v - l2) * (1 - l2)) / Math.max(x - l2, EPS));
  return out as unknown as Rgb;
};

const setLum = (c: Rgb, l: number): Rgb => {
  const d = l - lum(c);
  return clipColor(c.map((v) => v + d) as unknown as Rgb);
};

const sat = (c: Rgb): number => Math.max(...c) - Math.min(...c);

const setSat = (c: Rgb, s: number): Rgb => {
  const mn = Math.min(...c);
  const mx = Math.max(...c);
  return (mx > mn ? c.map((v) => ((v - mn) * s) / (mx - mn)) : [0, 0, 0]) as unknown as Rgb;
};

const NON_SEPARABLE: Record<string, (cb: Rgb, cs: Rgb) => Rgb> = {
  hue: (cb, cs) => setLum(setSat(cs, sat(cb)), lum(cb)),
  saturation: (cb, cs) => setLum(setSat(cb, sat(cs)), lum(cb)),
  color: (cb, cs) => setLum(cs, lum(cb)),
  luminosity: (cb, cs) => setLum(cb, lum(cs)),
};

/**
 * La composition complète, sur couleurs dé-prémultipliées :
 *
 *     αo = αs + αb·(1 − αs)
 *     Co = (1−αb)·αs·Cs + (1−αs)·αb·Cb + αs·αb·B(Cb, Cs)
 *
 * Le premier terme est celui que Core Graphics laisse tomber pour Color Dodge
 * et Color Burn. Il ne pèse que lorsque le fond est partiellement transparent —
 * d'où les cas à `αb < 1` dans la suite de tests.
 *
 * `Co` est déjà prémultiplié.
 */
export const composite = (
  mode: BlendMode,
  cb: Rgb,
  ab: number,
  cs: Rgb,
  as: number,
): [number, number, number, number] => {
  const blended =
    NON_SEPARABLE[mode] !== undefined
      ? NON_SEPARABLE[mode]!(cb, cs)
      : (cb.map((v, i) => SEPARABLE[mode]!(v, cs[i]!)) as unknown as Rgb);

  const co = cb.map(
    (_, i) => (1 - ab) * as * cs[i]! + (1 - as) * ab * cb[i]! + as * ab * blended[i]!,
  );

  return [
    Math.round(co[0]! * 255),
    Math.round(co[1]! * 255),
    Math.round(co[2]! * 255),
    Math.round((as + ab * (1 - as)) * 255),
  ];
};
