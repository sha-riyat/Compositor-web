import type { Viewport } from './store.js';

/** Bornes du zoom, les mêmes que la molette. */
export const MIN_SCALE = 0.02;
export const MAX_SCALE = 64;

/**
 * Le cadrage d'un document dans une vue : centré, à 90 % de la place
 * disponible, jamais agrandi au-delà de 100 %.
 *
 * Rend `null` quand la vue n'a pas encore de taille. C'est le cas qu'il ne
 * faut surtout pas traiter comme une vue minuscule : un rectangle de 0 × 0,
 * obtenu avant la mise en page ou dans une fenêtre réduite, donnait une échelle
 * de zéro — un document invisible, et une division par zéro dans la
 * conversion des coordonnées du pointeur.
 */
export const fitViewport = (
  documentWidth: number,
  documentHeight: number,
  viewWidth: number,
  viewHeight: number,
): Viewport | null => {
  if (!(viewWidth > 0 && viewHeight > 0 && documentWidth > 0 && documentHeight > 0)) {
    return null;
  }
  const scale = Math.max(
    MIN_SCALE,
    Math.min(1, Math.min(viewWidth / documentWidth, viewHeight / documentHeight) * 0.9),
  );
  return {
    scale,
    offsetX: (viewWidth - documentWidth * scale) / 2,
    offsetY: (viewHeight - documentHeight * scale) / 2,
  };
};
