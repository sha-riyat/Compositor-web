import { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import { useStore } from 'zustand';
import {
  addLayer,
  createDocument,
  createLayer,
  documentStore,
  edit,
  fitViewport,
  isDocumentOpaque,
  setActiveLayer,
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
import { useHistoryShortcuts } from './useHistoryShortcuts.js';
import { saveProject, useFileShortcuts } from './saveProject.js';
import { filesFromBlob, openProject, projectFromDrop } from './openProject.js';
import type { PackageFiles } from '@compositor/io';
import { createMoveTool } from './tools/moveTool.js';
import { fitToView } from './fitToView.js';

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
  useHistoryShortcuts();
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

      // Une entrée d'annulation ; sur une page vide, elle crée aussi le
      // document, et l'annuler le retire, comme dans l'original.
      edit('Importer une image', () => {
        documentStore.setState({ document: addLayer(current, layer) });
        // Actif et seul sélectionné, comme le setter d'`activeLayerID` de
        // l'original : sans sélection, la ligne ne se surligne pas et les
        // raccourcis d'opacité n'ont rien sur quoi agir.
        setActiveLayer(layer.id);
      });

      if (state.document === null) fitToView(current);
    } catch (error) {
      setMessage(
        error instanceof ImportError ? error.message : "L'import a échoué.",
      );
    }
  }, []);

  const save = useCallback((): void => {
    void saveProject().then((error) => {
      if (error !== null) setMessage(error);
    });
  }, []);
  const picker = useRef<HTMLInputElement>(null);
  const open = useCallback((files: () => Promise<PackageFiles>): void => {
    setMessage(null);
    void openProject(files, compositorRef.current?.maxSide ?? 4096).then((error) => {
      if (error !== null) setMessage(error);
    });
  }, []);
  const choose = useCallback((): void => picker.current?.click(), []);
  useFileShortcuts(save, choose);

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
        // Un projet — zip ou dossier `.comp` — s'ouvre ; une image s'importe.
        const project = projectFromDrop(event.dataTransfer);
        if (project !== null) {
          open(project);
          return;
        }
        const file = firstImageFile(event.dataTransfer);
        if (file !== null) void importFile(file);
      }}
    >
      <header className="flex h-tool-header shrink-0 items-center gap-2 border-b border-(--color-border) bg-(--color-panel) px-2">
        <span className="text-ui-lg font-semibold">Compositor</span>
        <span className="text-ui text-(--color-fg-faint)">T1 — squelette</span>
        <div className="flex-1" />
        <input
          ref={picker}
          type="file"
          accept=".comp,.zip"
          hidden
          aria-label="Choisir un projet à ouvrir"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file !== undefined) open(filesFromBlob(file));
          }}
        />
        <Button
          onPress={choose}
          className="h-control rounded-sm border border-(--color-border) bg-(--color-panel-raised) px-2 text-ui data-hovered:bg-(--color-border)"
        >
          Ouvrir…
        </Button>
        <Button
          isDisabled={document === null}
          onPress={save}
          className="h-control rounded-sm border border-(--color-border) bg-(--color-panel-raised) px-2 text-ui data-hovered:bg-(--color-border) data-disabled:opacity-40"
        >
          Enregistrer
        </Button>
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
                Déposez une image PNG ou un projet .comp pour commencer.
              </p>
            </div>
          )}

          {isDropTarget && (
            <div className="pointer-events-none absolute inset-2 rounded-md border-2 border-dashed border-(--color-accent)" />
          )}
        </main>

        <LayerList />
      </div>

      {/* Une seule ligne, toujours : un message long se tronque — il reste
          lisible en entier au survol — au lieu de faire passer le zoom sur
          deux lignes. */}
      <footer className="flex h-control-lg shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-t border-(--color-border) bg-(--color-panel) px-2 text-ui text-(--color-fg-muted)">
        <span className="numeric shrink-0">{formatZoom(viewport.scale)}</span>
        {document !== null && (
          <span className="numeric shrink-0">
            {formatPixels(document.width)} × {formatPixels(document.height)} px ·{' '}
            {document.resolution} ppp
          </span>
        )}
        <span className="shrink-0">{colourSpaceLabel}</span>
        {message !== null && (
          <span role="status" title={message} className="min-w-0 truncate text-(--color-fg)">
            {message}
          </span>
        )}
        <div className="flex-1" />
        <span className="min-w-0 truncate text-(--color-fg-faint)">{TOOL_HINTS[tool] ?? ''}</span>
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
