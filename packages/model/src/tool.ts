import type { CompositorDocument } from './document.js';
import type { Point } from './geometry.js';
import type { LayerId } from './layer.js';
import type { ToolId } from './store.js';

/**
 * `ToolApi` est la **seule** porte vers le document. Aucun outil ne touche
 * WebGL ni les stores directement.
 *
 * C'est ce qui rendra portables les 54 fichiers de tests de
 * `reference/CompositorTests/` : ils pilotent cette interface, pas l'interface
 * graphique. C'est aussi la raison pour laquelle sa signature est figée en T1 —
 * la changer ensuite toucherait les seize outils.
 */
export interface ToolApi {
  readonly document: CompositorDocument | null;
  readonly activeLayerId: LayerId | null;

  /**
   * Ouvre une transaction d'annulation. Les appels s'imbriquent : seul le
   * premier `beginHistory` ouvre réellement, seul le dernier `endHistory`
   * ferme. Si le document n'a pas changé entre les deux, rien n'est poussé —
   * sinon sélectionner un calque détruirait le rétablissement
   * (`DocumentHistory.swift`).
   */
  beginHistory(name: string): void;
  mutate(fn: (document: CompositorDocument) => CompositorDocument): void;
  endHistory(): void;

  selectLayer(id: LayerId | null): void;
  requestRedraw(): void;

  /** Position du pointeur convertie en coordonnées document. */
  toDocument(client: Point): Point;

  // paintTile(...) arrive en T4, avec le stockage pavé.
}

export interface ToolEvent {
  /** En coordonnées document, origine au coin supérieur gauche du canevas. */
  readonly point: Point;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  /** Commande sur macOS, Contrôle ailleurs — le « modificateur principal ». */
  readonly primaryKey: boolean;
  readonly button: number;
  readonly pressure: number;
}

export interface ToolCursorContext {
  readonly point: Point;
  readonly overLayerId: LayerId | null;
}

/**
 * Le schéma des options pilote l'en-tête d'outil : l'interface se construit à
 * partir de lui, plutôt que chaque outil ne dessine son propre panneau.
 */
export type ToolOption =
  | { readonly kind: 'number'; readonly key: string; readonly label: string; readonly min: number; readonly max: number; readonly step: number; readonly unit?: string }
  | { readonly kind: 'toggle'; readonly key: string; readonly label: string }
  | { readonly kind: 'choice'; readonly key: string; readonly label: string; readonly options: readonly { readonly value: string; readonly label: string }[] };

export interface Tool {
  readonly id: ToolId;
  readonly label: string;
  cursor(context: ToolCursorContext, api: ToolApi): string;
  onPointerDown(event: ToolEvent, api: ToolApi): void;
  onPointerMove(event: ToolEvent, api: ToolApi): void;
  onPointerUp(event: ToolEvent, api: ToolApi): void;
  /** Renvoie `true` si l'outil a consommé la touche. */
  onKey?(event: KeyboardEventLike, api: ToolApi): boolean;
  readonly options: readonly ToolOption[];
}

/**
 * Le sous-ensemble d'un `KeyboardEvent` dont un outil a besoin — le paquet
 * `model` n'a pas accès aux types du DOM, par construction.
 *
 * `key` et non `code` : le Swift lit `charactersIgnoringModifiers`, donc le
 * caractère **imprimé sur la touche**. Sur un clavier AZERTY, `code: "KeyQ"`
 * correspond à la touche marquée A — utiliser `code` placerait les raccourcis
 * comme sur un QWERTY.
 */
export interface KeyboardEventLike {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly primaryKey: boolean;
}
