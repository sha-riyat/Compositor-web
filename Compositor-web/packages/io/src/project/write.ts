import { strToU8, zipSync, type Zippable } from 'fflate';
import type { AssetStore, CompositorDocument, LayerId } from '@compositor/model';
import { encodePNG } from '../export.js';
import {
  BLEND_MODE_NAMES,
  CURRENT_VERSION,
  PROJECT_FORMAT,
  ProjectError,
  SAMPLING_NAMES,
  isUUID,
  uuidString,
  validateManifest,
  type Manifest,
  type ManifestLayer,
} from './manifest.js';

/**
 * Écrit un `.comp` — `ProjectStore.save` de l'original.
 *
 * Sur macOS, un `.comp` est un **paquet** : un dossier. Un navigateur ne
 * télécharge qu'un fichier ; on écrit donc un zip dont la racine est le
 * contenu du paquet, `manifest.json` et `images/`. Les PNG, déjà compressés,
 * sont stockés sans recompression.
 */

const MAX_SIDE = 30_000;
const MAX_PIXELS = 100_000_000;
const MAX_IMAGE_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

/**
 * Nos identifiants deviennent des UUID en majuscules, comme `uuidString` :
 * le nom d'image doit valoir exactement `<UUID>.png`. Un identifiant qui n'est
 * pas un UUID — ceux des tests — en reçoit un, stable pour cette sauvegarde.
 */
const identifiers = (): ((id: string) => string) => {
  const assigned = new Map<string, string>();
  return (id) => {
    if (isUUID(id)) return uuidString(id);
    let value = assigned.get(id);
    if (value === undefined) {
      value = uuidString(crypto.randomUUID());
      assigned.set(id, value);
    }
    return value;
  };
};

/** Radians vers degrés, sans la poussière flottante d'un aller-retour. */
const degrees = (radians: number): number => {
  const value = (radians * 180) / Math.PI;
  const whole = Math.round(value);
  return Math.abs(value - whole) < 1e-9 ? whole : value;
};

export const buildManifest = (
  document: CompositorDocument,
  activeLayerId: LayerId | null,
  toId: (id: string) => string = identifiers(),
): Manifest => {
  const layers: ManifestLayer[] = document.layers.map((layer) => {
    const id = toId(layer.id);
    const { origin, size, radians, flipX, flipY, sampling } = layer.transform;
    return {
      id,
      name: layer.name,
      isVisible: layer.isVisible,
      transform: {
        origin: [origin.x, origin.y],
        size: [size.width, size.height],
        rotation: degrees(radians),
        flipX,
        flipY,
        sampling: SAMPLING_NAMES[sampling],
      },
      ...(layer.asset === null ? {} : { imageFile: `${id}.png` }),
      ...(layer.parentId === null ? {} : { parentID: toId(layer.parentId) }),
      // Comme `projectSnapshot` : toujours écrits.
      isGroup: layer.isGroup,
      opacity: layer.opacity,
      blendMode: BLEND_MODE_NAMES[layer.blendMode],
    };
  });
  return {
    format: PROJECT_FORMAT,
    version: CURRENT_VERSION,
    colorSpace: 'sRGB',
    resolution: document.resolution,
    documentID: toId(document.id),
    width: document.width,
    height: document.height,
    ...(activeLayerId === null ? {} : { activeLayerID: toId(activeLayerId) }),
    layers,
  };
};

/** JSON à clés triées, comme `JSONEncoder` avec `.sortedKeys` et `.prettyPrinted`. */
export const encodeManifest = (manifest: Manifest): Uint8Array => {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted((value as Record<string, unknown>)[key])]));
    }
    return value;
  };
  return strToU8(JSON.stringify(sorted(manifest), null, 2));
};

export const writeProject = async (
  document: CompositorDocument,
  activeLayerId: LayerId | null,
  assets: AssetStore,
): Promise<Uint8Array> => {
  const toId = identifiers();
  const manifest = buildManifest(document, activeLayerId, toId);
  validateManifest(manifest);

  const images: Zippable = {};
  let pixels = 0;
  for (const layer of document.layers) {
    if (layer.asset === null) continue;
    const buffer = assets.get(layer.asset);
    if (buffer === undefined) {
      throw new ProjectError('missingImage', "Une image du document est introuvable. Le projet n'a pas été enregistré.");
    }
    pixels += buffer.width * buffer.height;
    if (buffer.width > MAX_SIDE || buffer.height > MAX_SIDE || pixels > MAX_PIXELS) {
      throw new ProjectError('tooLarge', 'Ce projet dépasse la limite de 100 mégapixels ou de 30 000 px par côté.');
    }
    // `encodePNG` attend des octets prémultipliés et écrit de l'alpha droit ;
    // il travaille sur une copie.
    const blob = await encodePNG(new Uint8ClampedArray(buffer.data), buffer.width, buffer.height);
    const png = new Uint8Array(await blob.arrayBuffer());
    if (png.byteLength > MAX_IMAGE_BYTES) {
      throw new ProjectError('tooLarge', 'Une image dépasse 512 Mio une fois encodée.');
    }
    images[`${toId(layer.id)}.png`] = [png, { level: 0 }];
  }

  const metadata = encodeManifest(manifest);
  if (metadata.byteLength > MAX_MANIFEST_BYTES) {
    throw new ProjectError('tooLarge', 'Les métadonnées du projet dépassent 4 Mio.');
  }
  return zipSync({ 'manifest.json': [metadata, { level: 6 }], images });
};
