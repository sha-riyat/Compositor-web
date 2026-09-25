import { createStore } from 'zustand/vanilla';
import type { CompositorDocument } from './document.js';
import { DocumentHistory, type HistoryLimits } from './history.js';
import { documentStore, setActiveLayer } from './store.js';

/**
 * L'historique branché sur les stores : **toute** modification du document
 * passe par ici. Une annulation rétablit l'état d'avant la dernière entrée ;
 * une modification qui la contournerait serait effacée en silence.
 *
 * Les noms d'entrée traduisent ceux de l'original (« Layer Opacity »,
 * « Delete Layers »…), pour qu'un menu Édition puisse un jour les afficher.
 */

export interface HistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoName: string;
  readonly redoName: string;
  readonly isModified: boolean;
}

const bytesOf = (id: string): number => documentStore.getState().assets.bytesOf(id);

let history = new DocumentHistory(bytesOf);

const snapshotState = (): HistoryState => ({
  canUndo: history.canUndo,
  canRedo: history.canRedo,
  undoName: history.undoName,
  redoName: history.redoName,
  isModified: history.isModified,
});

/** L'état de l'historique, pour l'interface ; React s'y abonne sans le modifier. */
export const historyStore = createStore<HistoryState>(snapshotState);

const publish = (): void => historyStore.setState(snapshotState());

/**
 * Libère les pixels que plus rien ne référence — ni le document courant, ni un
 * instantané. Jamais pendant une transaction : un actif tout juste ajouté n'est
 * peut-être pas encore posé dans un calque.
 */
const collect = (): void => {
  if (history.isEditing) return;
  const { document, assets } = documentStore.getState();
  const reachable = history.referencedAssets();
  for (const layer of document?.layers ?? []) if (layer.asset !== null) reachable.add(layer.asset);
  assets.sweep(reachable);
};

/** Une transaction est-elle ouverte ? */
export const isEditing = (): boolean => history.isEditing;

export const beginEdit = (name: string): void => {
  const { document, activeLayerId } = documentStore.getState();
  history.begin(name, document, activeLayerId);
};

export const endEdit = (): void => {
  const { document, activeLayerId } = documentStore.getState();
  history.end(document, activeLayerId);
  collect();
  publish();
};

/** Une action nommée, en une seule entrée, quoi qu'elle modifie. */
export const edit = (name: string, action: () => void): void => {
  beginEdit(name);
  try {
    action();
  } finally {
    endEdit();
  }
};

/** Transforme le document courant en une entrée nommée. Sans document, rien. */
export const editDocument = (
  name: string,
  change: (document: CompositorDocument) => CompositorDocument,
): void => {
  const current = documentStore.getState().document;
  if (current === null) return;
  edit(name, () => {
    const next = change(current);
    if (next !== current) documentStore.setState({ document: next });
  });
};

const restore = (snapshot: { document: CompositorDocument | null; activeLayerId: string | null }): void => {
  documentStore.setState({ document: snapshot.document });
  setActiveLayer(
    snapshot.activeLayerId !== null && snapshot.document?.layers.some((l) => l.id === snapshot.activeLayerId) === true
      ? snapshot.activeLayerId
      : null,
  );
};

export const undo = (): boolean => {
  const snapshot = history.undo();
  if (snapshot === null) return false;
  restore(snapshot);
  collect();
  publish();
  return true;
};

export const redo = (): boolean => {
  const snapshot = history.redo();
  if (snapshot === null) return false;
  restore(snapshot);
  collect();
  publish();
  return true;
};

export const markSaved = (): void => {
  history.markSaved();
  publish();
};

/** Un historique vierge — à l'ouverture d'un projet, et entre deux tests. */
export const resetHistory = (limits?: HistoryLimits): void => {
  history = new DocumentHistory(bytesOf, limits);
  collect();
  publish();
};

/** Pour les tests : le nombre d'entrées et le nom de la dernière. */
export const historyDetails = (): { undoCount: number; undoName: string; retainedBytes: number } => ({
  undoCount: history.undoCount,
  undoName: history.undoName,
  retainedBytes: history.retainedBytes(documentStore.getState().document),
});
