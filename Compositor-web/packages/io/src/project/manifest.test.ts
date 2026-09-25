import { describe, expect, test } from 'vitest';
import { addLayer, createDocument, createLayer, identityTransform, type CompositorDocument } from '@compositor/model';
import { BLEND_MODE_NAMES, ProjectError, validateManifest, type Manifest } from './manifest.js';
import { buildManifest, encodeManifest } from './write.js';

/**
 * Le manifeste que l'on écrit doit être celui que l'original écrirait, et
 * passer toutes les règles de `ProjectStore.validate`. Traduction de la partie
 * « métadonnées » de `ProjectTests`.
 */

const UUID_A = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const UUID_B = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

const sample = (): CompositorDocument => {
  let doc = createDocument('document-de-test', 800, 600, 144);
  doc = addLayer(doc, createLayer(UUID_A, 'Photo', {
    ...identityTransform({ width: 400, height: 300 }, { x: 10.5, y: -20 }),
    radians: Math.PI / 2,
    flipX: true,
    sampling: 'linear',
  }, 'asset-1'));
  doc = addLayer(doc, { ...createLayer('pas-un-uuid', 'Vide', identityTransform({ width: 800, height: 600 })), opacity: 0.25, blendMode: 'linearDodge' });
  return doc;
};

const layerOf = (manifest: Manifest, index: number) => manifest.layers[index]!;

describe('le manifeste écrit', () => {
  test('les champs de l’original, avec les valeurs attendues', () => {
    const manifest = buildManifest(sample(), UUID_A);
    expect(manifest.format).toBe('com.compositor.project');
    expect(manifest.version).toBe(9);
    expect(manifest.colorSpace).toBe('sRGB');
    expect(manifest.resolution).toBe(144);
    expect([manifest.width, manifest.height]).toEqual([800, 600]);
    expect(manifest.activeLayerID).toBe(UUID_A.toUpperCase());
  });

  test('le transform : tableaux, degrés, noms d’échantillonnage de l’original', () => {
    const { transform } = layerOf(buildManifest(sample(), null), 0);
    expect(transform).toEqual({
      origin: [10.5, -20],
      size: [400, 300],
      rotation: 90,
      flipX: true,
      flipY: false,
      sampling: 'Smooth',
    });
  });

  test('les UUID sont en majuscules, et le nom d’image en découle exactement', () => {
    const photo = layerOf(buildManifest(sample(), null), 0);
    expect(photo.id).toBe(UUID_A.toUpperCase());
    expect(photo.imageFile).toBe(`${UUID_A.toUpperCase()}.png`);
  });

  test('un identifiant qui n’est pas un UUID en reçoit un, cohérent partout', () => {
    const doc = sample();
    const withChild = { ...doc, layers: [...doc.layers, { ...createLayer('enfant', 'Enfant', identityTransform({ width: 1, height: 1 })), parentId: 'pas-un-uuid' }] };
    const manifest = buildManifest(withChild, 'pas-un-uuid');
    const replaced = layerOf(manifest, 1).id;
    expect(replaced).toMatch(/^[0-9A-F-]{36}$/);
    expect(layerOf(manifest, 2).parentID).toBe(replaced);
    expect(manifest.activeLayerID).toBe(replaced);
    expect(manifest.documentID).toMatch(/^[0-9A-F-]{36}$/);
  });

  test('un calque vide n’a pas d’image ; opacité, mode et dossier sont toujours écrits', () => {
    const blank = layerOf(buildManifest(sample(), null), 1);
    expect(blank.imageFile).toBeUndefined();
    expect(blank.opacity).toBe(0.25);
    expect(blank.blendMode).toBe('Linear Dodge (Add)');
    expect(blank.isGroup).toBe(false);
    expect('parentID' in blank).toBe(false);
  });

  test('sans calque actif, la clé est absente plutôt que nulle', () => {
    expect('activeLayerID' in buildManifest(sample(), null)).toBe(false);
  });

  test('les 24 modes ont chacun leur nom', () => {
    expect(new Set(Object.values(BLEND_MODE_NAMES)).size).toBe(24);
  });

  test('le JSON a ses clés triées, et se relit à l’identique', () => {
    const manifest = buildManifest(sample(), UUID_A);
    const text = new TextDecoder().decode(encodeManifest(manifest));
    expect(Object.keys(JSON.parse(text))).toEqual(Object.keys(JSON.parse(text)).sort());
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(manifest)));
  });

  test('ce que l’on écrit passe toutes les règles de l’original', () => {
    expect(() => validateManifest(buildManifest(sample(), UUID_A))).not.toThrow();
  });
});

/** `unsupportedCorruptAndUnsafeMetadataAreRejected`, et les autres règles de `validate`. */
describe('les manifestes refusés', () => {
  const valid = (): Manifest => buildManifest(sample(), UUID_A);
  const withLayer = (index: number, change: Record<string, unknown>): Manifest => {
    const m = valid();
    return { ...m, layers: m.layers.map((l, i) => (i === index ? { ...l, ...change } : l)) };
  };
  const kind = (manifest: Manifest): string | null => {
    try {
      validateManifest(manifest);
      return null;
    } catch (error) {
      return error instanceof ProjectError ? error.kind : 'autre';
    }
  };

  test('une version future, avec son numéro dans le message', () => {
    const future = { ...valid(), version: 42 };
    expect(kind(future)).toBe('version');
    expect(() => validateManifest(future)).toThrow(/42/);
  });

  test('un chemin qui sort du paquet', () => {
    expect(kind(withLayer(0, { imageFile: '../../outside.png' }))).toBe('invalid');
  });

  test('un nom d’image en minuscules : l’original compare à `uuidString`', () => {
    expect(kind(withLayer(0, { imageFile: `${UUID_A}.png` }))).toBe('invalid');
  });

  test('un format, un espace colorimétrique ou une résolution étrangers', () => {
    expect(kind({ ...valid(), format: 'autre.chose' })).toBe('invalid');
    expect(kind({ ...valid(), colorSpace: 'Display P3' })).toBe('invalid');
    expect(kind({ ...valid(), resolution: 0 })).toBe('invalid');
  });

  test('un canevas trop grand', () => {
    expect(kind({ ...valid(), width: 30_001 })).toBe('tooLarge');
  });

  test('des calques mal formés', () => {
    expect(kind(withLayer(0, { name: '   ' }))).toBe('invalid');
    expect(kind(withLayer(1, { id: UUID_A }))).toBe('invalid');
    expect(kind(withLayer(0, { opacity: 1.5 }))).toBe('invalid');
    expect(kind(withLayer(0, { blendMode: 'Dissolve' }))).toBe('invalid');
    expect(kind(withLayer(0, { transform: { ...layerOf(valid(), 0).transform, size: [0, 300] } }))).toBe('invalid');
  });

  test('un calque actif inconnu', () => {
    expect(kind({ ...valid(), activeLayerID: UUID_B })).toBe('invalid');
  });

  test('une apparence non par défaut avant la version 3', () => {
    expect(kind({ ...withLayer(1, {}), version: 2 })).toBe('invalid');
  });

  test('un dossier qui porte une image, ou un parent qui n’est pas un dossier', () => {
    expect(kind(withLayer(0, { isGroup: true }))).toBe('invalid');
    expect(kind(withLayer(1, { parentID: layerOf(valid(), 0).id }))).toBe('invalid');
  });
});
