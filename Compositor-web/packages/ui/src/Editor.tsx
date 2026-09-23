import { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import { useStore } from 'zustand';
import {
  addLayer,
  createDocument,
  createLayer,
  documentStore,
  fitViewport,
  isDocumentOpaque,
  identityTransform,
  uiStore,
  type CompositorDocument,
  type ToolId,
} from '@compositor/model';
import { decodeImageFile, exportDocumentPNG, firstImageFile, ImportError } from '@compositor/io';
import type { Compositor } from '@compositor/renderer';
import { CanvasView } from './CanvasView.js';
import { LayerList } from './LayerList.js';
import { ToolRail } from './ToolRail.js';
import { ToolHeader } from './ToolHeader.js';
import { useAppearanceShortcuts } from './useAppearanceShortcuts.js';
import { createMoveTool } from './tools/moveTool.js';

/**
 * L'aide contextuelle de la barre d'état, reprise de l'application macOS : elle
 * rappelle en permanence ce que l'outil courant sait faire, plutôt que de
 * l'enfouir dans une documentation. Elle change avec l'outil.
 */
const TOOL_HINTS: Partial<Record<ToolId, string>> = {
  move:
    'Glisser pour déplacer · Poignée pour redimensionner · 1–0 opacité · Maj +/− mode · Molette pour déplacer la vue · Ctrl-molette pour zoomer',
  idle: 'Aucun outil actif',
};

/**
 * La coque de l'éditeur. Elle tient le glisser-déposer, l'export et la barre
 * d'état — le canevas, lui, vit entièrement hors de React.
 */
export const Editor = (): React.ReactElement => {
  const tool = useStore(uiStore, (s) => s.tool);
  const viewport = useStore(uiStore, (s) => s.viewport);
  const document = useStore(documentStore, (s) => s.document);
  const compositorRef = useRef<Compositor | null>(null);
  useAppearanceShortcuts();
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
        lockRatioByDefault: () => uiStore.getState().locksTransformRatio,
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

  const colourSpaceLabel =
    document === null || isDocumentOpaque(document, documentStore.getState().assets)
      ? 'sRGB'
      : 'sRGB · Transparent';

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

      <ToolHeader />

      <div className="flex min-h-0 flex-1">
        <ToolRail tool={tool} onToolChange={(next) => uiStore.setState({ tool: next })} />

        <main className="relative min-w-0 flex-1">
          <CanvasView
            tool={moveTool}
            onCompositorReady={(compositor) => {
              compositorRef.current = compositor;
              // En développement seulement : la suite Playwright compose par
              // cette référence, sans dépendre d'une trame d'animation — un
              // onglet masqué n'en reçoit pas.
              if (import.meta.env.DEV) {
                const globals = window as unknown as { __compositor?: Record<string, unknown> };
                globals.__compositor = { ...globals.__compositor, compositor };
              }
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
        <span className="numeric">{formatZoom(viewport.scale)}</span>
        {document !== null && (
          <span className="numeric">
            {formatPixels(document.width)} × {formatPixels(document.height)} px ·{' '}
            {document.resolution} ppp
          </span>
        )}
        <span>{colourSpaceLabel}</span>
        {message !== null && <span className="text-(--color-fg)">{message}</span>}
        <div className="flex-1" />
        <span className="truncate text-(--color-fg-faint)">{TOOL_HINTS[tool] ?? ''}</span>
      </footer>
    </div>
  );
};

/** Une décimale au plus, sans zéro inutile — `133,5 %`, `100 %`. */
const formatZoom = (scale: number): string => {
  const percent = scale * 100;
  const rounded = Math.round(percent * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1).replace('.', ',')} %`;
};

/** Séparateur de milliers, comme dans la barre d'état de l'original. */
const formatPixels = (value: number): string => value.toLocaleString('fr-FR');

/**
 * Cadre le document dans la vue à l'ouverture, comme le fait le Swift.
 *
 * Vise le canevas du document **par son rôle** plutôt que « le premier
 * `canvas` de la page » : cette désignation cesse d'être sûre dès qu'un autre
 * canevas apparaît dans l'interface.
 *
 * Si la vue n'a pas encore de taille — import avant la mise en page, fenêtre
 * réduite —, le cadrage attend la première taille réelle au lieu de calculer
 * une échelle nulle.
 */
const fitToView = (document: CompositorDocument): void => {
  const canvas = window.document.querySelector<HTMLCanvasElement>('canvas[data-role="document"]');
  if (canvas === null) return;

  const apply = (width: number, height: number): boolean => {
    const viewport = fitViewport(document.width, document.height, width, height);
    if (viewport === null) return false;
    uiStore.setState({ viewport });
    return true;
  };

  const rect = canvas.getBoundingClientRect();
  if (apply(rect.width, rect.height)) return;

  const observer = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect;
    if (box !== undefined && apply(box.width, box.height)) observer.disconnect();
  });
  observer.observe(canvas);
};
