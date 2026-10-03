import { documentStore, historyStore, isEditing, markUnsaved, type CompositorDocument } from '@compositor/model';
import { decodeAutosave, filesFromZip, readProject } from '@compositor/io';
import { decodePNG, installProject } from '../openProject.js';
import { AUTOSAVE_FILE, type AutosaveImage, type AutosaveReply, type AutosaveRequest } from './protocol.js';

/**
 * La sauvegarde automatique — propre au web, l'original n'en a pas.
 *
 * Un onglet fermé, rechargé ou tombé ne perd plus le document : il est écrit
 * dans l'OPFS peu après chaque modification, et rétabli au lancement suivant.
 * C'est un **filet**, pas un enregistrement : Safari efface l'OPFS d'un site
 * resté sans visite, et le document rétabli reste « modifié » s'il l'était.
 *
 * Un seul onglet à la fois tient la sauvegarde, par un verrou Web Locks :
 * deux onglets s'écraseraient l'un l'autre, et rouvriraient le même document.
 */

// En développement : une version neuve de ce module ne pourrait pas prendre le
// verrou, que l'ancienne garde — et l'ancienne continuerait de sauvegarder.
// Recharger toute la page plutôt.
import.meta.hot?.accept(() => window.location.reload());

export const AUTOSAVE_DELAY = 500;
const LOCK = 'compositor-autosave';

let startup: Promise<boolean> | null = null;
let worker: Worker | null = null;
/** Les révisions de pixels que le worker a déjà reçues. */
let sent = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;
let askedPersistence = false;

const supported = (): boolean =>
  typeof Worker !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';

/** Rend `true` si cet onglet tient le verrou ; il le garde jusqu'à sa fermeture. */
const acquireLock = (): Promise<boolean> => {
  if (navigator.locks === undefined) return Promise.resolve(true);
  return new Promise((resolve) => {
    void navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      return lock === null ? undefined : new Promise<never>(() => {});
    });
  });
};

const readSaved = async (): Promise<Uint8Array | null> => {
  try {
    const directory = await navigator.storage.getDirectory();
    const file = await (await directory.getFileHandle(AUTOSAVE_FILE)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
};

const post = (request: AutosaveRequest): void => {
  worker?.postMessage(request);
};

/** Envoie l'état courant ; les pixels déjà reçus par le worker ne repartent pas. */
const flush = (): void => {
  timer = null;
  if (isEditing()) {
    schedule();
    return;
  }
  const { document, activeLayerId, assets } = documentStore.getState();
  if (document === null) {
    sent = new Map();
    post({ type: 'clear' });
    return;
  }
  const images: AutosaveImage[] = [];
  const next = new Map<string, number>();
  for (const layer of document.layers) {
    if (layer.asset === null || next.has(layer.asset)) continue;
    const revision = assets.revision(layer.asset);
    const buffer = assets.get(layer.asset);
    if (buffer === undefined) continue;
    next.set(layer.asset, revision);
    images.push(sent.get(layer.asset) === revision ? { id: layer.asset, revision } : { id: layer.asset, revision, buffer });
  }
  sent = next;
  post({ type: 'save', document, activeLayerId, modified: historyStore.getState().isModified, images });
};

const schedule = (): void => {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(flush, AUTOSAVE_DELAY);
};

const onReply = (reply: AutosaveReply): void => {
  if (reply.type === 'failed') {
    sent = new Map();
    console.warn(`Sauvegarde automatique impossible — ${reply.message}`);
    return;
  }
  if (reply.type === 'saved' && !askedPersistence) {
    // Sans ce statut, le navigateur peut effacer l'OPFS pour faire de la place.
    askedPersistence = true;
    void navigator.storage.persisted?.().then((persisted) => (persisted ? true : navigator.storage.persist?.()));
  }
};

const watch = (): void => {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent<AutosaveReply>) => onReply(event.data));
  worker.addEventListener('error', (event) => console.warn('Sauvegarde automatique indisponible.', event.message));

  let last: { document: CompositorDocument | null; activeLayerId: string | null } = documentStore.getState();
  documentStore.subscribe((state) => {
    if (state.document === last.document && state.activeLayerId === last.activeLayerId) return;
    last = state;
    schedule();
  });
  historyStore.subscribe((state, previous) => {
    if (state.isModified !== previous.isModified) schedule();
  });
  // Un onglet masqué peut être tué sans autre avertissement : écrire tout de suite.
  window.addEventListener('visibilitychange', () => {
    if (window.document.visibilityState === 'hidden' && timer !== null) {
      clearTimeout(timer);
      flush();
    }
  });
  // Un document posé avant la fin du lancement n'a pas encore déclenché d'écriture.
  if (documentStore.getState().document !== null) schedule();
};

/** Rétablit la sauvegarde si la page est encore vide. Rend `true` si un document est revenu. */
const restore = async (maxSide: number): Promise<boolean> => {
  const bytes = await readSaved();
  if (bytes === null) return false;
  const saved = decodeAutosave(bytes);
  const untouched = (): boolean => documentStore.getState().document === null && !historyStore.getState().canUndo;
  if (saved === null || !untouched()) return false;
  try {
    const project = await readProject(filesFromZip(saved.project), decodePNG, maxSide);
    if (!untouched()) return false;
    installProject(project);
    if (saved.header.modified) markUnsaved();
    return true;
  } catch (error) {
    console.warn('La sauvegarde automatique est illisible.', error);
    return false;
  }
};

/**
 * Au lancement, une seule fois : rétablit le document sauvegardé, puis
 * sauvegarde chaque modification. Rend `true` si un document est revenu.
 */
export const startAutosave = (maxSide: number): Promise<boolean> =>
  (startup ??= (async () => {
    if (!supported() || !(await acquireLock())) return false;
    const restored = await restore(maxSide);
    watch();
    return restored;
  })());
