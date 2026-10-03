import { expect, test } from '@playwright/test';

/**
 * **Règle d'arrêt de T3** : un `.comp` écrit puis relu redonne un document
 * identique champ à champ — et chaque octet de pixel.
 *
 * Le document couvre ce que le format porte aujourd'hui : les 24 modes, des
 * opacités extrêmes et quelconques, des angles au dixième de degré, les deux
 * retournements, les trois échantillonnages, un calque masqué, un calque vide,
 * un dossier et son enfant, une résolution non standard, et des pixels
 * semi-transparents sur les 256 niveaux d'alpha. Il passe par l'interface :
 * bouton « Enregistrer », puis bouton « Ouvrir… ».
 */

type Snapshot = {
  document: {
    id: string; width: number; height: number; resolution: number;
    layers: { id: string; asset: string | null; [key: string]: unknown }[];
  };
  activeLayerId: string | null;
  pixels: Record<string, number[]>;
};

test('écrire puis relire redonne le document, champ par champ et octet par octet', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as never as { __compositor?: { compositor?: unknown } }).__compositor?.compositor !== undefined,
  );

  const snapshot = (): Promise<Snapshot> =>
    page.evaluate(() => {
      const s = (window as never as {
        __compositor: {
          documentStore: {
            getState(): {
              document: Snapshot['document'];
              activeLayerId: string | null;
              assets: { get(id: string): { data: Uint8ClampedArray } | undefined };
            };
          };
        };
      }).__compositor.documentStore.getState();
      const pixels: Record<string, number[]> = {};
      for (const layer of s.document.layers) if (layer.asset !== null) pixels[layer.id] = [...s.assets.get(layer.asset)!.data];
      return { document: s.document, activeLayerId: s.activeLayerId, pixels };
    });

  await page.evaluate(() => {
    const { documentStore } = (window as never as {
      __compositor: { documentStore: { getState(): { assets: { add(b: unknown): string } }; setState(s: unknown): void } };
    }).__compositor;
    const modes = [
      'normal', 'darken', 'multiply', 'colorBurn', 'linearBurn', 'lighten', 'screen', 'colorDodge', 'linearDodge',
      'overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix',
      'difference', 'exclusion', 'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity',
    ];
    const angles = [0, 33.3, -90, 179.9, 0.1, 359.9, -720, 12.345];
    const samplings = ['nearest', 'linear', 'high'];
    const opacities = [1, 0, 0.37, 0.5, 0.999];
    const id = (i: number) => `3F2504E0-4F89-41D3-9A0C-${i.toString(16).toUpperCase().padStart(12, '0')}`;
    const pixels = (seed: number) => {
      const data = new Uint8ClampedArray(16 * 16 * 4);
      for (let i = 0; i < 256; i++) {
        const a = (i + seed) % 256;
        data.set([Math.floor((a * (i % 7)) / 7), Math.floor(a / 2), a, a], i * 4);
      }
      return documentStore.getState().assets.add({ width: 16, height: 16, data, isOpaque: false });
    };
    const layers: unknown[] = modes.map((blendMode, i) => ({
      id: id(i), name: `Calque ${i + 1} — ${blendMode}`, asset: pixels(i * 11),
      isVisible: i !== 3, parentId: null, isGroup: false,
      opacity: opacities[i % opacities.length], blendMode,
      transform: {
        origin: { x: i * 13 - 40, y: (i * 7) % 90 + 0.5 },
        size: { width: 16 + i, height: 16 + (i % 5) * 3.25 },
        rotation: angles[i % angles.length],
        flipX: i % 2 === 0, flipY: i % 3 === 0,
        sampling: samplings[i % samplings.length],
      },
    }));
    layers.push(
      { id: id(100), name: 'Vide', asset: null, isVisible: true, parentId: null, isGroup: false, opacity: 1, blendMode: 'normal',
        transform: { origin: { x: 0, y: 0 }, size: { width: 640, height: 480 }, rotation: 0, flipX: false, flipY: false, sampling: 'high' } },
      { id: id(101), name: 'Dossier', asset: null, isVisible: true, parentId: null, isGroup: true, opacity: 0.8, blendMode: 'normal',
        transform: { origin: { x: 0, y: 0 }, size: { width: 640, height: 480 }, rotation: 0, flipX: false, flipY: false, sampling: 'high' } },
      { id: id(102), name: 'Dans le dossier', asset: pixels(99), isVisible: true, parentId: id(101), isGroup: false, opacity: 1, blendMode: 'screen',
        transform: { origin: { x: 10, y: 10 }, size: { width: 16, height: 16 }, rotation: 45, flipX: false, flipY: false, sampling: 'high' } },
    );
    documentStore.setState({
      document: { id: '8E218E36-A3F2-4A76-AA14-1156FBC481E3', width: 640, height: 480, resolution: 300, layers },
      activeLayerId: id(7),
      selectedLayerIds: [id(7)],
    });
  });
  const before = await snapshot();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Enregistrer' }).click()]);
  const path = (await download.path())!;
  // Un autre document, pour que la relecture ait vraiment quelque chose à remplacer.
  await page.evaluate(() => {
    (window as never as { __compositor: { documentStore: { setState(s: unknown): void } } }).__compositor.documentStore.setState({
      document: { id: 'autre', width: 10, height: 10, resolution: 72, layers: [] }, activeLayerId: null, selectedLayerIds: [],
    });
  });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Ouvrir…' }).click()]);
  await chooser.setFiles(path);
  await expect.poll(async () => (await snapshot()).document.id).toBe(before.document.id);
  const after = await snapshot();

  // Les identifiants d'actif sont attribués à l'ouverture : on les ignore,
  // et l'on compare les pixels à la place.
  const withoutAssets = (s: Snapshot) => ({
    ...s.document,
    layers: s.document.layers.map((layer) => ({ ...layer, asset: layer.asset === null ? null : 'image' })),
  });
  expect(withoutAssets(after)).toEqual(withoutAssets(before));
  expect(after.activeLayerId).toBe(before.activeLayerId);

  let differentBytes = 0;
  let comparedBytes = 0;
  for (const [id, bytes] of Object.entries(before.pixels)) {
    const other = after.pixels[id]!;
    comparedBytes += bytes.length;
    bytes.forEach((value, i) => {
      if (other[i] !== value) differentBytes++;
    });
  }
  console.log(`» ${Object.keys(before.pixels).length} images, ${comparedBytes} octets comparés, ${differentBytes} différents`);
  expect(comparedBytes).toBe(25 * 16 * 16 * 4);
  expect(differentBytes).toBe(0);
});
