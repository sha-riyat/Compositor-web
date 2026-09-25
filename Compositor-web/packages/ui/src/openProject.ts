import {
  documentStore,
  historyStore,
  resetHistory,
  setActiveLayer,
  type PixelBuffer,
} from '@compositor/model';
import {
  decodeImageFile,
  filesFromZip,
  packageRoot,
  ProjectError,
  readProject,
  type PackageFile,
  type PackageFiles,
} from '@compositor/io';
import { fitToView } from './fitToView.js';

/**
 * Ouvrir un `.comp` — « Open » dans l'original, puis `installProject`.
 *
 * Le document ouvert n'est remplacé qu'une fois le projet **entièrement**
 * lu et validé ; l'historique repart vierge, le calque actif est restauré,
 * la vue est cadrée.
 */

/** Un fichier est-il un projet plutôt qu'une image ? */
export const isProjectFile = (file: File): boolean => /\.(comp|zip)$/i.test(file.name);

const decodePNG = async (bytes: Uint8Array, maxSide: number): Promise<PixelBuffer> => {
  try {
    return await decodeImageFile(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }), maxSide);
  } catch (error) {
    throw new ProjectError('missingImage', error instanceof Error ? error.message : 'Une image du projet est illisible.');
  }
};

/** Rend un message d'erreur à afficher, ou `null` si le projet est ouvert. */
export const openProject = async (files: () => Promise<PackageFiles>, maxSide: number): Promise<string | null> => {
  // Remplacer un document modifié perdrait ce qui n'est pas enregistré.
  if (historyStore.getState().isModified && documentStore.getState().document !== null) {
    const proceed = window.confirm("Le document ouvert a des modifications non enregistrées. L'abandonner et ouvrir ce projet ?");
    if (!proceed) return null;
  }
  try {
    const project = await readProject(await files(), decodePNG, maxSide);
    const { assets } = documentStore.getState();
    const assetIds = new Map([...project.images].map(([layerId, buffer]) => [layerId, assets.add(buffer)]));
    const document = {
      ...project.document,
      layers: project.document.layers.map((layer) => ({
        ...layer,
        asset: layer.asset === null ? null : (assetIds.get(layer.id) ?? null),
      })),
    };
    documentStore.setState({ document });
    setActiveLayer(project.activeLayerId);
    // Un projet ouvert part d'un historique vierge et n'est pas « modifié ».
    resetHistory();
    fitToView(document);
    return null;
  } catch (error) {
    return error instanceof ProjectError ? error.message : "Ce projet n'a pas pu être ouvert.";
  }
};

export const filesFromBlob = (file: Blob): (() => Promise<PackageFiles>) => async () =>
  filesFromZip(new Uint8Array(await file.arrayBuffer()));

/**
 * Un dossier-paquet glissé tel quel depuis le Finder. Les entrées doivent être
 * prises **pendant** l'événement de dépôt : le `DataTransfer` est vidé ensuite.
 */
export const filesFromDirectory = (root: FileSystemDirectoryEntry): (() => Promise<PackageFiles>) => async () => {
  const files = new Map<string, PackageFile>();
  const readAll = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => {
      const all: FileSystemEntry[] = [];
      const next = () =>
        reader.readEntries((batch) => {
          if (batch.length === 0) resolve(all);
          else {
            all.push(...batch);
            next();
          }
        }, reject);
      next();
    });
  const walk = async (directory: FileSystemDirectoryEntry, prefix: string): Promise<void> => {
    for (const entry of await readAll(directory.createReader())) {
      if (entry.isDirectory) await walk(entry as FileSystemDirectoryEntry, `${prefix}${entry.name}/`);
      else {
        const fileEntry = entry as FileSystemFileEntry;
        files.set(`${prefix}${entry.name}`, async () => {
          const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
          return new Uint8Array(await file.arrayBuffer());
        });
      }
    }
  };
  await walk(root, '');
  return packageRoot(files);
};

/**
 * Ce qu'un dépôt apporte : un projet (zip ou dossier `.comp`), sinon rien —
 * les images restent l'affaire de l'import.
 */
export const projectFromDrop = (transfer: DataTransfer | null): (() => Promise<PackageFiles>) | null => {
  if (transfer === null) return null;
  for (const item of Array.from(transfer.items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory === true) return filesFromDirectory(entry as FileSystemDirectoryEntry);
    const file = item.getAsFile();
    if (file !== null && isProjectFile(file)) return filesFromBlob(file);
  }
  return null;
};
