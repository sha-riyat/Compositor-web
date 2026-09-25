import { describe, expect, test } from 'vitest';
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { PixelBuffer } from '@compositor/model';
import { ProjectError } from './manifest.js';
import { filesFromZip, packageRoot, readProject, type DecodePNG, type PackageFile } from './read.js';

/**
 * La lecture d'un `.comp`, sans navigateur : les zips sont fabriqués ici et le
 * décodage PNG est simulé. Traduction de `ProjectTests.unsupportedCorruptAndUnsafeMetadataAreRejected`
 * et `missingEmbeddedImageIsRejected`, plus les formes que prend un paquet.
 */

const ID = '6BA7B810-9DAD-11D1-80B4-00C04FD430C8';
const DOC = '8E218E36-A3F2-4A76-AA14-1156FBC481E3';

/** Juste assez de PNG pour la signature et l'en-tête IHDR. */
const png = (depth = 8): Uint8Array => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes[24] = depth;
  return bytes;
};

const decode: DecodePNG = async () => ({ width: 4, height: 2, data: new Uint8ClampedArray(32).fill(7), isOpaque: false });

const layer = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  name: 'solutions icon',
  isVisible: true,
  imageFile: `${ID}.png`,
  isGroup: false,
  opacity: 1,
  blendMode: 'Normal',
  transform: { origin: [103, 0], size: [789, 709], rotation: 0, flipX: false, flipY: false, sampling: 'Smooth' },
  ...extra,
});

/** Le manifeste que l'utilisateur a enregistré le 2026-09-25, à la position près. */
const manifest = (extra: Record<string, unknown> = {}, layers: unknown[] = [layer()]) => ({
  colorSpace: 'sRGB', documentID: DOC, format: 'com.compositor.project', height: 709, width: 789,
  resolution: 72, version: 9, layers, ...extra,
});

const zip = (files: Zippable): Uint8Array => zipSync(files);
const project = (m: unknown = manifest(), images: Zippable = { [`${ID}.png`]: png() }) =>
  zip({ 'manifest.json': strToU8(JSON.stringify(m)), images });

const failure = async (run: () => Promise<unknown>): Promise<ProjectError> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof ProjectError) return error;
    throw error;
  }
  throw new Error('Le projet a été accepté.');
};

const open = (bytes: Uint8Array, decoder: DecodePNG = decode) => readProject(filesFromZip(bytes), decoder, 30_000);

describe('les formes d’un paquet', () => {
  const file = (text: string): PackageFile => async () => strToU8(text);

  test('le contenu à la racine, comme notre zip', () => {
    const files = packageRoot(new Map([['manifest.json', file('{}')], ['images/a.png', file('')]]));
    expect([...files.keys()].sort()).toEqual(['images/a.png', 'manifest.json']);
  });

  test('un paquet compressé par le Finder : un sous-dossier, et __MACOSX ignoré', () => {
    const files = packageRoot(new Map([
      ['Affiche.comp/', file('')],
      ['Affiche.comp/manifest.json', file('{}')],
      ['Affiche.comp/images/a.png', file('')],
      ['__MACOSX/Affiche.comp/._manifest.json', file('')],
    ]));
    expect([...files.keys()].sort()).toEqual(['images/a.png', 'manifest.json']);
  });

  test('sans manifeste, ou avec deux projets, rien n’est ouvert', () => {
    expect(() => packageRoot(new Map([['images/a.png', file('')]]))).toThrow(ProjectError);
    expect(() => packageRoot(new Map([['A/manifest.json', file('{}')], ['B/manifest.json', file('{}')]]))).toThrow(/plusieurs/);
  });

  test('un fichier qui n’est pas un zip', async () => {
    expect((await failure(async () => filesFromZip(strToU8('pas un zip')))).kind).toBe('invalid');
  });
});

describe('ce que l’on lit', () => {
  test('le manifeste de l’utilisateur s’ouvre, champ par champ', async () => {
    const opened = await open(project());
    expect(opened.document).toMatchObject({ id: DOC, width: 789, height: 709, resolution: 72 });
    const [first] = opened.document.layers;
    expect(first).toMatchObject({
      id: ID, name: 'solutions icon', isVisible: true, isGroup: false, opacity: 1, blendMode: 'normal', parentId: null,
    });
    expect(first!.transform).toEqual({
      origin: { x: 103, y: 0 }, size: { width: 789, height: 709 }, radians: 0, flipX: false, flipY: false, sampling: 'linear',
    });
    expect(opened.images.get(ID)?.width).toBe(4);
  });

  test('degrés en radians, noms en modes, identifiants en majuscules', async () => {
    const lower = ID.toLowerCase();
    const opened = await open(project(manifest({ activeLayerID: lower }, [
      layer({ id: lower, imageFile: `${ID}.png`, blendMode: 'Linear Dodge (Add)', opacity: 0.25, transform: { ...layer().transform, rotation: 90, sampling: 'High quality' } }),
    ])));
    const [first] = opened.document.layers;
    expect(first!.id).toBe(ID);
    expect(opened.activeLayerId).toBe(ID);
    expect(first!.blendMode).toBe('linearDodge');
    expect(first!.opacity).toBe(0.25);
    expect(first!.transform.radians).toBeCloseTo(Math.PI / 2, 12);
    expect(first!.transform.sampling).toBe('high');
  });

  test('une version ancienne : valeurs par défaut pour ce qui n’existait pas', async () => {
    const old = manifest({ version: 2, resolution: undefined }, [
      layer({ opacity: undefined, blendMode: undefined, isGroup: undefined }),
    ]);
    const opened = await open(project(JSON.parse(JSON.stringify(old))));
    expect(opened.document.resolution).toBe(72);
    expect(opened.document.layers[0]).toMatchObject({ opacity: 1, blendMode: 'normal', isGroup: false });
  });
});

describe('ce qui est refusé', () => {
  test('une version future, avec son numéro', async () => {
    const error = await failure(() => open(project(manifest({ version: 42 }))));
    expect(error.kind).toBe('version');
    expect(error.message).toMatch(/42/);
  });

  test('des métadonnées qui ne sont pas du JSON', async () => {
    const bytes = zip({ 'manifest.json': strToU8('not json'), images: {} });
    expect((await failure(() => open(bytes))).kind).toBe('invalid');
  });

  test('un chemin qui sort du paquet', async () => {
    const error = await failure(() => open(project(manifest({}, [layer({ imageFile: '../../outside.png' })]))));
    expect(error.kind).toBe('invalid');
  });

  test('une image manquante', async () => {
    expect((await failure(() => open(project(manifest(), {})))).kind).toBe('missingImage');
  });

  test('une image qui n’est pas un PNG, ou en 16 bits', async () => {
    const notPNG = project(manifest(), { [`${ID}.png`]: strToU8('pas une image') });
    const sixteenBits = project(manifest(), { [`${ID}.png`]: png(16) });
    expect((await failure(() => open(notPNG))).kind).toBe('missingImage');
    expect((await failure(() => open(sixteenBits))).kind).toBe('missingImage');
  });

  test('plus de 100 mégapixels d’images au total', async () => {
    const huge: DecodePNG = async (): Promise<PixelBuffer> => ({ width: 10_001, height: 10_000, data: new Uint8ClampedArray(4), isOpaque: true });
    expect((await failure(() => open(project(), huge))).kind).toBe('tooLarge');
  });

  test('ce que le web ne sait pas encore afficher est refusé, en le disant', async () => {
    const error = await failure(() => open(project(manifest({}, [layer({ maskFile: `${ID}.mask.png`, maskEnabled: true })]))));
    expect(error.kind).toBe('unsupported');
    expect(error.message).toMatch(/masques/);
    const guides = await failure(() => open(project(manifest({ guides: [{ id: DOC, position: 10 }] }))));
    expect(guides.message).toMatch(/repères/);
  });
});
