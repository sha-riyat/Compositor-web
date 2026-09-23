import { useEffect } from 'react';
import {
  cycleBlendMode,
  documentStore,
  opacityFromDigit,
  replaceLayer,
  setLayersOpacity,
  uiStore,
  type PendingDigit,
} from '@compositor/model';

/**
 * Les raccourcis d'apparence du calque, repris de l'application macOS :
 *
 * - **chiffres** → opacité des calques sélectionnés, avec l'outil Déplacer ;
 * - **Maj + / Maj −** → mode de fusion suivant ou précédent.
 *
 * Tous deux actifs **où que soit le focus, sauf dans un champ de texte** —
 * exception explicitement testée côté Swift (`BlendShortcutTests`).
 *
 * ## Le clavier français
 *
 * Sur AZERTY, la rangée du haut ne produit **pas** de chiffres sans Maj : la
 * touche marquée « 5 » donne `(`. Lire seulement `event.key` rendrait les
 * raccourcis d'opacité inutilisables sans pavé numérique.
 *
 * C'est donc l'unique endroit où la touche physique (`event.code`) est lue :
 * le chiffre est imprimé sur la touche dans les deux dispositions, et c'est ce
 * que fait Photoshop. Partout ailleurs, la règle reste `event.key`.
 *
 * Pour reculer d'un mode sur AZERTY, il faut le pavé numérique : Maj sur la
 * touche « - » (la touche 6) produit un chiffre et réglerait l'opacité.
 */
export const useAppearanceShortcuts = (): void => {
  useEffect(() => {
    let pending: PendingDigit | null = null;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTextEntry(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const digit = digitOf(event);
      if (digit !== null && uiStore.getState().tool === 'move') {
        const { percent, pending: next } = opacityFromDigit(digit, event.timeStamp, pending);
        pending = next;
        if (percent < 0) return;
        applyOpacity(percent / 100);
        event.preventDefault();
        return;
      }

      const direction = blendDirectionOf(event);
      if (direction !== null) {
        cycleActiveLayer(direction);
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
};

const isTextEntry = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    // Une case à cocher n'est pas un champ de texte : le raccourci doit
    // continuer de marcher quand elle a le focus.
    return !['checkbox', 'radio', 'button', 'range'].includes(target.type);
  }
  return false;
};

/** Le chiffre d'une touche, par la touche physique ou le pavé numérique. */
const digitOf = (event: KeyboardEvent): number | null => {
  const physical = /^(?:Digit|Numpad)(\d)$/.exec(event.code);
  if (physical !== null) return Number(physical[1]);
  if (/^\d$/.test(event.key)) return Number(event.key);
  return null;
};

const blendDirectionOf = (event: KeyboardEvent): boolean | null => {
  if (event.code === 'NumpadAdd') return true;
  if (event.code === 'NumpadSubtract') return false;
  if (!event.shiftKey) return null;
  if (event.key === '+' || event.key === '=') return true;
  if (event.key === '-' || event.key === '_') return false;
  return null;
};

/** Tous les calques sélectionnés d'un coup — une seule modification du document. */
const applyOpacity = (opacity: number): void => {
  const { document, selectedLayerIds } = documentStore.getState();
  if (document === null || selectedLayerIds.length === 0) return;
  const next = setLayersOpacity(document, selectedLayerIds, opacity);
  if (next !== document) documentStore.setState({ document: next });
};

const cycleActiveLayer = (forward: boolean): void => {
  const { document, activeLayerId } = documentStore.getState();
  if (document === null || activeLayerId === null) return;
  const next = replaceLayer(document, activeLayerId, (layer) => ({
    ...layer,
    blendMode: cycleBlendMode(layer.blendMode, forward),
  }));
  if (next !== document) documentStore.setState({ document: next });
};
