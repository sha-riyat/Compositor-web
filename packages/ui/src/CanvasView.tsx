import { useEffect, useRef } from 'react';
import {
  documentStore,
  topmostLayerAt,
  uiStore,
  type CompositorDocument,
  type Point,
  type Tool,
  type ToolApi,
  type ToolEvent,
} from '@compositor/model';
import {
  Compositor,
  createRenderContext,
  resizeToDisplay,
  watchDevicePixelRatio,
} from '@compositor/renderer';
import { TransactionLog } from './history.js';
import { getBlendPreview, subscribeBlendPreview } from './blendPreview.js';

/**
 * Le canevas. **Il n'est jamais rendu par React** : React monte l'élément une
 * fois, puis n'y touche plus. Tout le dessin et toute la saisie passent par le
 * renderer et les stores.
 *
 * C'est l'invariant qui protège la latence du trait : un rendu React par
 * `pointermove` coûterait immédiatement trente images par seconde.
 */

export interface CanvasViewProps {
  readonly tool: Tool;
  onCompositorReady?(compositor: Compositor): void;
}

export const CanvasView = ({ tool, onCompositorReady }: CanvasViewProps): React.ReactElement => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // L'outil change sans que le canevas soit remonté : on le lit via une réf.
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const context = createRenderContext(canvas);
    const assets = documentStore.getState().assets;
    const compositor = new Compositor(context, assets);
    const log = new TransactionLog();
    onCompositorReady?.(compositor);

    let frame = 0;
    let disposed = false;

    const draw = (): void => {
      frame = 0;
      if (disposed) return;
      resizeToDisplay(context);
      const { document, activeLayerId } = documentStore.getState();
      const ui = uiStore.getState();
      compositor.render(
        document,
        ui.viewport,
        { activeLayerId, showsTransformBox: ui.showsTransformBox },
        getBlendPreview(),
      );
    };

    const requestRedraw = (): void => {
      if (frame !== 0 || disposed) return;
      frame = requestAnimationFrame(draw);
    };

    /** Coordonnées client → coordonnées document. */
    const toDocument = (client: Point): Point => {
      const rect = canvas.getBoundingClientRect();
      const { scale, offsetX, offsetY } = uiStore.getState().viewport;
      return {
        x: (client.x - rect.left - offsetX) / scale,
        y: (client.y - rect.top - offsetY) / scale,
      };
    };

    const api: ToolApi = {
      get document(): CompositorDocument | null {
        return documentStore.getState().document;
      },
      get activeLayerId(): string | null {
        return documentStore.getState().activeLayerId;
      },
      beginHistory(name: string): void {
        log.begin(name, documentStore.getState().document);
      },
      mutate(fn): void {
        const current = documentStore.getState().document;
        if (current === null) return;
        const next = fn(current);
        if (next !== current) documentStore.setState({ document: next });
      },
      endHistory(): void {
        log.end(documentStore.getState().document);
      },
      selectLayer(id): void {
        documentStore.setState({ activeLayerId: id });
      },
      requestRedraw,
      toDocument,
    };

    const toolEvent = (event: PointerEvent): ToolEvent => ({
      point: toDocument({ x: event.clientX, y: event.clientY }),
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      // Le « modificateur principal » : Commande sur macOS, Contrôle ailleurs.
      primaryKey: isApple ? event.metaKey : event.ctrlKey,
      button: event.button,
      pressure: event.pressure,
    });

    const updateCursor = (event: PointerEvent): void => {
      const point = toDocument({ x: event.clientX, y: event.clientY });
      const document = documentStore.getState().document;
      const over = document === null ? undefined : topmostLayerAt(document, point);
      canvas.style.cursor = toolRef.current.cursor(
        { point, overLayerId: over?.id ?? null },
        api,
      );
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      toolRef.current.onPointerDown(toolEvent(event), api);
      requestRedraw();
    };

    /**
     * `pointerrawupdate` livre les échantillons sous la trame, et
     * `getCoalescedEvents` rend la cadence complète de la tablette. Sans lui,
     * un périphérique à 240 Hz ne fournit que soixante points par seconde et un
     * trait rapide devient un polygone.
     */
    const onRawUpdate = (event: PointerEvent): void => {
      const samples =
        typeof event.getCoalescedEvents === 'function'
          ? event.getCoalescedEvents()
          : [event];
      const tool = toolRef.current;
      for (const sample of samples) tool.onPointerMove(toolEvent(sample), api);
      requestRedraw();
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!supportsRawUpdate) onRawUpdate(event);
      if (!canvas.hasPointerCapture(event.pointerId)) updateCursor(event);
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      toolRef.current.onPointerUp(toolEvent(event), api);
      requestRedraw();
      updateCursor(event);
    };

    /**
     * Sur macOS, le pincement du trackpad arrive comme une molette avec
     * `ctrlKey`. Sans `preventDefault`, c'est **la page** qui zoome au lieu du
     * canevas — un défaut très courant, et fatal sur un éditeur.
     */
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const { viewport } = uiStore.getState();
      const rect = canvas.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;

      if (event.ctrlKey) {
        const factor = Math.exp(-event.deltaY * 0.01);
        const scale = clamp(viewport.scale * factor, 0.02, 64);
        const ratio = scale / viewport.scale;
        uiStore.setState({
          viewport: {
            scale,
            // Le point sous le curseur reste sous le curseur.
            offsetX: cursorX - (cursorX - viewport.offsetX) * ratio,
            offsetY: cursorY - (cursorY - viewport.offsetY) * ratio,
          },
        });
      } else {
        uiStore.setState({
          viewport: {
            ...viewport,
            offsetX: viewport.offsetX - event.deltaX,
            offsetY: viewport.offsetY - event.deltaY,
          },
        });
      }
      requestRedraw();
    };

    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    if (supportsRawUpdate) {
      canvas.addEventListener('pointerrawupdate', onRawUpdate as EventListener);
    }
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);

    const unsubscribeDocument = documentStore.subscribe(requestRedraw);
    const unsubscribeUI = uiStore.subscribe(requestRedraw);
    const unsubscribePreview = subscribeBlendPreview(requestRedraw);
    const unwatchDpr = watchDevicePixelRatio(requestRedraw);
    const observer = new ResizeObserver(requestRedraw);
    observer.observe(canvas);

    requestRedraw();

    return () => {
      disposed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      observer.disconnect();
      unwatchDpr();
      unsubscribeDocument();
      unsubscribeUI();
      unsubscribePreview();
      canvas.removeEventListener('pointerdown', onPointerDown);
      if (supportsRawUpdate) {
        canvas.removeEventListener('pointerrawupdate', onRawUpdate as EventListener);
      }
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      compositor.dispose();
    };
    // Monté une seule fois : l'outil courant passe par `toolRef`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="h-full w-full" />;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const supportsRawUpdate =
  typeof window !== 'undefined' && 'onpointerrawupdate' in window;

const isApple =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
