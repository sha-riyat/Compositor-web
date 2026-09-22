import type {
  Layer,
  Point,
  Tool,
  ToolApi,
  ToolCursorContext,
  ToolEvent,
  Transform,
} from '@compositor/model';
import { replaceLayer, topmostLayerAt, transformContains } from '@compositor/model';

/**
 * Le premier outil concret — il valide la signature de `ToolApi`.
 *
 * **Non destructif** : redimensionner écrit dans `transform`, jamais dans les
 * pixels. Une image garde sa résolution pleine quelle que soit la réduction,
 * ce qui est un critère de sortie du pari.
 *
 * Hors périmètre en T1 : rotation, retournements, distorsion libre, magnétisme,
 * guides, valeurs exactes. Tout cela est T8.
 */

export type HandleId =
  | 'nw' | 'n' | 'ne'
  | 'w' | 'e'
  | 'sw' | 's' | 'se';

const HANDLES: readonly HandleId[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];

/** Rayon de préhension d'une poignée, en pixels document. Ajusté par le zoom. */
export const HANDLE_RADIUS = 6;

export const handlePosition = (transform: Transform, handle: HandleId): Point => {
  const { origin, size } = transform;
  const left = origin.x;
  const top = origin.y;
  const right = origin.x + size.width;
  const bottom = origin.y + size.height;
  const midX = origin.x + size.width / 2;
  const midY = origin.y + size.height / 2;
  switch (handle) {
    case 'nw': return { x: left, y: top };
    case 'n': return { x: midX, y: top };
    case 'ne': return { x: right, y: top };
    case 'w': return { x: left, y: midY };
    case 'e': return { x: right, y: midY };
    case 'sw': return { x: left, y: bottom };
    case 's': return { x: midX, y: bottom };
    case 'se': return { x: right, y: bottom };
  }
};

export const handleAt = (
  transform: Transform,
  point: Point,
  tolerance: number,
): HandleId | null => {
  for (const handle of HANDLES) {
    const position = handlePosition(transform, handle);
    if (
      Math.abs(point.x - position.x) <= tolerance &&
      Math.abs(point.y - position.y) <= tolerance
    ) {
      return handle;
    }
  }
  return null;
};

export const handleCursor = (handle: HandleId): string => {
  switch (handle) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'n': case 's': return 'ns-resize';
    case 'w': case 'e': return 'ew-resize';
  }
};

/**
 * Applique un glissement de poignée. `lockRatio` conserve les proportions —
 * verrouillé par défaut, comme `locksTransformRatio` dans le Swift, et inversé
 * par Maj.
 */
export const resizeTransform = (
  start: Transform,
  handle: HandleId,
  delta: Point,
  lockRatio: boolean,
): Transform => {
  let { x, y } = start.origin;
  let { width, height } = start.size;

  const movesLeft = handle === 'nw' || handle === 'w' || handle === 'sw';
  const movesRight = handle === 'ne' || handle === 'e' || handle === 'se';
  const movesTop = handle === 'nw' || handle === 'n' || handle === 'ne';
  const movesBottom = handle === 'sw' || handle === 's' || handle === 'se';

  if (movesLeft) { x += delta.x; width -= delta.x; }
  if (movesRight) { width += delta.x; }
  if (movesTop) { y += delta.y; height -= delta.y; }
  if (movesBottom) { height += delta.y; }

  if (lockRatio && start.size.width > 0 && start.size.height > 0) {
    const ratio = start.size.width / start.size.height;
    const corner = (movesLeft || movesRight) && (movesTop || movesBottom);
    if (corner) {
      // Le côté qui a le plus bougé, en proportion, mène le redimensionnement.
      if (Math.abs(width / start.size.width) > Math.abs(height / start.size.height)) {
        const next = width / ratio;
        if (movesTop) y += height - next;
        height = next;
      } else {
        const next = height * ratio;
        if (movesLeft) x += width - next;
        width = next;
      }
    } else if (movesLeft || movesRight) {
      height = width / ratio;
    } else {
      width = height * ratio;
    }
  }

  // Une taille nulle ou négative rendrait le calque insaisissable.
  const minimum = 1;
  if (width < minimum) { if (movesLeft) x -= minimum - width; width = minimum; }
  if (height < minimum) { if (movesTop) y -= minimum - height; height = minimum; }

  return { ...start, origin: { x, y }, size: { width, height } };
};

interface Drag {
  readonly layerId: string;
  readonly startTransform: Transform;
  readonly startPoint: Point;
  readonly handle: HandleId | null;
}

export interface MoveToolOptions {
  /** Tolérance de préhension convertie en pixels document par l'appelant. */
  handleTolerance(): number;
  /** Faux par défaut : la pression prend le calque sous le pointeur. */
  autoSelect(): boolean;
  transformBoxVisible(): boolean;
  lockRatioByDefault(): boolean;
}

export const createMoveTool = (options: MoveToolOptions): Tool => {
  let drag: Drag | null = null;

  const activeLayer = (api: ToolApi): Layer | undefined => {
    const document = api.document;
    if (document === null || api.activeLayerId === null) return undefined;
    return document.layers.find((l) => l.id === api.activeLayerId);
  };

  const pickLayer = (api: ToolApi, point: Point): Layer | undefined => {
    const document = api.document;
    if (document === null) return undefined;
    // Par défaut le Swift prend le calque **sous le pointeur** ; `autoSelect`
    // inverse ce comportement et garde le calque actif.
    if (options.autoSelect()) {
      const current = activeLayer(api);
      if (current !== undefined && transformContains(current.transform, point)) return current;
    }
    return topmostLayerAt(document, point);
  };

  return {
    id: 'move',
    label: 'Déplacer / Transformer (V)',
    options: [],

    cursor(context: ToolCursorContext, api: ToolApi): string {
      const layer = activeLayer(api);
      if (layer !== undefined && options.transformBoxVisible()) {
        const handle = handleAt(layer.transform, context.point, options.handleTolerance());
        if (handle !== null) return handleCursor(handle);
      }
      return context.overLayerId !== null ? 'move' : 'default';
    },

    onPointerDown(event: ToolEvent, api: ToolApi): void {
      const current = activeLayer(api);

      // Une poignée du calque actif l'emporte sur la sélection d'un autre calque.
      if (current !== undefined && options.transformBoxVisible()) {
        const handle = handleAt(current.transform, event.point, options.handleTolerance());
        if (handle !== null) {
          drag = {
            layerId: current.id,
            startTransform: current.transform,
            startPoint: event.point,
            handle,
          };
          api.beginHistory('Redimensionner le calque');
          return;
        }
      }

      const picked = pickLayer(api, event.point);
      if (picked === undefined) {
        api.selectLayer(null);
        return;
      }
      api.selectLayer(picked.id);
      drag = {
        layerId: picked.id,
        startTransform: picked.transform,
        startPoint: event.point,
        handle: null,
      };
      api.beginHistory('Déplacer le calque');
    },

    onPointerMove(event: ToolEvent, api: ToolApi): void {
      if (drag === null) return;
      const delta = {
        x: event.point.x - drag.startPoint.x,
        y: event.point.y - drag.startPoint.y,
      };
      const { handle, startTransform, layerId } = drag;

      api.mutate((document) =>
        replaceLayer(document, layerId, (layer) => ({
          ...layer,
          transform:
            handle === null
              ? {
                  ...startTransform,
                  origin: {
                    x: startTransform.origin.x + delta.x,
                    y: startTransform.origin.y + delta.y,
                  },
                }
              : resizeTransform(
                  startTransform,
                  handle,
                  delta,
                  // Maj inverse le comportement par défaut du verrouillage.
                  options.lockRatioByDefault() !== event.shiftKey,
                ),
        })),
      );
      api.requestRedraw();
    },

    onPointerUp(_event: ToolEvent, api: ToolApi): void {
      if (drag === null) return;
      drag = null;
      api.endHistory();
    },
  };
};
