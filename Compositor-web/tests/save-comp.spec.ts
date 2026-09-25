import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { validateManifest, type Manifest } from '../packages/io/src/project/manifest.js';

/**
 * Enregistrer un `.comp` depuis l'interface, puis ouvrir le fichier téléchargé
 * comme le ferait l'original : un paquet avec `manifest.json` et `images/`,
 * un manifeste que `ProjectStore.validate` accepte, des PNG aux bons octets.
 */

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

/** Un calque image semi-transparent, un calque vide ; renvoie les octets prémultipliés. */
const setUp = async (page: Page): Promise<number[]> => {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as never as { __compositor?: { compositor?: unknown } }).__compositor?.compositor !== undefined,
  );
  return page.evaluate((uuid) => {
    const { documentStore } = (window as never as {
      __compositor: {
        documentStore: { getState(): { assets: { add(b: unknown): string } }; setState(s: unknown): void };
      };
    }).__compositor;
    // Toutes les valeurs d'alpha, chacune avec une couleur prémultipliée valide.
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < 256; i++) {
      const a = i;
      data.set([Math.floor(a * 0.9), Math.floor(a / 3), a, a], i * 4);
    }
    const asset = documentStore.getState().assets.add({ width: 16, height: 16, data, isOpaque: false });
    const base = { isVisible: true, parentId: null, isGroup: false };
    documentStore.setState({
      document: {
        id: 'doc', width: 320, height: 200, resolution: 300,
        layers: [
          { ...base, id: uuid, name: 'Dégradé', asset, opacity: 0.5, blendMode: 'hardLight',
            transform: { origin: { x: 12, y: 8 }, size: { width: 64, height: 64 }, radians: Math.PI, flipX: false, flipY: true, sampling: 'nearest' } },
          { ...base, id: 'vide', name: 'Calque 1', asset: null, opacity: 1, blendMode: 'normal',
            transform: { origin: { x: 0, y: 0 }, size: { width: 320, height: 200 }, radians: 0, flipX: false, flipY: false, sampling: 'high' } },
        ],
      },
      activeLayerId: uuid,
      selectedLayerIds: [uuid],
    });
    return [...data];
  }, UUID);
};

const saveWith = async (page: Page, trigger: () => Promise<void>) => {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const bytes = await readFile((await download.path())!);
  return { name: download.suggestedFilename(), files: unzipSync(new Uint8Array(bytes)) };
};

test('le fichier enregistré est un paquet .comp que l’original accepterait', async ({ page }) => {
  const source = await setUp(page);
  const { name, files } = await saveWith(page, () => page.getByRole('button', { name: 'Enregistrer' }).click());

  expect(name).toBe('Sans titre.comp');
  const image = `images/${UUID.toUpperCase()}.png`;
  expect(Object.keys(files).filter((k) => !k.endsWith('/')).sort()).toEqual([image, 'manifest.json']);

  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as Manifest;
  expect(() => validateManifest(manifest)).not.toThrow();
  expect(manifest.resolution).toBe(300);
  expect(manifest.activeLayerID).toBe(UUID.toUpperCase());
  expect(manifest.layers[0]).toMatchObject({
    name: 'Dégradé',
    opacity: 0.5,
    blendMode: 'Hard Light',
    imageFile: `${UUID.toUpperCase()}.png`,
    transform: { origin: [12, 8], size: [64, 64], rotation: 180, flipX: false, flipY: true, sampling: 'Nearest' },
  });
  expect(manifest.layers[1]!.imageFile).toBeUndefined();

  // Les pixels relus du PNG : les mêmes octets, alpha compris.
  const decoded = await page.evaluate(async (png) => {
    const io = (await import('/@id/@compositor/io')) as {
      decodeImageFile(f: File, max: number): Promise<{ data: Uint8ClampedArray }>;
    };
    const file = new File([new Uint8Array(png)], 'x.png', { type: 'image/png' });
    return [...(await io.decodeImageFile(file, 30_000)).data];
  }, [...files[image]!]);
  const different = decoded.filter((value, i) => value !== source[i]).length;
  expect(different).toBe(0);
});

test('Ctrl+S enregistre aussi, au lieu d’enregistrer la page web', async ({ page }) => {
  await setUp(page);
  const { name } = await saveWith(page, () => page.keyboard.press('Control+s'));
  expect(name).toBe('Sans titre.comp');
});
