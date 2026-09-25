import { useEffect } from 'react';
import { documentStore, markSaved } from '@compositor/model';
import { ProjectError, writeProject } from '@compositor/io';

/**
 * Enregistrer le document en `.comp`, comme « Save » dans l'original.
 *
 * Le navigateur télécharge un fichier : le paquet macOS devient un zip de
 * même contenu (voir `writeProject`). Une fois le fichier remis au navigateur,
 * le document n'est plus « modifié » ; l'export PNG, lui, ne compte pas comme
 * une sauvegarde, comme dans l'original.
 *
 * Rend un message d'erreur à afficher, ou `null`.
 */
export const saveProject = async (): Promise<string | null> => {
  const { document, activeLayerId, assets } = documentStore.getState();
  if (document === null) return null;
  try {
    const bytes = await writeProject(document, activeLayerId, assets);
    // Copie dans un `ArrayBuffer` propre : `Blob` refuse une vue sur un tampon partageable.
    download(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }), 'Sans titre.comp');
    markSaved();
    return null;
  } catch (error) {
    return error instanceof ProjectError ? error.message : "L'enregistrement a échoué.";
  }
};

export const download = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

/**
 * Ctrl+S — Cmd+S sur Mac. Intercepté même dans un champ de texte : sinon le
 * navigateur proposerait d'enregistrer la page web.
 */
export const useSaveShortcut = (onSave: () => void): void => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      onSave();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSave]);
};
