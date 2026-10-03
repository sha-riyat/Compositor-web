import { layersById, type CompositorDocument } from './document.js';
import { isEffectivelyVisible, type Layer, type LayerId } from './layer.js';

/**
 * Peut-on peindre, et sinon pourquoi — `canPaint` et `paintRefusal` de
 * `EditorSession+Brush.swift`. Un seul calque sélectionné, qui a des pixels
 * à lui et qui est visible.
 *
 * `target` est le calque à peindre ; `refusal`, la phrase à afficher quand
 * quelque chose s'y oppose. Sans calque actif, ni l'un ni l'autre : la
 * pression ne fait rien, comme dans l'original.
 */
export const paintTarget = (
  document: CompositorDocument | null,
  activeLayerId: LayerId | null,
  selectedLayerIds: readonly LayerId[],
): { target: Layer | null; refusal: string | null } => {
  const layer = document?.layers.find((l) => l.id === activeLayerId);
  if (document === null || layer === undefined) return { target: null, refusal: null };
  if (selectedLayerIds.length > 1) {
    return { target: null, refusal: 'Plusieurs calques sont sélectionnés. Sélectionnez-en un seul pour peindre dessus.' };
  }
  if (layer.isGroup) {
    return {
      target: null,
      refusal: `« ${layer.name} » est un dossier, sans pixels à lui. Peignez sur un calque qu’il contient.`,
    };
  }
  if (!isEffectivelyVisible(layer, layersById(document))) {
    return {
      target: null,
      refusal: `« ${layer.name} » est masqué, ou dans un dossier masqué. Affichez-le pour peindre dessus.`,
    };
  }
  return { target: layer, refusal: null };
};

/** Le calque reçoit les pixels que le trait a produits ; rien d'autre ne change. */
export const setLayerAsset = (document: CompositorDocument, id: LayerId, asset: string): CompositorDocument => ({
  ...document,
  layers: document.layers.map((layer) => (layer.id === id ? { ...layer, asset } : layer)),
});
