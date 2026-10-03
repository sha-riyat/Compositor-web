import {
  paintTarget,
  setLayerAsset,
  type BrushSettings,
  type Layer,
  type PaintStroke,
  type RasterHandoff,
  type TiledRaster,
  type Tool,
  type ToolApi,
} from '@compositor/model';
import { noteSettle } from '../latency.js';

/**
 * L'outil Brosse — `beginBrush`, `continueBrush` et `finishBrushImmediately`
 * de `EditorSession+Brush.swift`.
 *
 * Le document ne change qu'au relâchement : d'ici là, le trait ne fait que
 * dessiner son aperçu. Le trait entier est **une** entrée d'annulation,
 * « Coup de brosse » ; un trait qui n'a rien peint n'en laisse aucune.
 *
 * Peint par le GPU, le raster arrive quelques images après le relâchement :
 * ses tuiles sont relues par petits morceaux, l'aperçu restant affiché. Un
 * nouveau trait commencé avant termine d'abord cette relecture.
 */

/** Le temps qu'une image peut consacrer à la relecture, en millisecondes. */
const READBACK_BUDGET_MS = 6;

export interface BrushToolDeps {
  readonly settings: () => BrushSettings;
}

interface Active {
  readonly layer: Layer;
  readonly stroke: PaintStroke;
}

interface Pending {
  readonly layer: Layer;
  readonly stroke: PaintStroke;
  readonly handoff: RasterHandoff;
  readonly api: ToolApi;
  readonly releasedAt: number;
}

export const createBrushTool = (deps: BrushToolDeps): Tool => {
  let active: Active | null = null;
  let pending: Pending | null = null;

  /** Le raster est prêt : il entre dans le document, et l'aperçu devient sa texture. */
  const commit = (raster: TiledRaster | null): void => {
    const { layer, stroke, api, releasedAt } = pending!;
    pending = null;
    if (raster === null) {
      api.endHistory();
      stroke.cancel();
    } else {
      const asset = api.assets.addRaster(raster);
      api.mutate((document) => setLayerAsset(document, layer.id, asset));
      api.endHistory();
      stroke.adopt(asset);
    }
    noteSettle(performance.now() - releasedAt);
    api.requestRedraw();
  };

  const drive = (): void => {
    if (pending === null) return;
    const raster = pending.handoff.step(READBACK_BUDGET_MS);
    if (raster === undefined) requestAnimationFrame(drive);
    else commit(raster);
  };

  /** L'aperçu se met à jour une fois par lot d'échantillons, pas par échantillon. */
  const present = (api: ToolApi): void => {
    if (active === null) return;
    active.stroke.present();
    api.requestRedraw();
  };

  return {
    id: 'brush',
    label: 'Brosse',
    options: [],

    cursor: () => 'crosshair',

    onPointerDown(event, api) {
      // Le trait précédent doit être dans le document avant que celui-ci ne parte de ses pixels.
      if (pending !== null) commit(pending.handoff.complete());
      const { target, refusal } = paintTarget(api.document, api.activeLayerId, api.selectedLayerIds);
      if (target === null) {
        if (refusal !== null) api.notify(refusal);
        return;
      }
      const source = target.asset === null ? null : (api.assets.source(target.asset) ?? null);
      const size = target.transform.size;
      // Un calque vide a la taille de son placement, en pixels entiers.
      const width = source?.width ?? Math.max(1, Math.round(size.width));
      const height = source?.height ?? Math.max(1, Math.round(size.height));
      const document = api.document!;
      // Ouverte dès la pression : pendant le geste, l'historique refuse
      // d'annuler, et le trait ne peut pas se poser sur un état annulé.
      api.beginHistory('Coup de brosse');
      const stroke = api.beginStroke(
        target.id,
        target.asset,
        { width, height, source, transform: target.transform, canvas: { width: document.width, height: document.height } },
        deps.settings(),
      );
      active = { layer: target, stroke };
      stroke.append(event.point);
      present(api);
    },

    onPointerMove(event) {
      active?.stroke.append(event.point);
    },

    onInputBatchEnd(api) {
      present(api);
    },

    onPointerUp(event, api) {
      if (active === null) return;
      const { layer, stroke } = active;
      active = null;
      stroke.append(event.point);
      pending = { layer, stroke, handoff: stroke.finish(), api, releasedAt: performance.now() };
      api.requestRedraw();
      drive();
    },
  };
};
