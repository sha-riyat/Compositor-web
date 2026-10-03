/**
 * La latence d'un geste, mesurée dans l'application qui tourne — le critère
 * de sortie de T4 se lit ici.
 *
 * - `inputToFrame` : de l'horodatage du **plus ancien** événement pas encore
 *   dessiné jusqu'à la fin du dessin de l'image qui le montre. C'est une
 *   borne basse de la latence perçue : la composition du navigateur et
 *   l'écran ajoutent encore leur part, qu'aucune API ne mesure.
 * - `update` : le travail de l'outil pour un événement — couverture,
 *   recomposition et téléversement des tuiles. Le repère de l'original
 *   (`docs/brush-performance.md`) mesure la même chose.
 * - `render` : le dessin d'une image.
 * - `release` : ce que le relâchement bloque, d'un bloc.
 * - `settle` : du relâchement à l'entrée du raster dans le document — la
 *   relecture des tuiles, répartie sur plusieurs images.
 *
 * `waitForGpu` fait attendre, à chaque image, que le GPU ait **fini** son
 * travail : sans cela, la mesure s'arrête quand les commandes sont envoyées,
 * et un GPU en retard passerait inaperçu.
 *
 * Seuls les gestes en cours — pointeur capturé — sont mesurés.
 */

export interface GestureTimings {
  readonly inputToFrame: number[];
  readonly update: number[];
  readonly render: number[];
  readonly release: number[];
  readonly settle: number[];
  waitForGpu: boolean;
}

const LIMIT = 5_000;

export const gestureTimings: GestureTimings = { inputToFrame: [], update: [], render: [], release: [], settle: [], waitForGpu: false };

let oldestPendingInput: number | null = null;

const push = (series: number[], value: number): void => {
  series.push(value);
  if (series.length > LIMIT) series.shift();
};

export const resetGestureTimings = (): void => {
  for (const series of [gestureTimings.inputToFrame, gestureTimings.update, gestureTimings.render, gestureTimings.release, gestureTimings.settle]) {
    series.length = 0;
  }
  oldestPendingInput = null;
};

/** Un événement du geste, avec son horodatage (`event.timeStamp`). */
export const noteInput = (timeStamp: number, updateMs: number): void => {
  oldestPendingInput ??= timeStamp;
  push(gestureTimings.update, updateMs);
};

/** Un relâchement a pris `ms` millisecondes. */
export const noteRelease = (ms: number): void => {
  push(gestureTimings.release, ms);
};

/** Le raster d'un trait est entré dans le document `ms` millisecondes après le relâchement. */
export const noteSettle = (ms: number): void => {
  push(gestureTimings.settle, ms);
};

/** Une image vient d'être dessinée, à l'instant `now` (`performance.now()`). */
export const noteFrame = (now: number, renderMs: number): void => {
  if (oldestPendingInput === null) return;
  push(gestureTimings.inputToFrame, now - oldestPendingInput);
  push(gestureTimings.render, renderMs);
  oldestPendingInput = null;
};

/** Médiane et 95ᵉ centile, pour les tests et la console. */
export const summarize = (series: readonly number[]): { count: number; median: number; p95: number } => {
  if (series.length === 0) return { count: 0, median: Number.NaN, p95: Number.NaN };
  const sorted = [...series].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return { count: sorted.length, median: at(0.5), p95: at(0.95) };
};
