import {
  BrushStroke,
  paintTarget,
  setLayerAsset,
  type BrushSettings,
  type Layer,
  type Tool,
  type ToolApi,
  type ToolEvent,
} from '@compositor/model';

/**
 * L'outil Brosse — `beginBrush`, `continueBrush` et `finishBrushImmediately`
 * de `EditorSession+Brush.swift`.
 *
 * Le document ne change qu'au relâchement : d'ici là, seules les tuiles
 * touchées partent vers l'aperçu. Le trait entier est **une** entrée
 * d'annulation, « Coup de brosse » ; un trait qui n'a rien peint n'en
 * laisse aucune.
 */

export interface BrushToolDeps {
  readonly settings: () => BrushSettings;
}

interface Active {
  readonly layer: Layer;
  readonly stroke: BrushStroke;
}

export const createBrushTool = (deps: BrushToolDeps): Tool => {
  let active: Active | null = null;

  const append = (event: ToolEvent): void => {
    if (active === null) return;
    active.stroke.append(event.point);
  };

  /** Les tuiles sont recomposées une fois par lot d'échantillons, pas par échantillon. */
  const flush = (api: ToolApi): void => {
    if (active === null) return;
    api.updateStroke(active.stroke.takeDirty());
    api.requestRedraw();
  };

  return {
    id: 'brush',
    label: 'Brosse',
    options: [],

    cursor: () => 'crosshair',

    onPointerDown(event, api) {
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
      const stroke = new BrushStroke(
        { width, height, source, transform: target.transform, canvas: { width: document.width, height: document.height } },
        deps.settings(),
      );
      active = { layer: target, stroke };
      // Ouverte dès la pression : pendant le geste, l'historique refuse
      // d'annuler, et le trait ne peut pas se poser sur un état annulé.
      api.beginHistory('Coup de brosse');
      api.beginStroke(target.id, target.asset, width, height);
      append(event);
      flush(api);
    },

    onPointerMove(event) {
      append(event);
    },

    onInputBatchEnd(api) {
      flush(api);
    },

    onPointerUp(event, api) {
      if (active === null) return;
      append(event);
      // La fin provisoire devient sa courbe, puis l'aperçu reçoit ces dernières
      // tuiles : sa texture va représenter le raster, elle doit lui être égale.
      active.stroke.flush();
      flush(api);
      const { layer, stroke } = active;
      active = null;
      const raster = stroke.commit();
      if (raster === null) {
        api.endHistory();
        api.cancelStroke();
        return;
      }
      const asset = api.assets.addRaster(raster);
      api.mutate((document) => setLayerAsset(document, layer.id, asset));
      api.endHistory();
      api.commitStroke(asset);
      api.requestRedraw();
    },
  };
};
