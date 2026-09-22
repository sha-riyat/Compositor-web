import { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import { useStore } from 'zustand';
import {
  addLayer,
  createDocument,
  createLayer,
  documentStore,
  identityTransform,
  uiStore,
  type CompositorDocument,
} from '@compositor/model';
import { decodeImageFile, exportDocumentPNG, firstImageFile, ImportError } from '@compositor/io';
import type { Compositor } from '@compositor/renderer';
import { CanvasView } from './CanvasView.js';
import { LayerList } from './LayerList.js';
import { ToolRail } from './ToolRail.js';
import { createMoveTool } from './tools/moveTool.js';

/**
 * La coque de l'éditeur. Elle tient le glisser-déposer, l'export et la barre
 * d'état — le canevas, lui, vit entièrement hors de React.
 */
export const Editor = (): React.ReactElement => {
  const tool = useStore(uiStore, (s) => s.tool);
  const viewport = useStore(uiStore, (s) => s.viewport);
  const document = useStore(documentStore, (s) => s.document);
  const compositorRef = useRef<Compositor | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);

  const moveTool = useMemo(
    () =>
      createMoveTool({
        // Le rayon de préhension est constant à l'écran : il rétrécit en
        // coordonnées document quand on zoome.
        handleTolerance: () => 6 / uiStore.getState().viewport.scale,
        autoSelect: () => uiStore.getState().autoSelect,
        transformBoxVisible: () => uiStore.getState().showsTransformBox,
        lockRatioByDefault: () => true,
      }),
    [],
  );

  const importFile = useCallback(async (file: File): Promise<void> => {
    setMessage(null);
    const maxSide = compositorRef.current?.maxSide ?? 4096;
    try {
      const buffer = await decodeImageFile(file, maxSide);
      const state = documentStore.getState();
      const assetId = state.assets.add(buffer);

      const current: CompositorDocument =
        state.document ??
        createDocument(crypto.randomUUID(), buffer.width, buffer.height);

      const layer = createLayer(
        crypto.randomUUID(),
        file.name.replace(/\.[^.]+$/, ''),
        identityTransform(
          { width: buffer.width, height: buffer.height },
          {
            x: Math.round((current.width - buffer.width) / 2),
            y: Math.round((current.height - buffer.height) / 2),
          },
        ),
        assetId,
      );

      documentStore.setState({
        document: addLayer(current, layer),
        activeLayerId: layer.id,
      });

      if (state.document === null) fitToView(current);
    } catch (error) {
      setMessage(
        error instanceof ImportError ? error.message : "L'import a échoué.",
      );
    }
  }, []);

  const exportPNG = useCallback(async (): Promise<void> => {
    const current = documentStore.getState().document;
    const compositor = compositorRef.current;
    if (current === null || compositor === null) return;
    try {
      const pixels = compositor.composite(current);
      const blob = await exportDocumentPNG(current, pixels);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = 'compositor.png';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage("L'export a échoué.");
    }
  }, []);

  return (
    <div
      className="flex h-full w-full flex-col bg-(--color-canvas) text-(--color-fg)"
      onDragOver={(event) => {
        event.preventDefault();
        setIsDropTarget(true);
      }}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDropTarget(false);
        const file = firstImageFile(event.dataTransfer);
        if (file !== null) void importFile(file);
      }}
    >
      <header className="flex h-tool-header shrink-0 items-center gap-2 border-b border-(--color-border) bg-(--color-panel) px-2">
        <span className="text-ui-lg font-semibold">Compositor</span>
        <span className="text-ui text-(--color-fg-faint)">T1 — squelette</span>
        <div className="flex-1" />
        <Button
          isDisabled={document === null}
          onPress={() => void exportPNG()}
          className="h-control rounded-sm border border-(--color-border) bg-(--color-panel-raised) px-2 text-ui data-hovered:bg-(--color-border) data-disabled:opacity-40"
        >
          Exporter en PNG
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <ToolRail tool={tool} onToolChange={(next) => uiStore.setState({ tool: next })} />

        <main className="relative min-w-0 flex-1">
          <CanvasView
            tool={moveTool}
            onCompositorReady={(compositor) => {
              compositorRef.current = compositor;
            }}
          />

          {document === null && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="text-ui-lg text-(--color-fg-faint)">
                Déposez une image PNG pour commencer.
              </p>
            </div>
          )}

          {isDropTarget && (
            <div className="pointer-events-none absolute inset-2 rounded-md border-2 border-dashed border-(--color-accent)" />
          )}
        </main>

        <LayerList />
      </div>

      <footer className="flex h-control-lg shrink-0 items-center gap-3 border-t border-(--color-border) bg-(--color-panel) px-2 text-ui text-(--color-fg-muted)">
        {document !== null && (
          <span className="numeric">
            {document.width} × {document.height} px · {document.resolution} ppp
          </span>
        )}
        <span className="numeric">{Math.round(viewport.scale * 100)} %</span>
        {message !== null && <span className="text-(--color-fg)">{message}</span>}
      </footer>
    </div>
  );
};

/** Cadre le document dans la vue à l'ouverture, comme le fait le Swift. */
const fitToView = (document: CompositorDocument): void => {
  const canvas = window.document.querySelector('canvas');
  if (canvas === null) return;
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(
    1,
    Math.min(rect.width / document.width, rect.height / document.height) * 0.9,
  );
  uiStore.setState({
    viewport: {
      scale,
      offsetX: (rect.width - document.width * scale) / 2,
      offsetY: (rect.height - document.height * scale) / 2,
    },
  });
};
