import type { CompositorDocument, LayerId, PixelBuffer } from '@compositor/model';
import { encodeAsset, encodeAutosave, packProject, type EncodedImage } from '@compositor/io';
import { AUTOSAVE_FILE, type AutosaveReply, type AutosaveRequest } from './protocol.js';

/**
 * Le worker de la sauvegarde automatique : il encode les PNG, assemble le
 * paquet et l'écrit dans l'OPFS, hors du fil principal.
 *
 * L'écriture passe par `createSyncAccessHandle`, la seule disponible dans
 * Safari avant la version 26 — `createWritable` n'y existe pas.
 *
 * Les PNG encodés sont gardés d'un passage à l'autre, par actif et révision :
 * déplacer un calque ne réencode rien. Pendant une écriture, seule la
 * dernière demande compte ; les pixels reçus entre-temps sont gardés.
 */

interface SyncAccessHandle {
  truncate(size: number): void;
  write(buffer: Uint8Array, options: { at: number }): number;
  flush(): void;
  close(): void;
}

type FileHandle = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccessHandle> };

const encoded = new Map<string, { revision: number; image: EncodedImage }>();
const received = new Map<string, { revision: number; buffer: PixelBuffer }>();
let latest: AutosaveRequest | null = null;
let running = false;

const reply = (message: AutosaveReply): void => globalThis.postMessage(message);

const write = async (bytes: Uint8Array): Promise<void> => {
  const directory = await navigator.storage.getDirectory();
  const file = (await directory.getFileHandle(AUTOSAVE_FILE, { create: true })) as FileHandle;
  const access = await file.createSyncAccessHandle();
  try {
    access.truncate(0);
    access.write(bytes, { at: 0 });
    access.flush();
  } finally {
    access.close();
  }
};

const remove = async (): Promise<void> => {
  const directory = await navigator.storage.getDirectory();
  try {
    await directory.removeEntry(AUTOSAVE_FILE);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
};

const save = async (
  document: CompositorDocument,
  activeLayerId: LayerId | null,
  modified: boolean,
  images: readonly { id: string; revision: number }[],
): Promise<number> => {
  const wanted = new Map(images.map((image) => [image.id, image.revision]));
  for (const id of [...encoded.keys()]) if (wanted.get(id) !== encoded.get(id)!.revision) encoded.delete(id);
  for (const [id, revision] of wanted) {
    if (encoded.has(id)) continue;
    const source = received.get(id);
    if (source === undefined || source.revision !== revision) throw new Error(`Pixels manquants pour ${id}`);
    encoded.set(id, { revision, image: encodeAsset(source.buffer) });
    received.delete(id);
  }
  for (const id of [...received.keys()]) if (!wanted.has(id)) received.delete(id);
  const bytes = encodeAutosave({ modified, savedAt: Date.now() }, packProject(document, activeLayerId, (id) => encoded.get(id)?.image));
  await write(bytes);
  return bytes.byteLength;
};

const run = async (): Promise<void> => {
  running = true;
  while (latest !== null) {
    const request = latest;
    latest = null;
    try {
      if (request.type === 'clear') {
        encoded.clear();
        received.clear();
        await remove();
        reply({ type: 'cleared' });
      } else {
        const bytes = await save(request.document, request.activeLayerId, request.modified, request.images);
        reply({ type: 'saved', bytes });
      }
    } catch (error) {
      // Le fil principal renverra tous les pixels à la prochaine demande.
      encoded.clear();
      received.clear();
      reply({ type: 'failed', message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
    }
  }
  running = false;
};

globalThis.addEventListener('message', (event: MessageEvent<AutosaveRequest>) => {
  const request = event.data;
  if (request.type === 'save') {
    for (const image of request.images) {
      if (image.buffer !== undefined) received.set(image.id, { revision: image.revision, buffer: image.buffer });
    }
  }
  latest = request;
  if (!running) void run();
});
