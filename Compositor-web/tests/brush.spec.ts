import { expect, test, type Page } from '@playwright/test';

/**
 * La brosse, à la souris, dans l'application qui tourne — traduction de
 * `BrushTests.continuousStrokeCrossesTilesAndCommitsOneUndo` et du refus de
 * `foldersHiddenLayersAndDisabledMasksRejectPainting`.
 */

type Layer = { id: string; name: string; asset: string | null; isVisible: boolean };
type Globals = {
  __compositor: {
    compositor?: { composite(document: unknown): Uint8ClampedArray };
    documentStore: {
      getState(): {
        document: { width: number; height: number; layers: Layer[] } | null;
        assets: { get(id: string): { width: number; data: Uint8ClampedArray } | undefined };
      };
      setState(state: unknown): void;
    };
    uiStore: { getState(): { tool: string; brush: unknown }; setState(state: unknown): void };
    historyDetails(): { undoCount: number; undoName: string };
  };
};

/** Un document vide, un calque vide qui le couvre, vue à l'échelle 1 décalée de 10 px. */
const open = async (page: Page, width: number, height: number, layers = 1): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as Globals).__compositor?.compositor !== undefined);
  await page.evaluate(
    ({ width, height, layers }) => {
      const { documentStore, uiStore } = (window as never as Globals).__compositor;
      const blank = (i: number) => ({
        id: `calque-${i}`, name: `Calque ${i}`, asset: null, isVisible: true, parentId: null, isGroup: false,
        opacity: 1, blendMode: 'normal',
        transform: { origin: { x: 0, y: 0 }, size: { width, height }, rotation: 0, flipX: false, flipY: false, sampling: 'high' },
      });
      documentStore.setState({
        document: { id: 'doc', width, height, resolution: 72, layers: Array.from({ length: layers }, (_, i) => blank(i + 1)) },
        activeLayerId: 'calque-1',
        selectedLayerIds: ['calque-1'],
      });
      uiStore.setState({ viewport: { scale: 1, offsetX: 10, offsetY: 10 } });
    },
    { width, height, layers },
  );
};

/** Un point du document, en coordonnées de la page. */
const at = async (page: Page, x: number, y: number) => {
  const box = (await page.locator('canvas[data-role="document"]').boundingBox())!;
  return { x: box.x + 10 + x, y: box.y + 10 + y };
};

/** Un trait à la souris, d'un point à l'autre du document. */
const stroke = async (page: Page, points: readonly (readonly [number, number])[], during?: () => Promise<void>) => {
  const first = await at(page, points[0]![0], points[0]![1]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) {
    const p = await at(page, x, y);
    await page.mouse.move(p.x, p.y, { steps: 7 });
  }
  await during?.();
  await page.mouse.up();
};

/** Ce que le GPU compose, comparé octet par octet aux pixels du calque côté CPU. */
const gpuAgainstCpu = (page: Page) =>
  page.evaluate(() => {
    const { compositor, documentStore } = (window as never as Globals).__compositor;
    const { document, assets } = documentStore.getState();
    const gpu = compositor!.composite(document);
    const cpu = assets.get(document!.layers[0]!.asset!)!.data;
    let count = 0;
    for (let i = 0; i < cpu.length; i++) if (gpu[i] !== cpu[i]) count++;
    return { count, painted: cpu.filter((_, i) => i % 4 === 3 && cpu[i] > 0).length };
  });

const layer = (page: Page) =>
  page.evaluate(() => (window as never as Globals).__compositor.documentStore.getState().document!.layers[0]!);

const undoCount = (page: Page) => page.evaluate(() => (window as never as Globals).__compositor.historyDetails().undoCount);

/** Les pixels composés, lus sur le GPU, à la ligne `y`, pour chaque `x`. */
const composed = (page: Page, xs: number[], y: number) =>
  page.evaluate(
    ({ xs, y }) => {
      const { compositor, documentStore } = (window as never as Globals).__compositor;
      const document = documentStore.getState().document!;
      const pixels = compositor!.composite(document);
      return xs.map((x) => [...pixels.subarray((y * document.width + x) * 4, (y * document.width + x) * 4 + 4)]);
    },
    { xs, y },
  );

test('un trait traverse les tuiles sans couture, et s’annule d’un coup', async ({ page }) => {
  await open(page, 600, 80);
  await page.evaluate(() => {
    const { uiStore } = (window as never as Globals).__compositor;
    uiStore.setState({ brush: { diameter: 40, hardness: 1, red: 1, green: 0, blue: 0, opacity: 1 } });
  });
  await page.keyboard.press('b');
  expect(await page.evaluate(() => (window as never as Globals).__compositor.uiStore.getState().tool)).toBe('brush');
  const before = await undoCount(page);

  const start = await at(page, 20, 40);
  const end = await at(page, 580, 40);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 20 });

  // Pendant le geste : le document n'a pas changé, mais l'aperçu montre le trait.
  expect((await layer(page)).asset).toBeNull();
  expect(await undoCount(page)).toBe(before);
  const xs = [20, 255, 256, 511, 512, 579];
  for (const pixel of await composed(page, xs, 40)) expect(pixel).toEqual([255, 0, 0, 255]);

  await page.mouse.up();
  expect(await undoCount(page)).toBe(before + 1);
  expect(await page.evaluate(() => (window as never as Globals).__compositor.historyDetails().undoName)).toBe('Coup de brosse');
  for (const pixel of await composed(page, xs, 40)) expect(pixel).toEqual([255, 0, 0, 255]);
  expect((await composed(page, [300], 0))[0]![3]).toBe(0);

  await page.keyboard.press('Control+z');
  expect((await layer(page)).asset).toBeNull();
  expect((await composed(page, [300], 40))[0]![3]).toBe(0);
  await page.keyboard.press('Control+Shift+Z');
  expect((await layer(page)).asset).not.toBeNull();
  expect((await composed(page, [300], 40))[0]).toEqual([255, 0, 0, 255]);
});

test('ce que le GPU affiche est exactement le raster enregistré', async ({ page }) => {
  await open(page, 700, 300);
  await page.keyboard.press('b');
  await stroke(page, [[30, 30], [650, 60], [400, 280], [100, 200], [690, 290]]);
  const result = await gpuAgainstCpu(page);
  expect(result.painted).toBeGreaterThan(10_000);
  expect(result.count).toBe(0);
});

test('sur une image existante, deux traits, puis annuler et rétablir : le GPU suit le CPU', async ({ page }) => {
  await open(page, 700, 300);
  // Une image opaque, en dégradé, à la place du calque vide.
  await page.evaluate(() => {
    const { documentStore } = (window as never as Globals).__compositor;
    const state = documentStore.getState() as unknown as {
      document: { layers: Layer[] };
      assets: { add(buffer: unknown): string };
    };
    const data = new Uint8ClampedArray(700 * 300 * 4);
    for (let i = 0; i < 700 * 300; i++) data.set([(i % 700) % 256, Math.floor(i / 700) % 256, 90, 255], i * 4);
    const asset = state.assets.add({ width: 700, height: 300, data, isOpaque: true });
    documentStore.setState({ document: { ...state.document, layers: state.document.layers.map((l) => ({ ...l, asset })) } });
  });
  await page.keyboard.press('b');
  await stroke(page, [[30, 30], [650, 250]]);
  await stroke(page, [[650, 30], [30, 250]]);
  expect(await gpuAgainstCpu(page)).toMatchObject({ count: 0 });
  // Annuler ramène le premier raster ; rétablir retéléverse le second, tuiles comprises.
  await page.keyboard.press('Control+z');
  expect(await gpuAgainstCpu(page)).toMatchObject({ count: 0 });
  await page.keyboard.press('Control+Shift+Z');
  const result = await gpuAgainstCpu(page);
  expect(result.count).toBe(0);
  // Le dégradé d'origine est toujours là, hors des traits.
  expect((await composed(page, [600], 290))[0]).toEqual([600 % 256, 290 % 256, 90, 255]);
});

test('une pointe douce translucide : l’opacité plafonne le trait, et le GPU suit le CPU', async ({ page }) => {
  await open(page, 700, 300);
  await page.evaluate(() => {
    (window as never as Globals).__compositor.uiStore.setState({
      brush: { diameter: 120, hardness: 0, red: 1, green: 1, blue: 1, opacity: 0.4 },
    });
  });
  await page.keyboard.press('b');
  await stroke(page, [[100, 150], [600, 150], [600, 60], [350, 60], [350, 280]]);
  const result = await gpuAgainstCpu(page);
  expect(result.count).toBe(0);
  const alphas = await page.evaluate(() => {
    const { documentStore } = (window as never as Globals).__compositor;
    const { document, assets } = documentStore.getState();
    const data = assets.get(document!.layers[0]!.asset!)!.data;
    let max = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > max) max = data[i]!;
    return { max, crossing: data[(150 * 700 + 350) * 4 + 3] };
  });
  // 40 % de 255 : le croisement, peint deux fois, ne dépasse pas le plafond.
  expect(alphas).toEqual({ max: 102, crossing: 102 });
});

test('Ctrl+Z pendant un trait ne fait rien : le geste se termine en une entrée', async ({ page }) => {
  await open(page, 400, 200);
  await page.keyboard.press('b');
  await stroke(page, [[20, 20], [380, 20]]);
  const before = await undoCount(page);
  await stroke(page, [[20, 150], [380, 150]], () => page.keyboard.press('Control+z'));
  expect(await undoCount(page)).toBe(before + 1);
  const [top, bottom] = [(await composed(page, [200], 20))[0]!, (await composed(page, [200], 150))[0]!];
  expect([top[3], bottom[3]]).toEqual([255, 255]);
});

test('un calque masqué refuse la brosse, et dit pourquoi', async ({ page }) => {
  await open(page, 200, 100);
  await page.evaluate(() => {
    const { documentStore } = (window as never as Globals).__compositor;
    const { document } = documentStore.getState();
    documentStore.setState({ document: { ...document!, layers: document!.layers.map((l) => ({ ...l, isVisible: false })) } });
  });
  await page.keyboard.press('b');
  const before = await undoCount(page);
  const p = await at(page, 50, 50);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByRole('status')).toHaveText('« Calque 1 » est masqué, ou dans un dossier masqué. Affichez-le pour peindre dessus.');
  expect(await undoCount(page)).toBe(before);
  expect((await layer(page)).asset).toBeNull();
});

test('plusieurs calques sélectionnés : la brosse refuse', async ({ page }) => {
  await open(page, 200, 100, 2);
  await page.evaluate(() => {
    (window as never as Globals).__compositor.documentStore.setState({ selectedLayerIds: ['calque-1', 'calque-2'] });
  });
  await page.keyboard.press('b');
  const p = await at(page, 50, 50);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByRole('status')).toHaveText('Plusieurs calques sont sélectionnés. Sélectionnez-en un seul pour peindre dessus.');
});

test('B et V changent d’outil, sauf dans un champ de texte', async ({ page }) => {
  await open(page, 200, 100);
  const tool = () => page.evaluate(() => (window as never as Globals).__compositor.uiStore.getState().tool);
  await page.keyboard.press('b');
  expect(await tool()).toBe('brush');
  await expect(page.getByRole('button', { name: 'Brosse (B)' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('v');
  expect(await tool()).toBe('move');
  // Un champ de texte ordinaire : les champs React Aria arrêtent eux-mêmes la
  // propagation, et ne prouveraient rien.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('aria-label', 'Champ de test');
    document.body.append(input);
  });
  await page.getByRole('textbox', { name: 'Champ de test' }).focus();
  await page.keyboard.press('b');
  await expect(page.getByRole('textbox', { name: 'Champ de test' })).toHaveValue('b');
  expect(await tool()).toBe('move');
});
