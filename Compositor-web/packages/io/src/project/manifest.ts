import type { BlendMode, Sampling } from '@compositor/model';

/**
 * Le manifeste d'un `.comp`, tel que l'écrit et le lit l'application macOS
 * (`ProjectManifest`, `ProjectLayerRecord` dans `Compositor/IO/ProjectStore.swift`).
 *
 * Le décodage Swift est généré : **toutes les clés non optionnelles sont
 * obligatoires**, même celles qui ont une valeur par défaut. `CGPoint` et
 * `CGSize` s'encodent en tableaux, et la rotation est en **degrés**.
 */

export const PROJECT_FORMAT = 'com.compositor.project';
/** `ProjectManifest.current` : ce que les sauvegardes écrivent. */
export const CURRENT_VERSION = 9;
/** `ProjectManifest.supported` : ce que la lecture accepte. */
export const SUPPORTED_VERSIONS = { min: 1, max: CURRENT_VERSION } as const;

export interface ManifestTransform {
  readonly origin: readonly [number, number];
  readonly size: readonly [number, number];
  /** En degrés, sens horaire. */
  readonly rotation: number;
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly sampling: string;
}

export interface ManifestLayer {
  readonly id: string;
  readonly name: string;
  readonly isVisible: boolean;
  readonly transform: ManifestTransform;
  readonly imageFile?: string;
  readonly parentID?: string;
  readonly isGroup?: boolean;
  readonly opacity?: number;
  readonly blendMode?: string;
  // Présents dans l'original, pas encore gérés ici : masques, réglages,
  // effets, texte, formes. Leur présence est un cas de lecture (SHA-86).
  readonly [unhandled: string]: unknown;
}

export interface Manifest {
  readonly format: string;
  readonly version: number;
  readonly colorSpace: string;
  readonly resolution?: number;
  readonly documentID: string;
  readonly width: number;
  readonly height: number;
  readonly activeLayerID?: string;
  readonly layers: readonly ManifestLayer[];
  readonly guides?: readonly unknown[];
}

/** Les noms des modes, `LayerBlendMode.rawValue`. */
export const BLEND_MODE_NAMES: Record<BlendMode, string> = {
  normal: 'Normal',
  darken: 'Darken',
  multiply: 'Multiply',
  colorBurn: 'Color Burn',
  linearBurn: 'Linear Burn',
  lighten: 'Lighten',
  screen: 'Screen',
  colorDodge: 'Color Dodge',
  linearDodge: 'Linear Dodge (Add)',
  overlay: 'Overlay',
  softLight: 'Soft Light',
  hardLight: 'Hard Light',
  vividLight: 'Vivid Light',
  linearLight: 'Linear Light',
  pinLight: 'Pin Light',
  hardMix: 'Hard Mix',
  difference: 'Difference',
  exclusion: 'Exclusion',
  subtract: 'Subtract',
  divide: 'Divide',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

/** `LayerSampling.rawValue` ; notre `linear` est leur `Smooth`. */
export const SAMPLING_NAMES: Record<Sampling, string> = {
  nearest: 'Nearest',
  linear: 'Smooth',
  high: 'High quality',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUUID = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** Comme `UUID.uuidString` : toujours en majuscules. */
export const uuidString = (id: string): string => id.toUpperCase();

/** Pourquoi un projet est refusé — les cas de `ProjectError`. */
export type ProjectErrorKind = 'invalid' | 'version' | 'missingImage' | 'tooLarge' | 'encode' | 'unsupported';

export class ProjectError extends Error {
  readonly kind: ProjectErrorKind;
  constructor(kind: ProjectErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const invalid = (why: string): ProjectError =>
  new ProjectError('invalid', `Ce fichier n'est pas un projet Compositor valide, ou ses métadonnées sont abîmées (${why}).`);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** `LayerTransform.isValid`, plus la forme exacte de l'encodage. */
const validTransform = (t: unknown): boolean => {
  if (typeof t !== 'object' || t === null) return false;
  const { origin, size, rotation, flipX, flipY, sampling } = t as Record<string, unknown>;
  if (!Array.isArray(origin) || origin.length !== 2 || !Array.isArray(size) || size.length !== 2) return false;
  const [x, y] = origin as unknown[];
  const [w, h] = size as unknown[];
  return (
    finite(x) && finite(y) && finite(w) && finite(h) && finite(rotation) &&
    w >= 1 && w <= 300_000 && h >= 1 && h <= 300_000 &&
    Math.abs(x) <= 1_000_000 && Math.abs(y) <= 1_000_000 &&
    typeof flipX === 'boolean' && typeof flipY === 'boolean' &&
    Object.values(SAMPLING_NAMES).includes(sampling as string)
  );
};

/**
 * `ProjectStore.validate`, règle par règle. À appeler **avant** de toucher au
 * document ouvert, et avant d'écrire : un projet que l'original refuserait ne
 * doit pas sortir d'ici.
 */
export const validateManifest = (manifest: Manifest): void => {
  if (manifest.format !== PROJECT_FORMAT) throw invalid('format');
  const { version } = manifest;
  if (!Number.isInteger(version) || version < SUPPORTED_VERSIONS.min || version > SUPPORTED_VERSIONS.max) {
    throw new ProjectError(
      'version',
      `Ce projet utilise la version ${version} du format. Cette application lit les versions ${SUPPORTED_VERSIONS.min} à ${SUPPORTED_VERSIONS.max}.`,
    );
  }
  if (manifest.colorSpace !== 'sRGB') throw invalid('espace colorimétrique');
  if (manifest.resolution !== undefined && !(finite(manifest.resolution) && manifest.resolution >= 1 && manifest.resolution <= 9600)) {
    throw invalid('résolution');
  }
  if (!isUUID(manifest.documentID)) throw invalid('identifiant du document');
  const sideOk = (v: number) => Number.isInteger(v) && v >= 1 && v <= 30_000;
  if (!sideOk(manifest.width) || !sideOk(manifest.height) || !Array.isArray(manifest.layers) || manifest.layers.length > 10_000) {
    throw new ProjectError('tooLarge', 'Ce projet dépasse les limites de canevas ou de nombre de calques.');
  }

  const ids = new Set<string>();
  const byId = new Map<string, ManifestLayer>();
  for (const layer of manifest.layers) {
    if (!isUUID(layer.id)) throw invalid('identifiant de calque');
    const id = uuidString(layer.id);
    if (ids.has(id)) throw invalid('identifiant en double');
    ids.add(id);
    byId.set(id, layer);
    if (typeof layer.name !== 'string' || layer.name.trim() === '' || new TextEncoder().encode(layer.name).length > 16_384) {
      throw invalid('nom de calque');
    }
    if (typeof layer.isVisible !== 'boolean' || !validTransform(layer.transform)) throw invalid('calque');
    if (layer.imageFile !== undefined && layer.imageFile !== `${id}.png`) throw invalid("nom d'image");
    const opacity = layer.opacity ?? 1;
    const blend = layer.blendMode ?? 'Normal';
    if (!finite(opacity) || opacity < 0 || opacity > 1) throw invalid('opacité');
    if (!Object.values(BLEND_MODE_NAMES).includes(blend)) throw invalid('mode de fusion');
    if (version < 3 && (opacity !== 1 || blend !== 'Normal')) throw invalid('apparence avant la version 3');
    if (layer.isGroup === true) {
      if (layer.imageFile !== undefined) throw invalid('dossier avec une image');
      if (blend !== 'Normal' || (version < 8 && opacity !== 1)) throw invalid('apparence de dossier');
    }
    if (version === 1 && (layer.parentID !== undefined || layer.isGroup === true)) throw invalid('dossier en version 1');
  }

  // `LayerHierarchy.validate` : parents existants, dossiers, sans cycle, 64 niveaux.
  for (const layer of manifest.layers) {
    const seen = new Set([uuidString(layer.id)]);
    let parent = layer.parentID;
    while (parent !== undefined) {
      if (!isUUID(parent)) throw invalid('parent');
      const id = uuidString(parent);
      const node = byId.get(id);
      if (seen.size > 64 || seen.has(id) || node === undefined || node.isGroup !== true) throw invalid('hiérarchie');
      seen.add(id);
      parent = node.parentID;
    }
  }

  if (manifest.activeLayerID !== undefined && !(isUUID(manifest.activeLayerID) && ids.has(uuidString(manifest.activeLayerID)))) {
    throw invalid('calque actif');
  }
  if (manifest.guides !== undefined && (version < 8 ? manifest.guides.length > 0 : manifest.guides.length > 1_000)) {
    throw invalid('repères');
  }
};
