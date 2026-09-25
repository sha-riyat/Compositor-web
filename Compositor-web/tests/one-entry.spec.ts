import { expect, test, type Page } from '@playwright/test';

/**
 * Un geste, une entrée d'annulation — et une annulation ramène l'état d'avant
 * le geste entier. Chaque test compte les entrées qu'ajoute un geste réel,
 * à la souris ou au clavier.
 */

type Globals = {
  __compositor: {
    documentStore: {
      getState(): {
        assets: { add(b: unknown): string };
        document: { layers: { id: string; opacity: number; transform: { origin: { x: number } } }[] };
      };
      setState(s: unknown): void;
    };
    uiStore: { setState(s: unknown): void };
    historyDetails(): { undoCount: number; undoName: string };
  };
};

const count = (page: Page): Promise<number> =>
  page.evaluate(() => (window as never as Globals).__compositor.historyDetails().undoCount);

const layers = (page: Page) =>
  page.evaluate(() => (window as never as Globals).__compositor.documentStore.getState().document.layers);

/** Trois calques gris 100 × 100 côte à côte, le plus haut actif, vue à 100 %. */
const setUp = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as never as { __compositor?: { compositor?: unknown } }).__compositor?.compositor !== undefined,
  );
  await page.evaluate(() => {
    const { documentStore, uiStore } = (window as never as Globals).__compositor;
    const layer = (id: string, x: number) => ({
      id, name: id, isVisible: true, parentId: null, isGroup: false, opacity: 1, blendMode: 'normal',
      asset: documentStore.getState().assets.add({
        width: 100, height: 100, data: new Uint8ClampedArray(100 * 100 * 4).fill(180), isOpaque: true,
      }),
      transform: { origin: { x, y: 0 }, size: { width: 100, height: 100 }, radians: 0, flipX: false, flipY: false, sampling: 'linear' },
    });
    documentStore.setState({
      document: { id: 'g', width: 400, height: 200, resolution: 72, layers: [layer('A', 0), layer('B', 150), layer('C', 300)] },
      activeLayerId: 'C',
      selectedLayerIds: ['C'],
    });
    uiStore.setState({ tool: 'move', viewport: { scale: 1, offsetX: 0, offsetY: 0 } });
  });
};

test('glisser le curseur d’opacité : une entrée, annulée d’un coup', async ({ page }) => {
  await setUp(page);
  // L'`input` du curseur est masqué dans une enveloppe de 1 px, elle-même
  // dans le pouce, lui-même dans la piste — mesuré dans la page.
  const input = page.getByRole('slider', { name: 'Opacité' });
  const thumb = (await input.locator('xpath=../..').boundingBox())!;
  const track = (await input.locator('xpath=../../..').boundingBox())!;
  const y = thumb.y + thumb.height / 2;
  await page.mouse.move(thumb.x + thumb.width / 2, y);
  await page.mouse.down();
  for (const fraction of [0.9, 0.7, 0.5, 0.3]) await page.mouse.move(track.x + track.width * fraction, y, { steps: 3 });
  await page.mouse.up();

  expect((await layers(page))[2]!.opacity).toBeLessThan(0.6);
  expect(await count(page)).toBe(1);
  await page.keyboard.press('Control+z');
  expect((await layers(page))[2]!.opacity).toBe(1);
});

test('taper 150 dans X : une entrée', async ({ page }) => {
  await setUp(page);
  const x = page.getByRole('textbox', { name: 'X', exact: true });
  await x.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('150');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');

  expect((await layers(page))[2]!.transform.origin.x).toBe(151);
  expect(await count(page)).toBe(1);
  await page.keyboard.press('Control+z');
  expect((await layers(page))[2]!.transform.origin.x).toBe(300);
});

test('glisser un calque sur le canevas : une entrée', async ({ page }) => {
  await setUp(page);
  const box = (await page.locator('canvas[data-role="document"]').boundingBox())!;
  await page.mouse.move(box.x + 350, box.y + 50);
  await page.mouse.down();
  for (const dx of [10, 20, 30, 40]) await page.mouse.move(box.x + 350 - dx, box.y + 50, { steps: 2 });
  await page.mouse.up();

  expect((await layers(page))[2]!.transform.origin.x).toBe(260);
  expect(await count(page)).toBe(1);
});

test('glisser un calque dans la liste de deux crans : une entrée', async ({ page }) => {
  await setUp(page);
  // La liste montre le haut de la pile en premier : C, B, A.
  const top = (await page.getByRole('option').nth(0).boundingBox())!;
  const bottom = (await page.getByRole('option').nth(2).boundingBox())!;
  await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
  await page.mouse.down();
  await page.mouse.move(top.x + top.width / 2, bottom.y + bottom.height / 2, { steps: 12 });
  await page.mouse.up();

  expect((await layers(page)).map((l) => l.id)).toEqual(['C', 'A', 'B']);
  expect(await count(page)).toBe(1);
  await page.keyboard.press('Control+z');
  expect((await layers(page)).map((l) => l.id)).toEqual(['A', 'B', 'C']);
});

/**
 * `moveToolNumberKeysSetSelectedLayersOpacityAsOneUndo` : plusieurs calques
 * sélectionnés, un chiffre, une entrée ; un second chiffre hors de la fenêtre
 * en fait une autre.
 */
test('un chiffre règle tous les calques sélectionnés en une entrée', async ({ page }) => {
  await setUp(page);
  await page.evaluate(() => {
    (window as never as Globals).__compositor.documentStore.setState({ selectedLayerIds: ['A', 'C'] });
  });
  await page.keyboard.press('5');
  expect((await layers(page)).map((l) => l.opacity)).toEqual([0.5, 1, 0.5]);
  expect(await count(page)).toBe(1);

  await page.waitForTimeout(650);
  await page.keyboard.press('0');
  expect(await count(page)).toBe(2);
  await page.keyboard.press('Control+z');
  expect((await layers(page)).map((l) => l.opacity)).toEqual([0.5, 1, 0.5]);
});
