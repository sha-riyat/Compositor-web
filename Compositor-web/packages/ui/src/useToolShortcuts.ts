import { useEffect } from 'react';
import { setTool, type ToolId } from '@compositor/model';
import { isTextEntry } from './keyboard.js';

/**
 * Les lettres des outils, comme dans l'original : V pour Déplacer, B pour la
 * Brosse. Sans modificateur, et jamais dans un champ de texte.
 *
 * `event.key` et non `event.code` : c'est la lettre imprimée sur la touche
 * qui compte, sur AZERTY comme sur QWERTY.
 */
const TOOL_KEYS: Readonly<Record<string, ToolId>> = { v: 'move', b: 'brush' };

export const useToolShortcuts = (): void => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTextEntry(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const tool = TOOL_KEYS[event.key.toLowerCase()];
      if (tool === undefined) return;
      event.preventDefault();
      setTool(tool);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
};
