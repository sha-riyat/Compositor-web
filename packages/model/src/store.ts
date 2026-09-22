import { createStore } from 'zustand/vanilla';
import type { CompositorDocument } from './document.js';
import type { LayerId } from './layer.js';
import { AssetStore } from './assets.js';

/**
 * Deux stores séparés, reprenant la distinction `@Observable` /
 * `@ObservationIgnored` du Swift :
 *
 *  - `documentStore` — ce que l'annulation couvre et ce que la sauvegarde écrit ;
 *  - `uiStore` — outil actif, zoom, panneaux. Jamais annulable, jamais sauvegardé.
 *
 * L'état éphémère — trait en cours, caches d'aperçu, guides de magnétisme — ne
 * va dans **aucun des deux** : il vit dans le `renderer`. Le mettre dans un
 * store coûterait un rendu React par `pointermove`.
 *
 * Ces stores sont `zustand/vanilla` : zéro import React, donc lisibles par les
 * outils, les workers et les tests Node.
 */

export interface DocumentState {
  document: CompositorDocument | null;
  /** Le calque principal : celui que les panneaux affichent. */
  activeLayerId: LayerId | null;
  /**
   * La sélection complète. Contient toujours `activeLayerId` quand il existe.
   * Les opérations qui portent sur « les calques sélectionnés » lisent ceci et
   * ne poussent qu'une seule entrée d'historique.
   */
  selectedLayerIds: readonly LayerId[];
  readonly assets: AssetStore;
}

export const documentStore = createStore<DocumentState>(() => ({
  document: null,
  activeLayerId: null,
  selectedLayerIds: [],
  assets: new AssetStore(),
}));

export type ToolId =
  | 'idle'
  | 'move'
  | 'marquee'
  | 'lasso'
  | 'wand'
  | 'crop'
  | 'brush'
  | 'spotHealing'
  | 'cloneStamp'
  | 'blur'
  | 'gradient'
  | 'shape'
  | 'type'
  | 'eyedropper'
  | 'hand'
  | 'zoom';

/** Les outils qui peignent avec la pointe et partagent taille, dureté, opacité. */
export const isBrushTool = (tool: ToolId): boolean =>
  tool === 'brush' || tool === 'spotHealing' || tool === 'cloneStamp' || tool === 'blur';

/** Les outils de sélection, qui partagent modificateurs, déplacement et nudge. */
export const isSelectionTool = (tool: ToolId): boolean =>
  tool === 'marquee' || tool === 'lasso' || tool === 'wand';

export interface Viewport {
  /** Échelle d'affichage. 1 = un pixel document pour un pixel CSS. */
  readonly scale: number;
  /** Décalage du document dans la vue, en pixels CSS. */
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface UIState {
  tool: ToolId;
  viewport: Viewport;
  /**
   * Off par défaut : une pression avec l'outil Déplacer prend le calque sous le
   * pointeur ; activé, elle prend le calque actif. Comme `transformAutoSelect`.
   */
  autoSelect: boolean;
  showsTransformBox: boolean;
  /** Verrouillé par défaut, comme `locksTransformRatio` dans le Swift. */
  locksTransformRatio: boolean;
}

export const uiStore = createStore<UIState>(() => ({
  tool: 'move',
  viewport: { scale: 1, offsetX: 0, offsetY: 0 },
  autoSelect: false,
  showsTransformBox: true,
  locksTransformRatio: true,
}));

export const setDocument = (document: CompositorDocument | null): void => {
  documentStore.setState({ document, activeLayerId: null, selectedLayerIds: [] });
};

export const setActiveLayer = (activeLayerId: LayerId | null): void => {
  documentStore.setState({
    activeLayerId,
    selectedLayerIds: activeLayerId === null ? [] : [activeLayerId],
  });
};

/**
 * Sélectionne plusieurs calques, `primary` devenant le calque actif. Sans
 * `primary`, c'est le dernier de la liste — le plus récemment désigné.
 */
export const selectLayers = (
  ids: readonly LayerId[],
  primary?: LayerId | null,
): void => {
  const active = primary ?? (ids.length > 0 ? ids[ids.length - 1]! : null);
  documentStore.setState({
    selectedLayerIds: ids,
    activeLayerId: active !== null && ids.includes(active) ? active : (ids[0] ?? null),
  });
};

export const setTool = (tool: ToolId): void => {
  uiStore.setState({ tool });
};

export const setViewport = (viewport: Viewport): void => {
  uiStore.setState({ viewport });
};
