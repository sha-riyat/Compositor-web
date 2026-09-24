import type { CompositorDocument } from './document.js';
import { LIMITS } from './document.js';
import type { Layer, LayerId } from './layer.js';
import { createLayer } from './layer.js';
import { identityTransform } from './geometry.js';

/**
 * Les opérations sur la pile de calques.
 *
 * Toutes sont immuables et rendent le document inchangé quand elles n'ont rien
 * à faire — c'est ce qui permet à l'historique de ne rien pousser pour une
 * action sans effet.
 *
 * Le modèle stocke du **bas vers le haut**. Le panneau affiche l'inverse, et
 * cette inversion vit dans le composant, à un seul endroit.
 */

/** Déplace un calque à un nouvel indice, en coordonnées « bas vers le haut ». */
export const moveLayer = (
  document: CompositorDocument,
  id: LayerId,
  toIndex: number,
): CompositorDocument => {
  const from = document.layers.findIndex((l) => l.id === id);
  if (from < 0) return document;
  const target = Math.max(0, Math.min(document.layers.length - 1, toIndex));
  if (from === target) return document;

  const layers = document.layers.slice();
  const [moved] = layers.splice(from, 1);
  layers.splice(target, 0, moved!);
  return { ...document, layers };
};

/** Insère un calque vide au-dessus d'un autre, ou au sommet. */
export const insertBlankLayer = (
  document: CompositorDocument,
  id: LayerId,
  name: string,
  above: LayerId | null = null,
): CompositorDocument => {
  if (document.layers.length >= LIMITS.maxLayers) return document;

  const layer = createLayer(
    id,
    name,
    identityTransform({ width: document.width, height: document.height }),
  );
  const at = above === null ? -1 : document.layers.findIndex((l) => l.id === above);
  const layers = document.layers.slice();
  layers.splice(at < 0 ? layers.length : at + 1, 0, layer);
  return { ...document, layers };
};

/** Supprime plusieurs calques d'un coup — une seule entrée d'historique. */
export const removeLayers = (
  document: CompositorDocument,
  ids: readonly LayerId[],
): CompositorDocument => {
  if (ids.length === 0) return document;
  const doomed = new Set(ids);
  const layers = document.layers.filter((l) => !doomed.has(l.id));
  if (layers.length === document.layers.length) return document;
  // Un enfant dont le dossier disparaît remonte à la racine plutôt que de
  // pointer vers un parent inexistant.
  return {
    ...document,
    layers: layers.map((l) =>
      l.parentId !== null && doomed.has(l.parentId) ? { ...l, parentId: null } : l,
    ),
  };
};

/**
 * Duplique des calques, chacun juste au-dessus de son original. Les copies
 * partagent l'actif : les pixels ne sont pas recopiés, seul le compteur de
 * références monte.
 */
export const duplicateLayers = (
  document: CompositorDocument,
  ids: readonly LayerId[],
  nextId: () => LayerId,
): { document: CompositorDocument; created: LayerId[] } => {
  if (ids.length === 0) return { document, created: [] };

  const wanted = new Set(ids);
  const layers: Layer[] = [];
  const created: LayerId[] = [];

  for (const layer of document.layers) {
    layers.push(layer);
    if (!wanted.has(layer.id)) continue;
    if (layers.length >= LIMITS.maxLayers) continue;
    const copy: Layer = { ...layer, id: nextId(), name: `${layer.name} copie` };
    layers.push(copy);
    created.push(copy.id);
  }

  if (created.length === 0) return { document, created: [] };
  return { document: { ...document, layers }, created };
};

/** Règle l'opacité de plusieurs calques — une seule entrée d'historique. */
export const setLayersOpacity = (
  document: CompositorDocument,
  ids: readonly LayerId[],
  opacity: number,
): CompositorDocument => {
  if (ids.length === 0) return document;
  const wanted = new Set(ids);
  const clamped = Math.max(0, Math.min(1, opacity));
  let changed = false;
  const layers = document.layers.map((l) => {
    if (!wanted.has(l.id) || l.opacity === clamped) return l;
    changed = true;
    return { ...l, opacity: clamped };
  });
  return changed ? { ...document, layers } : document;
};

/** Bascule la visibilité de plusieurs calques vers une même valeur. */
export const setLayersVisible = (
  document: CompositorDocument,
  ids: readonly LayerId[],
  isVisible: boolean,
): CompositorDocument => {
  if (ids.length === 0) return document;
  const wanted = new Set(ids);
  let changed = false;
  const layers = document.layers.map((l) => {
    if (!wanted.has(l.id) || l.isVisible === isVisible) return l;
    changed = true;
    return { ...l, isVisible };
  });
  return changed ? { ...document, layers } : document;
};

export const renameLayer = (
  document: CompositorDocument,
  id: LayerId,
  name: string,
): CompositorDocument => {
  const trimmed = name.trim();
  if (trimmed === '') return document;
  const index = document.layers.findIndex((l) => l.id === id);
  if (index < 0 || document.layers[index]!.name === trimmed) return document;
  const layers = document.layers.slice();
  layers[index] = { ...layers[index]!, name: trimmed };
  return { ...document, layers };
};

/**
 * La plage entre deux calques, bornes comprises — ce que produit un clic avec
 * Maj dans le panneau.
 */
export const layerRange = (
  document: CompositorDocument,
  from: LayerId,
  to: LayerId,
): LayerId[] => {
  const a = document.layers.findIndex((l) => l.id === from);
  const b = document.layers.findIndex((l) => l.id === to);
  if (a < 0 || b < 0) return [];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return document.layers.slice(lo, hi + 1).map((l) => l.id);
};

/**
 * Le calque qui devient actif après une suppression — la règle de
 * `finishDeletingLayer` (`Compositor/Document/LiveLayerMask.swift`).
 *
 * Les calques partent un à un, dans l'ordre de la pile. Quand le calque actif
 * disparaît, celui qui prend sa place dans la pile devient actif — le suivant
 * au-dessus, ou le nouveau sommet s'il était en haut. Une pile vidée n'a plus
 * de calque actif.
 */
export const activeAfterRemoval = (
  document: CompositorDocument,
  ids: readonly LayerId[],
  active: LayerId | null,
): LayerId | null => {
  const remaining = document.layers.map((l) => l.id);
  const doomed = new Set(ids);
  let current = active;
  for (const id of document.layers.map((l) => l.id).filter((l) => doomed.has(l))) {
    const index = remaining.indexOf(id);
    remaining.splice(index, 1);
    if (current === id) {
      current = remaining.length === 0 ? null : remaining[Math.min(index, remaining.length - 1)]!;
    }
  }
  return current;
};

