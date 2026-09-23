import type { Layer, LayerId } from './layer.js';
import { transformContains } from './geometry.js';
import type { AssetStore } from './assets.js';

/**
 * Limites reprises de `Compositor/docs/project-format.md`. Celle des côtés est
 * volontairement abaissée en T1 : le compositeur n'est pas encore pavé, donc
 * une texture ne peut pas dépasser ce qu'une carte accepte. Elle remontera à
 * 30 000 en T4.
 */
export const LIMITS = {
  maxSide: 4096,
  maxSideTarget: 30_000,
  maxSourcePixels: 100_000_000,
  maxLayers: 10_000,
} as const;

export interface CompositorDocument {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** Pixels par pouce. 72 par défaut, comme les manifestes sans le champ. */
  readonly resolution: number;
  /** Du bas vers le haut, comme dans le Swift. */
  readonly layers: readonly Layer[];
}

export const createDocument = (
  id: string,
  width: number,
  height: number,
  resolution = 72,
): CompositorDocument => ({ id, width, height, resolution, layers: [] });

export const layersById = (doc: CompositorDocument): ReadonlyMap<LayerId, Layer> =>
  new Map(doc.layers.map((l) => [l.id, l]));

export const findLayer = (doc: CompositorDocument, id: LayerId): Layer | undefined =>
  doc.layers.find((l) => l.id === id);

export const replaceLayer = (
  doc: CompositorDocument,
  id: LayerId,
  update: (layer: Layer) => Layer,
): CompositorDocument => {
  const index = doc.layers.findIndex((l) => l.id === id);
  if (index < 0) return doc;
  const current = doc.layers[index]!;
  const next = update(current);
  if (next === current) return doc;
  const layers = doc.layers.slice();
  layers[index] = next;
  return { ...doc, layers };
};

export const addLayer = (doc: CompositorDocument, layer: Layer): CompositorDocument => ({
  ...doc,
  layers: [...doc.layers, layer],
});

export const removeLayer = (doc: CompositorDocument, id: LayerId): CompositorDocument => ({
  ...doc,
  layers: doc.layers.filter((l) => l.id !== id),
});

/**
 * Le calque le plus haut dont la boîte contient le point. C'est le
 * comportement par défaut du Swift depuis le commit `26acd89` : une pression
 * choisit le calque **sous le pointeur**, et non le calque actif.
 */
export const topmostLayerAt = (
  doc: CompositorDocument,
  point: { x: number; y: number },
): Layer | undefined => {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const layer = doc.layers[i]!;
    if (!layer.isVisible || layer.isGroup) continue;
    if (transformContains(layer.transform, point)) return layer;
  }
  return undefined;
};

export const isValidDimension = (value: number, max: number = LIMITS.maxSide): boolean =>
  Number.isInteger(value) && value >= 1 && value <= max;

/**
 * Un document est opaque si un calque visible, à pleine opacité et en mode
 * Normal, couvre entièrement la toile avec des pixels sans transparence.
 *
 * C'est ce que la barre d'état annonce : `sRGB` seul, ou `sRGB · Transparent`.
 * Le test est volontairement conservateur — un doute rend « transparent »,
 * ce qui est le cas le plus fréquent et le moins trompeur.
 */
export const isDocumentOpaque = (
  document: CompositorDocument,
  assets: AssetStore,
): boolean =>
  document.layers.some((layer) => {
    if (!layer.isVisible || layer.isGroup || layer.asset === null) return false;
    if (layer.opacity < 1 || layer.blendMode !== 'normal') return false;
    if (layer.parentId !== null) return false;

    const { origin, size } = layer.transform;
    const covers =
      origin.x <= 0 &&
      origin.y <= 0 &&
      origin.x + size.width >= document.width &&
      origin.y + size.height >= document.height;
    if (!covers || layer.transform.radians !== 0) return false;

    return assets.get(layer.asset)?.isOpaque === true;
  });
