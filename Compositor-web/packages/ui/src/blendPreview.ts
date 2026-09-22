import type { BlendMode, LayerId } from '@compositor/model';

/**
 * L'aperçu d'un mode de fusion au survol.
 *
 * `LayerAppearanceTests.hoverPreviewIsTemporaryAndNeverChangesSavedState` est
 * explicite : survoler un mode dans le menu le montre sur le canevas **sans
 * rien écrire**. Le calque garde son mode réel, le document reste non modifié,
 * et le compteur d'annulations ne bouge pas.
 *
 * C'est exactement pourquoi cette valeur ne vit **ni** dans `documentStore`
 * (elle serait annulable et marquerait le document modifié) **ni** dans
 * `uiStore` (elle provoquerait un rendu React à chaque déplacement de souris
 * dans le menu). Elle est éphémère, comme le trait de brosse le sera.
 */

export interface BlendPreview {
  readonly layerId: LayerId;
  readonly mode: BlendMode;
}

let current: BlendPreview | null = null;
const listeners = new Set<() => void>();

export const getBlendPreview = (): BlendPreview | null => current;

export const setBlendPreview = (preview: BlendPreview | null): void => {
  if (current?.layerId === preview?.layerId && current?.mode === preview?.mode) return;
  current = preview;
  for (const listener of listeners) listener();
};

/** Le canevas s'y abonne pour se redessiner ; React ne s'y abonne jamais. */
export const subscribeBlendPreview = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Le mode à afficher pour un calque : l'aperçu s'il y en a un, sinon le sien. */
export const displayedBlendMode = (
  layerId: LayerId,
  actual: BlendMode,
): BlendMode => (current !== null && current.layerId === layerId ? current.mode : actual);
