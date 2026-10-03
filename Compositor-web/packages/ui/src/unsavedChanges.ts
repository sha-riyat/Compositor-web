import { useEffect } from 'react';
import { useStore } from 'zustand';
import { documentStore, historyStore } from '@compositor/model';

/**
 * Les modifications non enregistrées se voient, comme dans l'original : un
 * point devant le titre de l'onglet (`ProjectTabs.swift`) et, à la place du
 * point du bouton de fermeture macOS (`isDocumentEdited`), une puce dans le
 * titre de la page.
 *
 * Quitter la page avec un document modifié demande confirmation : la
 * sauvegarde automatique n'est qu'un filet, que Safari peut effacer.
 */

export const DOCUMENT_TITLE = 'Sans titre';

/** Le document ouvert a-t-il des modifications non enregistrées ? */
export const useHasUnsavedChanges = (): boolean => {
  const modified = useStore(historyStore, (s) => s.isModified);
  const hasDocument = useStore(documentStore, (s) => s.document !== null);
  return modified && hasDocument;
};

export const useUnsavedChangesGuard = (): void => {
  const unsaved = useHasUnsavedChanges();
  const hasDocument = useStore(documentStore, (s) => s.document !== null);

  useEffect(() => {
    window.document.title = hasDocument ? `${unsaved ? '• ' : ''}${DOCUMENT_TITLE} — Compositor` : 'Compositor';
  }, [unsaved, hasDocument]);

  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Les navigateurs plus anciens attendent une valeur de retour.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved]);
};
