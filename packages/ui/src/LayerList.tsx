import { useCallback, useRef, useState } from 'react';
import { Copy, Plus, Trash } from '@phosphor-icons/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStore } from 'zustand';
import {
  documentStore,
  duplicateLayers,
  insertBlankLayer,
  layerRange,
  moveLayer,
  removeLayers,
  renameLayer,
  selectLayers,
  setLayersVisible,
  type CompositorDocument,
  type LayerId,
} from '@compositor/model';
import { LayerAppearance } from './LayerAppearance.js';
import { LayerRow } from './LayerRow.js';

/**
 * Le panneau de calques.
 *
 * Virtualisé : le format autorise dix mille calques, et une liste plate les
 * monterait tous. Les lignes font 52 px, la hauteur relevée dans le Swift.
 *
 * Le modèle stocke du bas vers le haut, le panneau affiche l'inverse. **Cette
 * inversion vit ici et nulle part ailleurs.**
 *
 * Les interactions — sélection au `pointerdown`, renommage en place,
 * réordonnancement par glissement — sont écrites à la main plutôt que sur la
 * `ListBox` de React Aria. Combiner virtualisation, sélection au `pointerdown`
 * et glissement demandait de reprendre le contrôle des mêmes événements que
 * la bibliothèque intercepte. À réexaminer en T5, quand le glisser-déposer
 * **imbriqué** arrivera : c'est là que son composant `Tree` gagnerait sa place.
 */

const ROW_HEIGHT = 52;
const ROW_GAP = 2;

export const LayerList = (): React.ReactElement => {
  const document = useStore(documentStore, (s) => s.document);
  const activeLayerId = useStore(documentStore, (s) => s.activeLayerId);
  const selectedLayerIds = useStore(documentStore, (s) => s.selectedLayerIds);

  const scroller = useRef<HTMLDivElement>(null);
  const [renamingId, setRenamingId] = useState<LayerId | null>(null);
  const [draggingId, setDraggingId] = useState<LayerId | null>(null);

  // Du haut vers le bas à l'écran, alors que le modèle va du bas vers le haut.
  const rows = document === null ? [] : [...document.layers].reverse();

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT + ROW_GAP,
    overscan: 6,
  });

  const mutate = useCallback(
    (change: (doc: CompositorDocument) => CompositorDocument): void => {
      const current = documentStore.getState().document;
      if (current === null) return;
      const next = change(current);
      if (next !== current) documentStore.setState({ document: next });
    },
    [],
  );

  const select = (id: LayerId, event: React.PointerEvent): void => {
    const current = documentStore.getState();
    const doc = current.document;
    if (doc === null) return;

    const additive = event.metaKey || event.ctrlKey;
    const ranged = event.shiftKey && current.activeLayerId !== null;

    if (ranged) {
      selectLayers(layerRange(doc, current.activeLayerId!, id), id);
      return;
    }
    if (additive) {
      const already = current.selectedLayerIds.includes(id);
      const next = already
        ? current.selectedLayerIds.filter((l) => l !== id)
        : [...current.selectedLayerIds, id];
      selectLayers(next, already ? (next[next.length - 1] ?? null) : id);
      return;
    }
    // Un clic simple dans une sélection existante la conserve, pour qu'un
    // glissement puisse porter sur plusieurs calques.
    if (current.selectedLayerIds.includes(id) && current.selectedLayerIds.length > 1) {
      selectLayers(current.selectedLayerIds, id);
      return;
    }
    selectLayers([id], id);
  };

  /**
   * Glissement de réordonnancement. La liste est plate et les lignes ont une
   * hauteur fixe : l'indice cible se lit directement sur la position verticale,
   * sans détection de collision.
   */
  const startDrag = (id: LayerId, event: React.PointerEvent): void => {
    const element = scroller.current;
    if (element === null || rows.length < 2) return;

    const startY = event.clientY;
    let moved = false;

    const onMove = (move: PointerEvent): void => {
      if (!moved && Math.abs(move.clientY - startY) < 4) return;
      if (!moved) {
        moved = true;
        setDraggingId(id);
      }
      const box = element.getBoundingClientRect();
      const offset = move.clientY - box.top + element.scrollTop;
      const displayed = Math.max(0, Math.min(rows.length - 1, Math.floor(offset / (ROW_HEIGHT + ROW_GAP))));
      // Retour de l'indice affiché vers l'indice du modèle.
      mutate((doc) => moveLayer(doc, id, doc.layers.length - 1 - displayed));
    };

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDraggingId(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const commitRename = (id: LayerId, name: string | null): void => {
    setRenamingId(null);
    if (name !== null) mutate((doc) => renameLayer(doc, id, name));
  };

  const addBlank = (): void =>
    mutate((doc) => insertBlankLayer(doc, crypto.randomUUID(), 'Calque', activeLayerId));

  const removeSelected = (): void => {
    const ids = documentStore.getState().selectedLayerIds;
    mutate((doc) => removeLayers(doc, ids));
    selectLayers([]);
  };

  const duplicateSelected = (): void => {
    const current = documentStore.getState();
    if (current.document === null) return;
    const { document: next, created } = duplicateLayers(
      current.document,
      current.selectedLayerIds,
      () => crypto.randomUUID(),
    );
    if (created.length === 0) return;
    documentStore.setState({ document: next });
    selectLayers(created);
  };

  const hasSelection = selectedLayerIds.length > 0;

  /**
   * La seconde ligne d'une ligne de calque, comme dans l'application macOS :
   * les dimensions pour un calque de pixels, la nature pour le reste.
   */
  const subtitle = (layerId: LayerId): string => {
    const state = documentStore.getState();
    const layer = state.document?.layers.find((l) => l.id === layerId);
    if (layer === undefined) return '';
    if (layer.isGroup) return 'Dossier';
    if (layer.asset === null) {
      const { width, height } = layer.transform.size;
      return `${Math.round(width)} × ${Math.round(height)} px · vide`;
    }
    const buffer = state.assets.get(layer.asset);
    return buffer === undefined
      ? ''
      : `${buffer.width} × ${buffer.height} px`;
  };

  return (
    <div className="flex w-[252px] shrink-0 flex-col border-l border-(--color-border) bg-(--color-panel)">
      <header className="flex h-[28px] shrink-0 items-center border-b border-(--color-border) px-2 text-ui font-medium">
        <span className="flex-1">Calques</span>
        {/* L'original affiche un compteur ici, pas un chevron de pliage. */}
        <span className="numeric font-normal text-(--color-fg-faint)">{rows.length}</span>
      </header>

      <LayerAppearance />

      {rows.length === 0 ? (
        <p className="p-3 text-ui text-(--color-fg-faint)">
          Déposez une image PNG sur le canevas.
        </p>
      ) : (
        <div
          ref={scroller}
          role="listbox"
          aria-label="Calques"
          aria-multiselectable
          className="flex-1 overflow-y-auto p-0_5"
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const layer = rows[item.index]!;
              return (
                <div
                  key={layer.id}
                  className="absolute left-0 w-full"
                  style={{ top: 0, height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                >
                  <LayerRow
                    layer={layer}
                    subtitle={subtitle(layer.id)}
                    isSelected={selectedLayerIds.includes(layer.id)}
                    isActive={layer.id === activeLayerId}
                    isRenaming={layer.id === renamingId}
                    isDragging={layer.id === draggingId}
                    onSelect={(event) => select(layer.id, event)}
                    onDragStart={(event) => startDrag(layer.id, event)}
                    onStartRename={() => setRenamingId(layer.id)}
                    onCommitRename={(name) => commitRename(layer.id, name)}
                    onToggleVisible={() =>
                      mutate((doc) => setLayersVisible(doc, [layer.id], !layer.isVisible))
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <footer className="flex h-control-lg shrink-0 items-center gap-0_5 border-t border-(--color-border) px-1_5">
        <IconButton label="Nouveau calque" onPress={addBlank} disabled={document === null}>
          <Plus size={14} />
        </IconButton>
        <IconButton label="Dupliquer" onPress={duplicateSelected} disabled={!hasSelection}>
          <Copy size={14} />
        </IconButton>
        <div className="flex-1" />
        <IconButton label="Supprimer" onPress={removeSelected} disabled={!hasSelection}>
          <Trash size={14} />
        </IconButton>
      </footer>
    </div>
  );
};

interface IconButtonProps {
  readonly label: string;
  readonly disabled: boolean;
  readonly children: React.ReactNode;
  onPress(): void;
}

const IconButton = ({ label, disabled, children, onPress }: IconButtonProps): React.ReactElement => (
  <button
    type="button"
    aria-label={label}
    disabled={disabled}
    onClick={onPress}
    className="flex h-control w-control items-center justify-center rounded-sm text-(--color-fg-muted) hover:bg-(--color-panel-raised) hover:text-(--color-fg) disabled:opacity-30 disabled:hover:bg-transparent"
  >
    {children}
  </button>
);
