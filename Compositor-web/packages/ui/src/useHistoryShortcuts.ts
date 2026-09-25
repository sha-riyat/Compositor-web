import { useEffect } from 'react';
import { redo, undo } from '@compositor/model';
import { isTextEntry } from './keyboard.js';

/**
 * Annuler et rétablir au clavier : Ctrl+Z et Ctrl+Maj+Z, plus Ctrl+Y, la
 * convention de Windows. Cmd remplace Ctrl sur Mac, comme dans l'original.
 *
 * Dans un champ de texte, rien n'est intercepté : l'annulation native du
 * champ reste prioritaire. Pendant un geste — un glissement en cours —,
 * l'historique refuse lui-même d'annuler.
 *
 * Les lettres se lisent sur `event.key` : sur AZERTY, la touche Z est à la
 * place du W, et c'est bien la lettre imprimée qui compte.
 */
export const useHistoryShortcuts = (): void => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTextEntry(event.target)) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
};
