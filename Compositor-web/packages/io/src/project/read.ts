import { unzipSync } from 'fflate';
import type { BlendMode, CompositorDocument, Layer, PixelBuffer, Sampling } from '@compositor/model';
import {
  BLEND_MODE_NAMES,
  PROJECT_FORMAT,
  ProjectError,
  SAMPLING_NAMES,
  SUPPORTED_VERSIONS,
  uuidString,
  validateManifest,
  type Manifest,
  type ManifestLayer,
} from './manifest.js';

/**
 * Lit un `.comp` — `ProjectStore.readPackage` de l'original.
 *
 * Trois formes arrivent : notre zip, le **dossier-paquet** du Mac glissé tel
 * quel, et un paquet **compressé par le Finder**, dont le contenu est dans un
 * sous-dossier `Nom.comp/` accompagné d'un `__MACOSX/` à ignorer. Toutes se
 * ramènent à un ensemble de chemins relatifs à la racine du paquet.
 *
 * Tout est vérifié **avant** de rendre quoi que ce soit : le document ouvert
 * n'est remplacé que par un projet entièrement valide.
 */

/** Un fichier du paquet, lu à la demande. */
export type PackageFile = () => Promise<Uint8Array>;
export type PackageFiles = ReadonlyMap<string, PackageFile>;

export interface OpenedProject {
  readonly document: CompositorDocument;
  readonly activeLayerId: string | null;
  /** Pixels prémultipliés par identifiant de calque. */
  readonly images: ReadonlyMap<string, PixelBuffer>;
}

/** Décode un PNG en pixels prémultipliés — injecté, pour tester sans navigateur. */
export type DecodePNG = (bytes: Uint8Array, maxSide: number) => Promise<PixelBuffer>;

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 512 * 1024 * 1024;
const MAX_PIXELS = 100_000_000;
const MAX_SIDE = 30_000;

const invalid = (why: string): ProjectError =>
  new ProjectError('invalid', `Ce fichier n'est pas un projet Compositor valide, ou ses métadonnées sont abîmées (${why}).`);

/** Un zip, ramené à ses fichiers. */
export const filesFromZip = (bytes: Uint8Array): PackageFiles => {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw invalid('archive illisible');
  }
  return packageRoot(new Map(Object.entries(entries).map(([path, data]) => [path, async () => data])));
};

/**
 * Ramène les chemins à la racine du paquet : là où se trouve `manifest.json`,
 * directement ou dans **un seul** sous-dossier. `__MACOSX/` et les dossiers
 * eux-mêmes sont ignorés.
 */
export const packageRoot = (files: ReadonlyMap<string, PackageFile>): PackageFiles => {
  const useful = [...files.keys()].filter((path) => !path.endsWith('/') && !path.startsWith('__MACOSX/'));
  const manifests = useful.filter((path) => path === 'manifest.json' || /^[^/]+\/manifest\.json$/.test(path));
  if (manifests.length !== 1) throw invalid(manifests.length === 0 ? 'manifest.json introuvable' : 'plusieurs projets');
  const prefix = manifests[0]!.slice(0, -'manifest.json'.length);
  return new Map(
    useful.filter((path) => path.startsWith(prefix)).map((path) => [path.slice(prefix.length), files.get(path)!]),
  );
};

/** Le manifeste : en-tête d'abord, comme `Header` dans l'original, puis tout le reste. */
export const readManifest = async (files: PackageFiles): Promise<Manifest> => {
  const file = files.get('manifest.json');
  if (file === undefined) throw invalid('manifest.json introuvable');
  const bytes = await file();
  if (bytes.byteLength > MAX_MANIFEST_BYTES) throw new ProjectError('tooLarge', 'Les métadonnées du projet dépassent 4 Mio.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw invalid('manifest.json illisible');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalid('manifest.json');
  const header = parsed as { format?: unknown; version?: unknown };
  if (header.format !== PROJECT_FORMAT) throw invalid('format');
  if (typeof header.version !== 'number' || header.version < SUPPORTED_VERSIONS.min || header.version > SUPPORTED_VERSIONS.max) {
    validateManifest(parsed as Manifest); // rend l'erreur de version, avec son numéro
  }
  const manifest = parsed as Manifest;
  validateManifest(manifest);
  refuseUnsupported(manifest);
  return manifest;
};

/**
 * Ce que l'original sait écrire et que le web ne sait pas encore afficher.
 * Plutôt qu'ouvrir un document amputé — qui perdrait ces éléments au premier
 * enregistrement —, on refuse en disant pourquoi.
 */
const refuseUnsupported = (manifest: Manifest): void => {
  const found = new Set<string>();
  for (const layer of manifest.layers) {
    if (layer.maskFile !== undefined || layer.maskSourceID !== undefined) found.add('des masques');
    if (layer.adjustment !== undefined) found.add('des calques de réglage');
    if (layer.effects !== undefined) found.add('des effets de calque');
    if (layer.text !== undefined) found.add('du texte modifiable');
    if (layer.shape !== undefined) found.add('des formes');
  }
  if ((manifest.guides?.length ?? 0) > 0) found.add('des repères');
  if (found.size > 0) {
    throw new ProjectError(
      'unsupported',
      `Ce projet contient ${[...found].join(', ')}, que cette version web ne gère pas encore. Il n'a pas été ouvert, pour ne rien perdre.`,
    );
  }
};

const blendModeOf = (name: string | undefined): BlendMode =>
  (Object.entries(BLEND_MODE_NAMES).find(([, value]) => value === (name ?? 'Normal'))?.[0] ?? 'normal') as BlendMode;

const samplingOf = (name: string): Sampling =>
  (Object.entries(SAMPLING_NAMES).find(([, value]) => value === name)?.[0] ?? 'high') as Sampling;

/** Profondeur par canal d'un PNG, lue dans l'en-tête IHDR. `null` si ce n'est pas un PNG. */
const pngBitDepth = (bytes: Uint8Array): number | null => {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < 29 || signature.some((b, i) => bytes[i] !== b)) return null;
  return bytes[24]!;
};

export const readProject = async (files: PackageFiles, decode: DecodePNG, maxSide: number): Promise<OpenedProject> => {
  const manifest = await readManifest(files);
  const images = new Map<string, PixelBuffer>();
  let pixels = 0;

  for (const record of manifest.layers) {
    if (record.imageFile === undefined) continue;
    const file = files.get(`images/${record.imageFile}`);
    const missing = () =>
      new ProjectError('missingImage', "Une image du projet est manquante ou abîmée. Le document ouvert n'a pas été remplacé.");
    if (file === undefined) throw missing();
    const bytes = await file();
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ProjectError('tooLarge', 'Une image du projet dépasse 512 Mio.');
    const depth = pngBitDepth(bytes);
    if (depth === null || depth > 8) throw missing();
    let buffer: PixelBuffer;
    try {
      buffer = await decode(bytes, Math.min(maxSide, MAX_SIDE));
    } catch (error) {
      throw error instanceof ProjectError ? error : missing();
    }
    pixels += buffer.width * buffer.height;
    if (pixels > MAX_PIXELS) throw new ProjectError('tooLarge', 'Les images de ce projet dépassent 100 mégapixels au total.');
    images.set(uuidString(record.id), buffer);
  }

  const layers: Layer[] = manifest.layers.map((record: ManifestLayer) => {
    const id = uuidString(record.id);
    const [x, y] = record.transform.origin;
    const [width, height] = record.transform.size;
    return {
      id,
      name: record.name,
      // L'identifiant d'actif est attribué à l'installation, pas ici.
      asset: record.imageFile === undefined ? null : id,
      isVisible: record.isVisible,
      parentId: record.parentID === undefined ? null : uuidString(record.parentID),
      isGroup: record.isGroup === true,
      opacity: record.opacity ?? 1,
      blendMode: blendModeOf(record.blendMode),
      transform: {
        origin: { x, y },
        size: { width, height },
        radians: (record.transform.rotation * Math.PI) / 180,
        flipX: record.transform.flipX,
        flipY: record.transform.flipY,
        sampling: samplingOf(record.transform.sampling),
      },
    };
  });

  return {
    document: {
      id: uuidString(manifest.documentID),
      width: manifest.width,
      height: manifest.height,
      resolution: manifest.resolution ?? 72,
      layers,
    },
    activeLayerId: manifest.activeLayerID === undefined ? null : uuidString(manifest.activeLayerID),
    images,
  };
};
