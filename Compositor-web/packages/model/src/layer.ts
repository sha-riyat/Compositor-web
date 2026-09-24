import type { Transform } from './geometry.js';

export type LayerId = string;

/** Référence dans l'`AssetStore`. Jamais une texture — voir l'invariant ③. */
export type AssetId = string;

/**
 * Les modes de fusion, groupés comme Photoshop les groupe — et comme
 * `LayerBlendMode.groups` dans `Compositor/Document/LayerAppearance.swift` :
 * obscurcissement, éclaircissement, contraste, comparaison, composantes.
 *
 * Le menu trace une ligne entre deux groupes, pour qu'une longue liste reste
 * lisible.
 *
 * Dissolve, Couleur plus foncée et Couleur plus claire restent absents, comme
 * dans l'original : le premier disperse des pixels au lieu de mélanger, les
 * deux autres comparent la luminosité entière d'un pixel.
 */
export const BLEND_MODE_GROUPS = [
  ['normal'],
  ['darken', 'multiply', 'colorBurn', 'linearBurn'],
  ['lighten', 'screen', 'colorDodge', 'linearDodge'],
  ['overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix'],
  ['difference', 'exclusion', 'subtract', 'divide'],
  ['hue', 'saturation', 'color', 'luminosity'],
] as const;

export type BlendMode = (typeof BLEND_MODE_GROUPS)[number][number];

/**
 * Les vingt-quatre modes, à plat, dans l'ordre du menu. C'est aussi l'ordre du
 * cycle Maj + / Maj − : après Normal vient Obscurcir (`BlendShortcutTests`).
 */
export const BLEND_MODES: readonly BlendMode[] = BLEND_MODE_GROUPS.flat();

/** Les noms de la version française de Photoshop. */
export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  darken: 'Obscurcir',
  multiply: 'Produit',
  colorBurn: 'Densité couleur +',
  linearBurn: 'Densité linéaire +',
  lighten: 'Éclaircir',
  screen: 'Superposition',
  colorDodge: 'Densité couleur -',
  linearDodge: 'Densité linéaire - (Ajout)',
  overlay: 'Incrustation',
  softLight: 'Lumière tamisée',
  hardLight: 'Lumière crue',
  vividLight: 'Lumière vive',
  linearLight: 'Lumière linéaire',
  pinLight: 'Lumière ponctuelle',
  hardMix: 'Mélange maximal',
  difference: 'Différence',
  exclusion: 'Exclusion',
  subtract: 'Soustraction',
  divide: 'Division',
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
