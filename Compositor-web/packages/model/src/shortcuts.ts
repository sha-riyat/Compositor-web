import { BLEND_MODES, type BlendMode } from './layer.js';

/**
 * La logique des raccourcis d'apparence, reprise de
 * `Compositor/Compositor/Document/EditorSession+Brush.swift` et
 * `LayerAppearance.swift`. Fonctions pures : l'écoute du clavier vit dans
 * l'interface, la règle vit ici et se teste en Node.
 */

/** Fenêtre pendant laquelle un second chiffre affine le premier. */
export const OPACITY_DIGIT_WINDOW_MS = 600;

export interface PendingDigit {
  readonly digit: number;
  readonly time: number;
}

/**
 * Un chiffre tapé règle l'opacité : `0` vaut 100 %, sinon le chiffre × 10.
 *
 * Un second chiffre tapé dans les 600 ms **affine** le premier au lieu de le
 * remplacer — `5` puis `5` donne 55 %, `0` puis `5` donne 5 %. Le minimum est
 * 1 %, pour que `0` puis `0` ne rende pas un calque invisible par mégarde.
 *
 * Le premier chiffre s'applique immédiatement ; le second le corrige.
 */
export const opacityFromDigit = (
  digit: number,
  time: number,
  pending: PendingDigit | null,
): { percent: number; pending: PendingDigit | null } => {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
    return { percent: -1, pending };
  }
  if (pending !== null && time - pending.time < OPACITY_DIGIT_WINDOW_MS) {
    return { percent: Math.max(1, pending.digit * 10 + digit), pending: null };
  }
  return { percent: digit === 0 ? 100 : digit * 10, pending: { digit, time } };
};

/** Le mode suivant ou précédent, en boucle, dans l'ordre des quatorze. */
export const cycleBlendMode = (mode: BlendMode, forward: boolean): BlendMode => {
  const index = BLEND_MODES.indexOf(mode);
  const from = index < 0 ? 0 : index;
  const count = BLEND_MODES.length;
  return BLEND_MODES[(from + (forward ? 1 : count - 1)) % count]!;
};
