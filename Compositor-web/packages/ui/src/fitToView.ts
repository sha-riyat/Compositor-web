import { fitViewport, uiStore, type CompositorDocument } from '@compositor/model';

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
export const fitToView = (document: CompositorDocument): void => {
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
