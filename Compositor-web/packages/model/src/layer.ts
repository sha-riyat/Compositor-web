import type { Transform } from './geometry.js';

export type LayerId = string;

/** Référence dans l'`AssetStore`. Jamais une texture — voir l'invariant ③. */
export type AssetId = string;

/**
 * Les quatorze modes de `Compositor/Compositor/Document/LayerAppearance.swift`.
 * Les quatre derniers ne sont pas séparables par canal.
 */
export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'softLight',
  'darken',
  'lighten',
  'difference',
  'colorDodge',
  'colorBurn',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Produit',
  screen: 'Superposition',
  overlay: 'Incrustation',
  softLight: 'Lumière tamisée',
  darken: 'Obscurcir',
  lighten: 'Éclaircir',
  difference: 'Différence',
  colorDodge: 'Densité couleur -',
  colorBurn: 'Densité couleur +',
  hue: 'Teinte',
  saturation: 'Saturation',
  color: 'Couleur',
  luminosity: 'Luminosité',
};

export interface Layer {
  readonly id: LayerId;
  /** `null` pour un calque vide ou un dossier. */
  readonly asset: AssetId | null;
  readonly transform: Transform;
  readonly name: string;
  readonly isVisible: boolean;
  /** L'arbre est un tableau plat plus ce champ — jamais une structure imbriquée. */
  readonly parentId: LayerId | null;
  readonly isGroup: boolean;
  /** 0 à 1. */
  readonly opacity: number;
  readonly blendMode: BlendMode;
  // mask, maskSourceId, adjustment, shape, effects, text : tranches T5 et suivantes.
}

export const createLayer = (
  id: LayerId,
  name: string,
  transform: Transform,
  asset: AssetId | null = null,
): Layer => ({
  id,
  asset,
  transform,
  name,
  isVisible: true,
  parentId: null,
  isGroup: false,
  opacity: 1,
  blendMode: 'normal',
});

/**
 * L'opacité effective d'un calque : celle d'un dossier se multiplie dans tout
 * ce qu'il contient, parce qu'un dossier est *pass-through*.
 */
export const effectiveOpacity = (layer: Layer, byId: ReadonlyMap<LayerId, Layer>): number => {
  let value = layer.opacity;
  let parentId = layer.parentId;
  let guard = 0;
  while (parentId !== null && guard++ < 64) {
    const parent = byId.get(parentId);
    if (parent === undefined) break;
    value *= parent.opacity;
    parentId = parent.parentId;
  }
  return value;
};

/** Un calque est visible seulement si tous ses dossiers ancêtres le sont. */
export const isEffectivelyVisible = (
  layer: Layer,
  byId: ReadonlyMap<LayerId, Layer>,
): boolean => {
  if (!layer.isVisible) return false;
  let parentId = layer.parentId;
  let guard = 0;
  while (parentId !== null && guard++ < 64) {
    const parent = byId.get(parentId);
    if (parent === undefined) break;
    if (!parent.isVisible) return false;
    parentId = parent.parentId;
  }
  return true;
};
